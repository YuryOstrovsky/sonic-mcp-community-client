"""LLM fallback for NL tool selection.

When the deterministic regex router in nl_router.py doesn't match a query,
this module asks an LLM (OpenAI cloud if an API key is available, Ollama
local if enabled) to pick a tool from the live catalog.

Configuration source-of-truth is `settings.py`, which layers:
    settings.json  >  env vars  >  hardcoded defaults

The LLM is instructed to reply with strict JSON:
    {"tool": "<name|null>", "inputs": {...}, "reason": "<one sentence>"}
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

import httpx

import settings

logger = logging.getLogger("mcp-client.llm")


def openai_available() -> bool:
    return bool(settings.get_openai_key())


def ollama_available() -> bool:
    return settings.get_ollama_enabled()


def llm_status() -> Dict[str, Any]:
    """Compact status — used by /api/llm-status. The full safe view with
    sources lives in settings.safe_view() and is returned by /api/settings."""
    return {
        "openai": {"configured": openai_available(), "model": settings.get_openai_model()},
        "ollama": {"enabled": ollama_available(), "base_url": settings.get_ollama_base_url(), "model": settings.get_ollama_model()},
        "preferred_provider": settings.get_preferred_provider(),
        "effective_provider": settings.compute_effective_provider(),
        # Legacy alias — older UI builds read this
        "preference": settings.compute_effective_provider(),
    }


# ---- prompts -------------------------------------------------------
_SYSTEM_PROMPT = """You are a tool-selector for a SONiC network-switch MCP server.
Given a user's natural-language query about a SONiC switch lab, pick the single
best tool from the catalog and fill in its inputs.

Rules:
- switch_ip must match one of the management IPs listed under "switches" — not a nickname.
  If the user names a switch by alias (e.g. "vm1", "sonic-vm1"), translate to its IP.
- If the user asks about "all switches" / "across the fabric" / "every device", prefer
  a tool whose name ends with "_all" — those fan out across the whole inventory and
  take an optional switch_ips array but no single switch_ip.
- For run_show_command, the "command" input must start with "show ".
- If no available tool fits the query, return {"tool": null, ...}.

Respond with strictly-valid JSON, no markdown, no prose:
  {"tool": "<tool_name_or_null>", "inputs": {...}, "reason": "<one short sentence>"}
"""


def _summarize_catalog(tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for t in tools:
        schema = t.get("input_schema") or {}
        props = schema.get("properties") or {}
        out.append(
            {
                "name": t.get("name"),
                "category": t.get("category"),
                "transport": t.get("transport"),
                "description": t.get("description"),
                "inputs": {
                    k: {
                        "type": (v or {}).get("type"),
                        "required": k in (schema.get("required") or []),
                        "description": (v or {}).get("description", "")[:160],
                    }
                    for k, v in props.items()
                },
            }
        )
    return out


def _build_user_prompt(
    user_text: str,
    tools: List[Dict[str, Any]],
    devices: List[Dict[str, Any]],
    switch_aliases: Dict[str, str],
) -> str:
    alias_rev: Dict[str, List[str]] = {}
    for alias, ip in switch_aliases.items():
        if "." in alias:
            continue
        alias_rev.setdefault(ip, []).append(alias)

    switch_list = [
        {
            "switch_ip": d["switch_ip"],
            "aliases": sorted(set(alias_rev.get(d["switch_ip"], []))),
            "reachable": bool(d.get("restconf_ok") or d.get("ssh_ok")),
        }
        for d in devices
    ]
    return json.dumps(
        {
            "user_query": user_text,
            "switches": switch_list,
            "tools": _summarize_catalog(tools),
        },
        indent=2,
    )


# ---- providers -----------------------------------------------------
async def _openai_select(user_text: str, tools, devices, switch_aliases) -> Optional[Dict[str, Any]]:
    key = settings.get_openai_key()
    if not key:
        return None
    model = settings.get_openai_model()
    url = "https://api.openai.com/v1/chat/completions"
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(user_text, tools, devices, switch_aliases)},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(url, json=body, headers=headers)
        if r.status_code != 200:
            logger.warning("openai %s: %s", r.status_code, r.text[:300])
            return None
        data = r.json()
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or "{}"
        parsed = json.loads(content)
        return {**parsed, "_backend": "openai", "_model": model}
    except Exception as e:
        logger.exception("openai call failed: %s", e)
        return None


async def _ollama_select(user_text: str, tools, devices, switch_aliases) -> Optional[Dict[str, Any]]:
    base = settings.get_ollama_base_url().rstrip("/")
    model = settings.get_ollama_model()
    url = f"{base}/api/chat"
    body = {
        "model": model,
        "stream": False,
        "format": "json",
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(user_text, tools, devices, switch_aliases)},
        ],
        "options": {"temperature": 0.1},
    }
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(url, json=body)
        if r.status_code != 200:
            logger.warning("ollama %s: %s", r.status_code, r.text[:300])
            return None
        data = r.json()
        content = (data.get("message") or {}).get("content") or "{}"
        parsed = json.loads(content)
        return {**parsed, "_backend": "ollama", "_model": model}
    except Exception as e:
        logger.exception("ollama call failed: %s", e)
        return None


async def select_tool(
    user_text: str,
    tools: List[Dict[str, Any]],
    devices: List[Dict[str, Any]],
    switch_aliases: Dict[str, str],
) -> Optional[Dict[str, Any]]:
    """Route NL → tool via the effective LLM provider.

    Respects settings.preferred_provider:
      - 'openai' → only OpenAI (no Ollama fallback even if available)
      - 'ollama' → only Ollama (no OpenAI fallback even if a key is set)
      - 'auto'   → OpenAI first, Ollama second (existing behavior)
    """
    pref = settings.get_preferred_provider()

    if pref == "openai":
        if openai_available():
            return await _openai_select(user_text, tools, devices, switch_aliases)
        return None
    if pref == "ollama":
        if ollama_available():
            return await _ollama_select(user_text, tools, devices, switch_aliases)
        return None

    # auto
    if openai_available():
        got = await _openai_select(user_text, tools, devices, switch_aliases)
        if got is not None:
            return got
    if ollama_available():
        return await _ollama_select(user_text, tools, devices, switch_aliases)
    return None
