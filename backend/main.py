"""SONiC MCP Community Client — backend.

A thin FastAPI proxy between the React frontend and the SONiC MCP server.
Mirrors the server's invoke envelope so the frontend doesn't need to talk to
two different contracts.

Trust boundaries (see SECURITY.md):
  Browser/user → CLIENT_API_KEY → client backend → MCP_API_KEY → MCP server
Both keys are optional but recommended; when CLIENT_API_KEY is unset the proxy
logs a warning and relies on a localhost bind / authenticated reverse proxy.

Routes:
  GET  /api/health          — client health + upstream MCP reachability
  GET  /api/ready           — proxies the MCP /ready probe
  GET  /api/tools           — proxies the MCP tool catalog
  POST /api/invoke          — proxies to MCP /invoke with session passthrough
  POST /api/nl              — deterministic NL router → suggests tool + inputs
                              (with ?auto=true, also invokes and returns the result)
  GET  /api/examples        — static list of example prompts for the UI
  GET  /api/client-settings — view MCP base URL + timeouts (auth-gated)
  GET  /api/openai-status   — whether an OpenAI key is configured
"""

from __future__ import annotations

import hmac
import ipaddress
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from nl_router import EXAMPLES, SWITCH_ALIASES, route as nl_route
from version import __version__
import llm
import settings as settings_mod

load_dotenv()

logging.basicConfig(
    level=os.environ.get("CLIENT_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(levelname)-5s | %(name)s | %(message)s",
)
logger = logging.getLogger("mcp-client")


# ---------------------------------------------------------------
# Config
# ---------------------------------------------------------------
MCP_BASE_URL = os.environ.get("MCP_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
MCP_TIMEOUT = float(os.environ.get("MCP_TIMEOUT_SECONDS", "30"))

# Upstream credential — forwarded to the MCP server on every call when the
# server has MCP_API_KEY enabled (the recommended secure config). Stays in
# the backend only; it is NEVER sent to the browser.
MCP_API_KEY = os.environ.get("MCP_API_KEY", "").strip()

# Client-facing credential — a DIFFERENT secret that gates this proxy's own
# sensitive routes. When set, callers must send `Authorization: Bearer
# <CLIENT_API_KEY>`. Two distinct trust boundaries:
#     Browser/user → CLIENT_API_KEY → client backend → MCP_API_KEY → MCP server
# For a browser UI, put an authenticating reverse proxy in front (SSO /
# OAuth2-proxy / Authelia / basic auth) and/or bind to localhost; CLIENT_API_KEY
# is primarily for scripted or reverse-proxy-injected access.
CLIENT_API_KEY = os.environ.get("CLIENT_API_KEY", "").strip()

# When an LLM fallback (OpenAI/Ollama) is used for an unmatched NL query, the
# backend can include live device context (management IPs, reachability) in the
# prompt. For OpenAI this leaves the local environment, so the default is OFF
# (security-first). Set LLM_INCLUDE_DEVICE_CONTEXT=1 to opt in and improve
# tool-selection quality (lets the LLM resolve switch_ip from device context).
LLM_INCLUDE_DEVICE_CONTEXT = os.environ.get(
    "LLM_INCLUDE_DEVICE_CONTEXT", "0"
).strip().lower() in ("1", "true", "yes", "on")

app = FastAPI(title="SONiC MCP Community Client — backend", version=__version__)

# CORS: restrictive by default. Single-port production (frontend + API on the
# same origin) needs no cross-origin access at all, so the allow-list is empty
# unless CLIENT_CORS_ORIGINS is set (e.g. http://localhost:5173 for Vite dev).
_cors_raw = os.environ.get("CLIENT_CORS_ORIGINS", "")
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-MCP-Session", "Authorization"],
)

# ---------------------------------------------------------------
# Client-facing auth (Bearer token on sensitive /api routes)
# ---------------------------------------------------------------
if not CLIENT_API_KEY:
    logger.warning(
        "CLIENT_API_KEY is not set — this proxy has NO client-facing auth. "
        "Anyone who can reach the port can invoke tools, change inventory, "
        "and edit LLM/API-key settings. Bind to localhost or put an "
        "authenticated reverse proxy in front. Never expose it to the Internet."
    )
if MCP_API_KEY and not CLIENT_API_KEY:
    logger.warning(
        "MCP_API_KEY is set but CLIENT_API_KEY is not — the upstream server "
        "credential is reachable by anyone who can hit this proxy. Set "
        "CLIENT_API_KEY (a different secret) or front the proxy with auth."
    )


def require_client_auth(authorization: Optional[str] = Header(default=None)) -> None:
    """Dependency enforcing the client Bearer key on sensitive routes.

    No-op when CLIENT_API_KEY is unset. Constant-time compare so the check
    doesn't leak the key via timing.
    """
    if not CLIENT_API_KEY:
        return
    expected = f"Bearer {CLIENT_API_KEY}"
    if not hmac.compare_digest(authorization or "", expected):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid client API key",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------
# Upstream MCP client (shared, connection-pooled)
# ---------------------------------------------------------------
_http: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        headers = {"Accept": "application/json"}
        # Forward the upstream key so protected server endpoints (/invoke,
        # inventory writes, intent writes, probe) work when the server has
        # MCP_API_KEY enabled. Backend-only — never exposed to the browser.
        if MCP_API_KEY:
            headers["Authorization"] = f"Bearer {MCP_API_KEY}"
        _http = httpx.AsyncClient(
            base_url=MCP_BASE_URL,
            timeout=MCP_TIMEOUT,
            headers=headers,
        )
    return _http


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _http
    if _http is not None:
        await _http.aclose()
        _http = None


def _upstream_error(exc: Exception) -> HTTPException:
    """Sanitize an upstream transport failure. The raw exception can carry the
    MCP host/IP/port and DNS/connection internals — log it server-side under a
    request ID and return only that ID to the caller."""
    request_id = uuid.uuid4().hex[:12]
    logger.warning("mcp upstream error request_id=%s: %s", request_id, exc)
    return HTTPException(
        status_code=502,
        detail={"detail": "MCP server is unavailable", "request_id": request_id},
    )


async def _mcp_get(path: str, *, headers: Optional[Dict[str, str]] = None) -> httpx.Response:
    try:
        return await _client().get(path, headers=headers or {})
    except httpx.HTTPError as e:
        raise _upstream_error(e) from e


async def _mcp_post(
    path: str,
    *,
    json_body: Dict[str, Any],
    headers: Optional[Dict[str, str]] = None,
) -> httpx.Response:
    try:
        return await _client().post(path, json=json_body, headers=headers or {})
    except httpx.HTTPError as e:
        raise _upstream_error(e) from e


async def _mcp_put(
    path: str,
    *,
    json_body: Dict[str, Any],
    headers: Optional[Dict[str, str]] = None,
) -> httpx.Response:
    try:
        return await _client().put(path, json=json_body, headers=headers or {})
    except httpx.HTTPError as e:
        raise _upstream_error(e) from e


# ---------------------------------------------------------------
# Models
# ---------------------------------------------------------------
class InvokeReq(BaseModel):
    tool: str
    inputs: Dict[str, Any] = {}
    context: Optional[Dict[str, Any]] = None
    # MUTATION / DESTRUCTIVE tools on the MCP server require confirm=true in
    # the request body; forward it through when the client sends it.
    confirm: bool = False


class NlReq(BaseModel):
    text: str


# ---------------------------------------------------------------
# Routes
# ---------------------------------------------------------------
@app.get("/api/health")
async def health() -> Dict[str, Any]:
    """Always returns 200 as long as the backend is alive. Also reports
    whether the upstream MCP server responded — but NOT its URL, which is not
    exposed to unauthenticated callers."""
    upstream: Dict[str, Any] = {"reachable": False}
    try:
        r = await _mcp_get("/health")
        upstream["status_code"] = r.status_code
        upstream["reachable"] = r.status_code == 200
    except HTTPException:
        upstream["reachable"] = False
    except Exception as e:
        # Logged, not surfaced — no host/DNS details to the caller.
        logger.warning("health upstream probe failed: %s", e)
        upstream["reachable"] = False

    return {
        "status": "ok",
        "service": "sonic-mcp-client-backend",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": __version__,
        "upstream": upstream,
    }


@app.get("/api/ready")
async def ready() -> Any:
    """Proxies the MCP /ready probe so the UI can show device reachability."""
    r = await _mcp_get("/ready")
    try:
        body = r.json()
    except ValueError:
        body = {"_raw": r.text}
    return {"status_code": r.status_code, "body": body}


@app.get("/api/tools")
async def tools() -> List[Dict[str, Any]]:
    """Proxies the MCP tool catalog. UI uses this to build the tool picker."""
    r = await _mcp_get("/tools")
    if r.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"MCP /tools returned {r.status_code}: {r.text[:300]}",
        )
    return r.json()


@app.post("/api/invoke", dependencies=[Depends(require_client_auth)])
async def invoke(req: InvokeReq, request: Request) -> Dict[str, Any]:
    """Proxies tool invocations to the MCP server. Session header is forwarded."""
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    session = request.headers.get("x-mcp-session")
    if session:
        headers["X-MCP-Session"] = session

    body: Dict[str, Any] = {"tool": req.tool, "inputs": req.inputs}
    if req.context is not None:
        body["context"] = req.context
    if req.confirm:
        body["confirm"] = True

    r = await _mcp_post("/invoke", json_body=body, headers=headers)
    try:
        data = r.json()
    except ValueError:
        data = {"_raw": r.text}

    if r.status_code != 200:
        # Preserve the server's error envelope (FastAPI {detail: ...})
        detail = data.get("detail") if isinstance(data, dict) else None
        raise HTTPException(
            status_code=r.status_code,
            detail=detail or f"MCP /invoke returned {r.status_code}",
        )
    return data


@app.post("/api/nl", dependencies=[Depends(require_client_auth)])
async def nl(req: NlReq, request: Request, auto: bool = False) -> Dict[str, Any]:
    """Natural-language → tool routing. Returns the suggestion. If ?auto=true
    and a switch was identified, also invokes the tool and includes the result.

    Two-stage resolution:
      1. Deterministic regex router (nl_router.route) — fast, free, covers the 90% case.
      2. LLM fallback (OpenAI or Ollama) — invoked only when the regex router
         returns no match. Passes the live tool catalog + device list so the LLM
         has current context. Controlled by OPENAI_API_KEY / OLLAMA_ENABLED env.
    """
    routed = nl_route(req.text)
    llm_trace: Optional[Dict[str, Any]] = None

    if routed is None:
        # Try LLM fallback if any backend is configured
        if llm.openai_available() or llm.ollama_available():
            tools_list: list = []
            devices_list: list = []
            try:
                r = await _mcp_get("/tools")
                if r.status_code == 200:
                    tools_list = r.json()
            except Exception as e:
                logger.warning("llm fallback: /tools failed: %s", e)
            if LLM_INCLUDE_DEVICE_CONTEXT:
                try:
                    r = await _mcp_get("/ready")
                    body = r.json() if r.content else {}
                    for ip, d in (body.get("checks") or {}).get("devices", {}).items():
                        devices_list.append(
                            {
                                "switch_ip": ip,
                                "restconf_ok": bool(d.get("restconf")),
                                "ssh_ok": bool(d.get("ssh")),
                            }
                        )
                except Exception as e:
                    logger.warning("llm fallback: /ready failed: %s", e)

            llm_pick = await llm.select_tool(
                req.text, tools_list, devices_list, SWITCH_ALIASES
            )
            llm_trace = llm_pick
            if llm_pick and llm_pick.get("tool"):
                # Validate against catalog — don't trust the LLM blindly
                tool_name = llm_pick["tool"]
                catalog_names = {t.get("name") for t in tools_list}
                if tool_name in catalog_names:
                    suggestion = {
                        "tool": tool_name,
                        "inputs": llm_pick.get("inputs") or {},
                        "confidence": "low",  # LLM picks are less certain than regex
                        "reason": f"LLM ({llm_pick.get('_backend')}/{llm_pick.get('_model')}): "
                                  f"{llm_pick.get('reason', '')}",
                        "switch_ip": (llm_pick.get("inputs") or {}).get("switch_ip"),
                        "ambiguities": [],
                    }
                    out: Dict[str, Any] = {
                        "matched": True,
                        "source": "llm",
                        "llm_trace": llm_pick,
                        "text": req.text,
                        "suggestion": suggestion,
                    }

                    is_all_tool = tool_name.endswith("_all")
                    has_switch = "switch_ip" in (llm_pick.get("inputs") or {})
                    if auto and (is_all_tool or has_switch):
                        headers: Dict[str, str] = {"Content-Type": "application/json"}
                        session = request.headers.get("x-mcp-session")
                        if session:
                            headers["X-MCP-Session"] = session
                        body = {"tool": tool_name, "inputs": suggestion["inputs"]}
                        r = await _mcp_post("/invoke", json_body=body, headers=headers)
                        try:
                            out["result"] = r.json()
                        except ValueError:
                            out["result"] = {"_raw": r.text}
                        out["result_status"] = r.status_code
                    return out

        return {
            "matched": False,
            "text": req.text,
            "reason": (
                "no regex pattern matched and LLM fallback "
                + ("returned no usable tool" if llm_trace else "is not configured")
            ),
            "suggestion": None,
            "llm_trace": llm_trace,
        }

    suggestion = {
        "tool": routed.tool,
        "inputs": routed.inputs,
        "confidence": routed.confidence,
        "reason": routed.reason,
        "switch_ip": routed.switch_ip,
        "ambiguities": routed.ambiguities,
    }

    out: Dict[str, Any] = {
        "matched": True,
        # Explicit marker so the UI can show "regex" vs "llm" without
        # inferring from the absence of a field.
        "source": "regex",
        "text": req.text,
        "suggestion": suggestion,
    }

    # Pseudo-tool "help" is resolved entirely in this backend — no MCP round-trip.
    if routed.tool == "help":
        help_payload = await _build_help_payload()
        session_id = request.headers.get("x-mcp-session") or ""
        out["result"] = {
            "session_id": session_id,
            "result": {
                "tool": "help",
                "status": 200,
                "payload": help_payload,
                "context": {},
                "meta": {
                    "transport": "local",
                    "duration_ms": 0,
                    "risk": "SAFE_READ",
                },
                "explain": {"kind": "help"},
            },
        }
        out["result_status"] = 200
        return out

    # Auto-invoke rules:
    #   - `*_all` fan-out tools don't need a switch_ip (they target the whole inventory)
    #   - Single-device tools need `switch_ip` either in inputs or resolved from the utterance
    #   - Otherwise we skip auto-invoke and just return the suggestion
    is_all_tool = routed.tool.endswith("_all")
    can_auto_invoke = auto and (
        is_all_tool or (routed.switch_ip and "switch_ip" in routed.inputs)
    )

    if can_auto_invoke:
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        session = request.headers.get("x-mcp-session")
        if session:
            headers["X-MCP-Session"] = session
        body = {"tool": routed.tool, "inputs": routed.inputs}
        r = await _mcp_post("/invoke", json_body=body, headers=headers)
        try:
            out["result"] = r.json()
        except ValueError:
            out["result"] = {"_raw": r.text}
        out["result_status"] = r.status_code

    return out


@app.get("/api/examples")
async def examples() -> Dict[str, Any]:
    return {"examples": EXAMPLES}


async def _build_help_payload() -> Dict[str, Any]:
    """Gather live context for the help widget: devices from /ready,
    tool catalog from /tools, and a grouped/by-category tool index."""
    devices: List[Dict[str, Any]] = []
    ready_status: Optional[str] = None
    try:
        r = await _mcp_get("/ready")
        body = r.json() if r.content else {}
        ready_status = body.get("status")
        for ip, d in (body.get("checks") or {}).get("devices", {}).items():
            devices.append(
                {
                    "switch_ip": ip,
                    "restconf_ok": bool(d.get("restconf")),
                    "ssh_ok": bool(d.get("ssh")),
                }
            )
    except Exception as e:
        logger.warning("help: /ready failed: %s", e)

    tools: List[Dict[str, Any]] = []
    try:
        r = await _mcp_get("/tools")
        if r.status_code == 200:
            tools = r.json()
    except Exception as e:
        logger.warning("help: /tools failed: %s", e)

    # Group by category, preserving order of first appearance
    by_category: Dict[str, List[Dict[str, Any]]] = {}
    for t in tools:
        cat = t.get("category") or "other"
        by_category.setdefault(cat, []).append(
            {
                "name": t.get("name"),
                "description": t.get("description"),
                "transport": t.get("transport"),
                "risk": (t.get("policy") or {}).get("risk"),
                "required_inputs": (t.get("input_schema") or {}).get("required") or [],
            }
        )

    # Build contextual example prompts anchored on real device names.
    from nl_router import SWITCH_ALIASES

    alias_lookup: Dict[str, str] = {}
    for alias, ip in SWITCH_ALIASES.items():
        # Prefer shorter friendly aliases ("vm1") over IP literal keys.
        if "." in alias:
            continue
        alias_lookup.setdefault(ip, alias)

    contextual_examples: List[str] = []
    for d in devices[:2]:
        friendly = alias_lookup.get(d["switch_ip"], d["switch_ip"])
        contextual_examples.extend(
            [
                f"show bgp summary on {friendly}",
                f"show interfaces on {friendly}",
                f"system info for {friendly}",
            ]
        )
    if devices:
        # Multi-device / fan-out suggestion — present only when >1 device
        if len(devices) > 1:
            contextual_examples.append("system info for all switches")
        contextual_examples.append("show lldp neighbors on vm1")
        contextual_examples.append("run 'show platform summary' on vm1")
    if not contextual_examples:
        contextual_examples = list(EXAMPLES)

    return {
        "service": {
            "name": "SONiC MCP Community Client",
            "version": __version__,
            "ready_status": ready_status,
            "device_count": len(devices),
            "tool_count": len(tools),
        },
        "devices": devices,
        "tools": tools,
        "tools_by_category": by_category,
        "contextual_examples": contextual_examples,
        "tips": [
            {
                "text": "Pick a target switch in the top-right dropdown — its IP is pre-filled for every single-device tool.",
                "try": None,
            },
            {
                "text": "The AI Console understands natural phrasing; either verb-first or noun-first works.",
                "try": "show bgp summary on vm1",
            },
            {
                "text": "Every tool result has a widget / raw-JSON toggle on the top-right of the result panel.",
                "try": "show interfaces on vm1",
            },
            {
                "text": "The Tools view auto-generates an input form from each tool's JSON Schema. Required fields are marked with a red *.",
                "try": None,
            },
            {
                "text": "Tools whose name ends in _all fan out to every inventory device in parallel and return per-switch results.",
                "try": "system info for all switches",
            },
            {
                "text": "run_show_command is the escape hatch for arbitrary SONiC 'show …' commands (strictly allowlisted — no shell metacharacters).",
                "try": "run 'show platform summary' on vm1",
            },
            {
                "text": "LLDP on SONiC VS is known to receive no frames — the widget shows a clear warning banner with TX/RX counters when that happens.",
                "try": "show lldp neighbors on vm1",
            },
        ],
    }


@app.get("/api/help")
async def help_endpoint() -> Dict[str, Any]:
    """Context-aware help with real device names, live tool catalog, and tips."""
    return await _build_help_payload()


@app.get("/api/client-settings", dependencies=[Depends(require_client_auth)])
async def client_settings() -> Dict[str, Any]:
    """Backend configuration view. Gated by client auth because it reveals the
    upstream MCP URL and the proxy's auth posture."""
    return {
        "mcp_base_url": MCP_BASE_URL,
        "mcp_timeout_seconds": MCP_TIMEOUT,
        "version": __version__,
        "client_auth": "enabled" if CLIENT_API_KEY else "disabled",
        "upstream_auth": "enabled" if MCP_API_KEY else "disabled",
    }


@app.get("/api/openai-status")
async def openai_status() -> Dict[str, Any]:
    """Whether an OpenAI key is currently available."""
    return {"configured": llm.openai_available()}


class OpenAIKeyReq(BaseModel):
    api_key: Optional[str] = None


@app.post("/api/openai-key", dependencies=[Depends(require_client_auth)])
async def set_openai_key(req: OpenAIKeyReq) -> Dict[str, Any]:
    """Set or clear the OpenAI API key. Now persists to settings.json.
    Kept for backward compatibility with earlier Phase D clients; prefer
    PATCH /api/settings for new code."""
    settings_mod.update({"openai": {"api_key": req.api_key}})
    return {"configured": llm.openai_available()}


@app.get("/api/llm-status")
async def llm_status_endpoint() -> Dict[str, Any]:
    return llm.llm_status()


# ---- persisted settings ----

@app.get("/api/settings", dependencies=[Depends(require_client_auth)])
async def get_settings() -> Dict[str, Any]:
    """Safe view of persisted settings. API keys are redacted to `…last4`.
    Includes `*_source` fields so the UI can tell the user where each
    effective value comes from (settings.json, env, or default)."""
    return settings_mod.safe_view()


class SettingsPatch(BaseModel):
    openai: Optional[Dict[str, Any]] = None
    ollama: Optional[Dict[str, Any]] = None
    preferred_provider: Optional[str] = None  # "openai" | "ollama" | "auto"


def _validate_ollama_base_url(url: str) -> None:
    """Reject an operator-supplied Ollama URL that would create an SSRF hole.

    The backend later issues HTTP requests to this address, and the settings
    route can persist it. We keep it strict but lab-friendly: http/https only,
    no embedded credentials, a real host, and no cloud-metadata / link-local
    target. Private LAN IPs are allowed (Ollama is typically local).
    """
    if not url or not url.strip():
        return
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(422, "ollama base_url must use http or https")
    if parsed.username or parsed.password or "@" in (parsed.netloc or ""):
        raise HTTPException(422, "ollama base_url must not embed credentials")
    if not parsed.hostname:
        raise HTTPException(422, "ollama base_url must include a host")
    try:
        ip = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        ip = None
    if ip is not None and (ip.is_link_local or ip.is_multicast or ip.is_reserved):
        # 169.254.169.254 (cloud metadata) is link-local — blocked here.
        raise HTTPException(422, "ollama base_url points at a disallowed address")


@app.patch("/api/settings", dependencies=[Depends(require_client_auth)])
async def patch_settings(req: SettingsPatch) -> Dict[str, Any]:
    """Partial update. Send only the fields you want to change.
    To clear a value, send empty string or null.
    Examples:
        {"openai": {"api_key": "sk-…", "model": "gpt-4o"}}
        {"openai": {"api_key": ""}}                      # clear the key
        {"ollama": {"enabled": true, "base_url": "http://host:11434", "model": "qwen2.5:3b"}}
        {"preferred_provider": "openai"}                 # pin provider
        {"preferred_provider": "auto"}                   # automatic selection
    """
    update: Dict[str, Any] = {}
    if req.openai is not None:
        update["openai"] = req.openai
    if req.ollama is not None:
        if req.ollama.get("base_url"):
            _validate_ollama_base_url(str(req.ollama["base_url"]))
        update["ollama"] = req.ollama
    if req.preferred_provider is not None:
        if req.preferred_provider not in ("openai", "ollama", "auto"):
            raise HTTPException(
                status_code=422,
                detail="preferred_provider must be one of: openai, ollama, auto",
            )
        update["preferred_provider"] = req.preferred_provider
    if update:
        settings_mod.update(update)
    return settings_mod.safe_view()


# ---------------------------------------------------------------
# Fabric inventory — proxies the server's /inventory* endpoints so the
# web client can manage the switch list (add / remove / probe) without
# SSHing in or editing inventory.json by hand.
# ---------------------------------------------------------------

def _unwrap_or_raise(r: httpx.Response) -> Dict[str, Any]:
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail") or r.text
        except Exception:
            detail = r.text
        raise HTTPException(status_code=r.status_code, detail=detail)
    return r.json()


class _InventoryDeviceReq(BaseModel):
    name: str
    mgmt_ip: str
    tags: List[str] = []
    username: Optional[str] = None
    password: Optional[str] = None
    # Preferred over inline password: name of an env var on the SERVER that
    # holds the secret. Forwarded to the MCP server, which resolves it.
    password_env: Optional[str] = None


class _InventoryPutReq(BaseModel):
    switches: List[_InventoryDeviceReq]


class _InventoryProbeReq(BaseModel):
    mgmt_ip: str
    username: Optional[str] = None
    password: Optional[str] = None


@app.get("/api/inventory")
async def inventory_get() -> Dict[str, Any]:
    r = await _mcp_get("/inventory")
    return _unwrap_or_raise(r)


@app.put("/api/inventory", dependencies=[Depends(require_client_auth)])
async def inventory_put(req: _InventoryPutReq) -> Dict[str, Any]:
    body = {"switches": [s.model_dump() for s in req.switches]}
    r = await _mcp_put("/inventory", json_body=body)
    return _unwrap_or_raise(r)


@app.post("/api/inventory/switches", dependencies=[Depends(require_client_auth)])
async def inventory_add(req: _InventoryDeviceReq) -> Dict[str, Any]:
    r = await _mcp_post("/inventory/switches", json_body=req.model_dump())
    return _unwrap_or_raise(r)


@app.delete("/api/inventory/switches/{mgmt_ip}", dependencies=[Depends(require_client_auth)])
async def inventory_del(mgmt_ip: str) -> Dict[str, Any]:
    try:
        r = await _client().delete(f"/inventory/switches/{mgmt_ip}")
    except httpx.HTTPError as e:
        raise _upstream_error(e) from e
    return _unwrap_or_raise(r)


@app.post("/api/inventory/probe", dependencies=[Depends(require_client_auth)])
async def inventory_probe(req: _InventoryProbeReq) -> Dict[str, Any]:
    r = await _mcp_post("/inventory/probe", json_body=req.model_dump())
    return _unwrap_or_raise(r)


# ---------------------------------------------------------------
# Fabric intent file editor — proxies GET/PUT /fabric/intent on the MCP
# server so the web client can maintain the intent without SSHing in.
# ---------------------------------------------------------------

@app.get("/api/fabric-intent")
async def fabric_intent_get() -> Dict[str, Any]:
    r = await _mcp_get("/fabric/intent")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"MCP /fabric/intent returned {r.status_code}: {r.text[:300]}")
    return r.json()


class _FabricIntentPut(BaseModel):
    content: Optional[Dict[str, Any]] = None
    raw: Optional[str] = None


@app.put("/api/fabric-intent", dependencies=[Depends(require_client_auth)])
async def fabric_intent_put(req: _FabricIntentPut) -> Dict[str, Any]:
    body: Dict[str, Any] = {}
    if req.content is not None:
        body["content"] = req.content
    if req.raw is not None:
        body["raw"] = req.raw
    r = await _mcp_put("/fabric/intent", json_body=body)
    # Surface the server's 400-validation errors to the client verbatim so
    # the UI can show "invalid JSON at line 3" etc.
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail") or r.text
        except Exception:
            detail = r.text
        raise HTTPException(status_code=r.status_code, detail=detail)
    return r.json()


# ---------------------------------------------------------------
# Static frontend (single-port production mode)
# ---------------------------------------------------------------
# If `frontend/dist/` exists (i.e. the user ran `npm run build`), mount it
# so the whole app is available on this single port. If not, the app still
# works — clients just need to run Vite separately on :5173 during development.

_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if _FRONTEND_DIST.is_dir():
    logger.info("serving static frontend from %s", _FRONTEND_DIST)

    # Mount the hashed Vite asset directory first (highest priority).
    _assets_dir = _FRONTEND_DIST / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    _INDEX = _FRONTEND_DIST / "index.html"

    # SPA fallback — any GET that isn't an /api/* route and isn't an asset
    # should serve index.html so client-side routing works.
    @app.get("/", include_in_schema=False)
    async def _index() -> FileResponse:
        return FileResponse(_INDEX)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa_fallback(full_path: str) -> Any:
        # Never intercept API or docs routes.
        if full_path.startswith("api/") or full_path in {"docs", "redoc", "openapi.json"}:
            raise HTTPException(status_code=404)
        # Try a direct static file (favicon, robots.txt, etc.) before falling through.
        candidate = _FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_INDEX)
else:
    logger.info(
        "no frontend/dist/ found — backend will only serve /api/* routes. "
        "Run 'cd frontend && npm run build' to enable single-port mode."
    )
