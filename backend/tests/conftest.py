"""Shared fixtures for the client-backend test suite.

The backend is a proxy, so tests fake the upstream MCP server with an
httpx.MockTransport instead of reaching a real one. Each test reloads
`main` (and `settings`) after setting env, so module-level config
(CLIENT_API_KEY, MCP_API_KEY, CORS, settings path) is picked up fresh.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Callable, Optional

import httpx
import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def default_upstream(request: httpx.Request) -> httpx.Response:
    """A minimal fake MCP server covering the endpoints the proxy hits."""
    path = request.url.path
    if path == "/health":
        return httpx.Response(200, json={"status": "ok", "version": "0.1.0"})
    if path == "/tools":
        return httpx.Response(200, json=[{"name": "get_system_info", "policy": {}}])
    if path == "/ready":
        return httpx.Response(200, json={"status": "ready", "checks": {"devices": {}}})
    if path == "/invoke":
        return httpx.Response(200, json={"session_id": "s1", "result": {"ok": True}})
    if path == "/inventory":
        return httpx.Response(200, json={
            "path": "/x", "source": "file",
            "switches": [{"name": "l1", "mgmt_ip": "10.0.0.1", "has_password": True}],
        })
    if path.startswith("/inventory/switches"):
        return httpx.Response(200, json={"path": "/x", "source": "file", "switches": []})
    if path == "/inventory/probe":
        return httpx.Response(200, json={"mgmt_ip": "10.0.0.1", "restconf": True, "ssh": True})
    if path == "/fabric/intent":
        return httpx.Response(200, json={"exists": False, "content": None})
    return httpx.Response(404, json={"detail": "not found"})


def load_backend(
    monkeypatch,
    tmp_path,
    *,
    client_key: Optional[str] = None,
    mcp_key: Optional[str] = None,
    cors: Optional[str] = None,
    env: Optional[dict] = None,
):
    """Reload `settings` then `main` with a clean, test-controlled env."""
    for var in ("CLIENT_API_KEY", "MCP_API_KEY", "CLIENT_CORS_ORIGINS",
                "LLM_INCLUDE_DEVICE_CONTEXT"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("CLIENT_SETTINGS_PATH", str(tmp_path / "data" / "settings.json"))
    if client_key:
        monkeypatch.setenv("CLIENT_API_KEY", client_key)
    if mcp_key:
        monkeypatch.setenv("MCP_API_KEY", mcp_key)
    if cors is not None:
        monkeypatch.setenv("CLIENT_CORS_ORIGINS", cors)
    for k, v in (env or {}).items():
        monkeypatch.setenv(k, v)

    import settings as settings_module
    importlib.reload(settings_module)
    import main as main_module
    importlib.reload(main_module)
    return main_module


def attach_upstream(main_module, handler: Callable[[httpx.Request], httpx.Response]):
    """Point the proxy's shared upstream client at a MockTransport.

    Mirrors main._client()'s header logic (including MCP_API_KEY forwarding)
    so tests exercise the real behavior, not a stripped-down client.
    """
    headers = {"Accept": "application/json"}
    if main_module.MCP_API_KEY:
        headers["Authorization"] = f"Bearer {main_module.MCP_API_KEY}"
    main_module._http = httpx.AsyncClient(
        base_url=main_module.MCP_BASE_URL,
        transport=httpx.MockTransport(handler),
        headers=headers,
    )
    return main_module


@pytest.fixture
def make_client(monkeypatch, tmp_path):
    """Factory: build a TestClient with chosen auth/env and a fake upstream."""
    def _make(*, client_key=None, mcp_key=None, cors=None, env=None, handler=None):
        m = load_backend(monkeypatch, tmp_path, client_key=client_key,
                         mcp_key=mcp_key, cors=cors, env=env)
        attach_upstream(m, handler or default_upstream)
        return TestClient(m.app), m
    return _make
