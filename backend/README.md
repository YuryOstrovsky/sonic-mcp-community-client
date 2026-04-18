# SONiC MCP Community Client — Backend

A thin FastAPI proxy between the React frontend and the SONiC MCP server.
No auth. Community-grade. Sits behind VPN / trusted network.

## Run

```bash
cd /home/user01/sonic-mcp-community-client/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env      # edit MCP_BASE_URL if needed
uvicorn main:app --host 0.0.0.0 --port 5174
```

If `../frontend/dist/` exists (i.e. someone ran `npm run build`), this same
port also serves the UI at `/`. Otherwise only the `/api/*` routes respond.
Use `--reload` during Python code iteration.

Health check:
```bash
curl -sS http://127.0.0.1:5174/api/health | jq .
```

## API surface (Phase A)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Backend status + MCP upstream reachability |
| `/api/ready` | GET | Proxies MCP `/ready` (device reachability) |
| `/api/tools` | GET | Proxies MCP tool catalog |
| `/api/invoke` | POST | Proxies MCP `/invoke` (session header forwarded) |
| `/api/nl` | POST | Natural-language → tool suggestion. `?auto=true` to invoke immediately. |
| `/api/examples` | GET | Canned example prompts for the UI |
| `/api/client-settings` | GET | Read-only: MCP base URL, timeout, auth mode |
| `/api/openai-status` | GET | LLM fallback status (stub in Phase A) |

## Smoke test against the running MCP server

```bash
export CB=http://127.0.0.1:5174

curl -sS $CB/api/health | jq
curl -sS $CB/api/ready  | jq
curl -sS $CB/api/tools  | jq '.[] | .name'

# Direct invoke
curl -sS -X POST $CB/api/invoke \
  -H "Content-Type: application/json" \
  -d '{"tool":"get_system_info","inputs":{"switch_ip":"10.46.11.50"}}' | jq

# NL — suggestion only
curl -sS -X POST $CB/api/nl \
  -H "Content-Type: application/json" \
  -d '{"text":"show interfaces on vm1"}' | jq

# NL — auto-invoke
curl -sS -X POST "$CB/api/nl?auto=true" \
  -H "Content-Type: application/json" \
  -d '{"text":"bgp summary on vm1"}' | jq
```

## What's intentionally NOT here (vs. the XCO enterprise client)

- OAuth2 / JWT / token refresh / RBAC
- `/api/plans/*` (change management) — MCP server has no mutation tools yet
- `/api/admin/*` — no multi-tenancy, no user/client management
- Audit ledger
- Multi-site registry
- Firmware SSH browsing
- Ollama / OpenAI routing (deferred to Phase D)

This is the **community-grade** client: safe-read tools only, single-server,
no users.
