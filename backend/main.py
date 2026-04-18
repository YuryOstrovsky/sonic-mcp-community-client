"""SONiC MCP Community Client — backend.

A thin, auth-less FastAPI proxy between the React frontend and the SONiC MCP
server. Mirrors the server's invoke envelope so the frontend doesn't need
to talk to two different contracts.

Routes:
  GET  /api/health          — client health + upstream MCP reachability
  GET  /api/ready           — proxies the MCP /ready probe
  GET  /api/tools           — proxies the MCP tool catalog
  POST /api/invoke          — proxies to MCP /invoke with session passthrough
  POST /api/nl              — deterministic NL router → suggests tool + inputs
                              (with ?auto=true, also invokes and returns the result)
  GET  /api/examples        — static list of example prompts for the UI
  GET  /api/client-settings — view MCP base URL + timeouts (read-only)
  GET  /api/openai-status   — stub: always reports disabled in Phase A

Phase A has no auth. Community deployment sits behind VPN / trusted network.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from nl_router import EXAMPLES, SWITCH_ALIASES, route as nl_route
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

app = FastAPI(title="SONiC MCP Community Client — backend")

# CORS: permissive in Phase A — server is behind VPN. Tighten in prod.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------
# Upstream MCP client (shared, connection-pooled)
# ---------------------------------------------------------------
_http: Optional[httpx.AsyncClient] = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(
            base_url=MCP_BASE_URL,
            timeout=MCP_TIMEOUT,
            headers={"Accept": "application/json"},
        )
    return _http


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _http
    if _http is not None:
        await _http.aclose()
        _http = None


async def _mcp_get(path: str, *, headers: Optional[Dict[str, str]] = None) -> httpx.Response:
    try:
        return await _client().get(path, headers=headers or {})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"MCP upstream error: {e}") from e


async def _mcp_post(
    path: str,
    *,
    json_body: Dict[str, Any],
    headers: Optional[Dict[str, str]] = None,
) -> httpx.Response:
    try:
        return await _client().post(path, json=json_body, headers=headers or {})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"MCP upstream error: {e}") from e


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
    whether the upstream MCP server responded on /health."""
    upstream: Dict[str, Any] = {"base_url": MCP_BASE_URL, "reachable": False}
    try:
        r = await _mcp_get("/health")
        upstream["status_code"] = r.status_code
        if r.status_code == 200:
            upstream["reachable"] = True
            upstream["body"] = r.json()
    except HTTPException as e:
        upstream["error"] = e.detail
    except Exception as e:
        upstream["error"] = str(e)

    return {
        "status": "ok",
        "service": "sonic-mcp-client-backend",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "0.1-phaseA",
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


@app.post("/api/invoke")
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


@app.post("/api/nl")
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
            "phase": "3b",
            "mcp_base_url": MCP_BASE_URL,
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


@app.get("/api/client-settings")
async def client_settings() -> Dict[str, Any]:
    """Read-only view of the backend's upstream configuration. Phase A has
    no write endpoints — edit .env and restart to change."""
    return {
        "mcp_base_url": MCP_BASE_URL,
        "mcp_timeout_seconds": MCP_TIMEOUT,
        "auth": "none",
        "phase": "A",
    }


@app.get("/api/openai-status")
async def openai_status() -> Dict[str, Any]:
    """Whether an OpenAI key is currently available."""
    return {"configured": llm.openai_available()}


class OpenAIKeyReq(BaseModel):
    api_key: Optional[str] = None


@app.post("/api/openai-key")
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

@app.get("/api/settings")
async def get_settings() -> Dict[str, Any]:
    """Safe view of persisted settings. API keys are redacted to `…last4`.
    Includes `*_source` fields so the UI can tell the user where each
    effective value comes from (settings.json, env, or default)."""
    return settings_mod.safe_view()


class SettingsPatch(BaseModel):
    openai: Optional[Dict[str, Any]] = None
    ollama: Optional[Dict[str, Any]] = None
    preferred_provider: Optional[str] = None  # "openai" | "ollama" | "auto"


@app.patch("/api/settings")
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
