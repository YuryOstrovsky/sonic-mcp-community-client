# SONiC MCP Community Client

Web UI + lightweight API backend for the [SONiC MCP Community Server](../sonic-mcp-community-server/).

Read-only, no auth, community-grade. Designed to run alongside the server on a trusted-network host.

## Status

- **Phase A (shipped):** minimal backend proxy — `/api/health`, `/api/tools`, `/api/invoke`, `/api/nl` (regex-based), `/api/examples`, `/api/ready`.
- **Phase B (shipped):** real frontend shell — left sidebar, top-bar switch picker, three views (Dashboard, AI Console, Tools).
- **Phase C (shipped):** SONiC-shaped widgets — `InterfacesWidget`, `IpInterfacesWidget`, `RoutesWidget` (used for both IPv4 and IPv6), `BgpSummaryWidget`, `LldpWidget`, `SystemInfoWidget`, `ShowCommandWidget`. Every `/invoke` result flows through a `ToolResultPanel` that picks the right widget and offers a widget ↔ raw JSON toggle.
- **Phase D (next):** LLM fallback (OpenAI / Ollama) in the NL router for queries outside the regex surface.

## Layout

```
backend/                FastAPI proxy (~300 lines, no auth)
  main.py               Routes
  nl_router.py          Regex-based NL → tool mapping (SONiC intents)
  requirements.txt
  .env.example
  README.md
frontend/               Vite + React 19 + TypeScript + Tailwind
  src/
    App.tsx             App shell (placeholder in Phase A)
    lib/api.ts          Minimal HTTP wrapper + session handling
    lib/figmaStyles.ts  Design tokens (preserved from prior project)
    index.css           Tailwind + CSS custom properties
    App.css             Animations
  index.html
  package.json
  vite.config.ts        Already binds 0.0.0.0:5173 with /api proxy
_legacy/                Quarantined XCO enterprise client for reference
```

## Quick start — single port (recommended)

One port, one URL, no Vite dev server. This is how you'll usually run it.

```bash
# 1) Backend dependencies
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env        # edit MCP_BASE_URL if it's not http://127.0.0.1:8000

# 2) Build the frontend once (static bundle into frontend/dist/)
cd ../frontend
npm ci
npm run build

# 3) Launch the backend — it auto-serves the built frontend from /
cd ../backend
source .venv/bin/activate    # if not already active
uvicorn main:app --host 0.0.0.0 --port 5174
```

Now open `http://<server-ip>:5174/` from your Mac. Rebuild the frontend (`npm run build`)
whenever you change React code; the backend picks up the new `dist/` on the next
page refresh.

### Run as a systemd service (recommended for "always on")

```bash
sudo cp systemd/sonic-mcp-client.service /etc/systemd/system/sonic-mcp-client.service
sudo systemctl daemon-reload
sudo systemctl enable --now sonic-mcp-client
systemctl status sonic-mcp-client --no-pager
journalctl -u sonic-mcp-client -f
```

See `systemd/README.md` for full install/uninstall/operations. Note: the
OpenAI key set via the UI is runtime-only — put it in `backend/.env` as
`OPENAI_API_KEY=sk-…` to survive service restarts.

## Alternative — dev mode with hot reload

Only useful when you're actively editing React code and want live reload.

```bash
# Terminal 1: backend (no need to build the frontend)
cd backend && source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 5174 --reload

# Terminal 2: Vite dev server on :5173 (proxies /api to :5174)
cd frontend && npm run dev
```

Open `http://<server-ip>:5173/`. Code changes hot-reload.

## End-to-end smoke

```bash
curl -sS http://127.0.0.1:5174/api/health | jq
curl -sS http://127.0.0.1:5174/api/tools  | jq '.[] | .name'
curl -sS -X POST http://127.0.0.1:5174/api/invoke \
  -H "Content-Type: application/json" \
  -d '{"tool":"get_system_info","inputs":{"switch_ip":"10.46.11.50"}}' | jq
curl -sS -X POST "http://127.0.0.1:5174/api/nl?auto=true" \
  -H "Content-Type: application/json" \
  -d '{"text":"show bgp summary on vm1"}' | jq
```

## Architecture

```
Mac browser ──► http://server-ip:5173 (Vite)
                   │
                   └── /api/* (Vite proxy) ──► http://127.0.0.1:5174 (FastAPI)
                                                        │
                                                        └── http://127.0.0.1:8000 (SONiC MCP server)
                                                                                     │
                                                                                     ├── RESTCONF :443 ──► SONiC VMs
                                                                                     └── SSH :22       ──► SONiC VMs
```

## Related

- `../sonic-mcp-community-server/PLAN.md` — server-side phased plan
- `../sonic-mcp-community-server/CLIENT_CONTRACT.md` — protocol spec the client consumes
