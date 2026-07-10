"""HTTP-contract tests for the client backend (security-sensitive proxy).

Covers the trust boundaries the review called out: upstream MCP_API_KEY
forwarding, client-facing CLIENT_API_KEY gating, CORS, error sanitization,
settings persistence path, redaction, and password_env passthrough.
"""

from __future__ import annotations

import json

import httpx

from conftest import default_upstream, load_backend


class TestUpstreamKeyForwarding:
    def test_authorization_header_added_when_mcp_key_set(self, monkeypatch, tmp_path):
        m = load_backend(monkeypatch, tmp_path, mcp_key="upstream-secret")
        client = m._client()
        assert client.headers.get("authorization") == "Bearer upstream-secret"

    def test_no_authorization_header_when_mcp_key_unset(self, monkeypatch, tmp_path):
        m = load_backend(monkeypatch, tmp_path)
        client = m._client()
        assert "authorization" not in {k.lower() for k in client.headers}

    def test_key_actually_reaches_upstream(self, make_client):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["auth"] = request.headers.get("authorization")
            return httpx.Response(200, json={"session_id": "s", "result": {}})

        client, _ = make_client(mcp_key="up-key", handler=handler)
        # No client-facing key here, so /invoke is allowed through.
        r = client.post("/api/invoke", json={"tool": "get_system_info", "inputs": {}})
        assert r.status_code == 200
        assert seen["auth"] == "Bearer up-key"


class TestClientAuth:
    def test_public_routes_open_without_client_key(self, make_client):
        client, _ = make_client()
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/tools").status_code == 200

    def test_invoke_requires_client_key_when_set(self, make_client):
        client, _ = make_client(client_key="browser-secret")
        assert client.post("/api/invoke", json={"tool": "x", "inputs": {}}).status_code == 401

    def test_invoke_ok_with_client_key(self, make_client):
        client, _ = make_client(client_key="browser-secret")
        r = client.post(
            "/api/invoke",
            json={"tool": "get_system_info", "inputs": {}},
            headers={"Authorization": "Bearer browser-secret"},
        )
        assert r.status_code == 200

    def test_wrong_client_key_is_401(self, make_client):
        client, _ = make_client(client_key="browser-secret")
        r = client.post(
            "/api/invoke", json={"tool": "x", "inputs": {}},
            headers={"Authorization": "Bearer nope"},
        )
        assert r.status_code == 401

    def test_sensitive_writes_gated(self, make_client):
        client, _ = make_client(client_key="k")
        assert client.put("/api/inventory", json={"switches": []}).status_code == 401
        assert client.patch("/api/settings", json={"preferred_provider": "auto"}).status_code == 401
        assert client.post("/api/inventory/probe", json={"mgmt_ip": "1.2.3.4"}).status_code == 401
        assert client.get("/api/settings").status_code == 401
        assert client.get("/api/client-settings").status_code == 401


class TestCORS:
    def test_no_cors_by_default(self, make_client):
        client, _ = make_client()
        r = client.options(
            "/api/invoke",
            headers={"Origin": "https://evil.example",
                     "Access-Control-Request-Method": "POST"},
        )
        # Empty allow-list → no allow-origin echoed back.
        assert "access-control-allow-origin" not in {k.lower() for k in r.headers}

    def test_configured_origin_allows_authorization_preflight(self, make_client):
        client, _ = make_client(cors="http://localhost:5173")
        r = client.options(
            "/api/invoke",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
        assert "authorization" in r.headers.get("access-control-allow-headers", "").lower()


class TestErrorSanitization:
    def test_upstream_connect_error_is_generic(self, make_client):
        def handler(request):
            raise httpx.ConnectError("dial tcp 10.9.9.9:8000: connection refused")

        client, _ = make_client(handler=handler)
        r = client.get("/api/ready")
        assert r.status_code == 502
        body = json.dumps(r.json())
        assert "10.9.9.9" not in body          # no host/IP leak
        assert "request_id" in body

    def test_health_does_not_leak_mcp_url(self, make_client):
        client, _ = make_client()
        body = client.get("/api/health").json()
        assert "base_url" not in json.dumps(body)

    def test_upstream_401_propagates(self, make_client):
        def handler(request):
            if request.url.path == "/invoke":
                return httpx.Response(401, json={"detail": "Missing or invalid API key"})
            return default_upstream(request)

        client, _ = make_client(handler=handler)
        r = client.post("/api/invoke", json={"tool": "get_system_info", "inputs": {}})
        assert r.status_code == 401


class TestSettingsPersistence:
    def test_settings_written_to_configured_path(self, monkeypatch, tmp_path):
        load_backend(monkeypatch, tmp_path)
        import settings as settings_module
        settings_module.update({"preferred_provider": "openai"})
        expected = tmp_path / "data" / "settings.json"
        assert expected.exists()
        assert json.loads(expected.read_text())["preferred_provider"] == "openai"

    def test_api_key_redacted_in_safe_view(self, monkeypatch, tmp_path):
        load_backend(monkeypatch, tmp_path)
        import settings as settings_module
        settings_module.update({"openai": {"api_key": "sk-supersecret1234"}})
        view = settings_module.safe_view()
        blob = json.dumps(view)
        assert "sk-supersecret1234" not in blob
        assert view["openai"]["configured"] is True


class TestOllamaSSRF:
    def test_metadata_ip_rejected(self, make_client):
        client, _ = make_client()  # no client key → route open
        r = client.patch("/api/settings", json={"ollama": {"base_url": "http://169.254.169.254/"}})
        assert r.status_code == 422

    def test_non_http_scheme_rejected(self, make_client):
        client, _ = make_client()
        r = client.patch("/api/settings", json={"ollama": {"base_url": "file:///etc/passwd"}})
        assert r.status_code == 422

    def test_embedded_credentials_rejected(self, make_client):
        client, _ = make_client()
        r = client.patch("/api/settings", json={"ollama": {"base_url": "http://user:pass@host:11434"}})
        assert r.status_code == 422

    def test_normal_local_url_accepted(self, make_client):
        client, _ = make_client()
        r = client.patch("/api/settings", json={"ollama": {"base_url": "http://127.0.0.1:11434"}})
        assert r.status_code == 200


class TestInventoryPassthrough:
    def test_password_env_forwarded_to_upstream(self, make_client):
        seen = {}

        def handler(request):
            if request.url.path == "/inventory/switches":
                seen["body"] = json.loads(request.content)
                return httpx.Response(200, json={"path": "/x", "source": "file", "switches": []})
            return default_upstream(request)

        client, _ = make_client(handler=handler)
        r = client.post("/api/inventory/switches", json={
            "name": "spine1", "mgmt_ip": "10.0.0.9", "password_env": "SPINE1_PW",
        })
        assert r.status_code == 200
        assert seen["body"]["password_env"] == "SPINE1_PW"

    def test_inventory_get_has_no_plaintext_password(self, make_client):
        client, _ = make_client()
        body = client.get("/api/inventory").json()
        for s in body["switches"]:
            assert "password" not in s


class TestVersion:
    def test_health_reports_authoritative_version(self, make_client):
        from version import __version__
        client, _ = make_client()
        assert client.get("/api/health").json()["version"] == __version__
