# SONiC MCP Community Client

Web UI + thin API proxy for the
[**SONiC MCP Community Server**](https://github.com/YuryOstrovsky/sonic-mcp-community-server).
Gives operators (and AI agents) a dark, keyboard-first front-end for
every tool the server exposes — plus a live fabric topology graph, an
editable mutation-confirm modal, a command palette, and natural-
language routing with optional LLM fallback.

This is a **separate product** from the server — use it against any
compatible endpoint on a trusted network.

> This UI is one way to drive the server. As of server **v0.2.0** the server
> also speaks **standard MCP** (stdio + Streamable HTTP at `/mcp`), so you can
> point Claude Desktop or any MCP agent straight at the server too — the UI and
> MCP clients share the same tools. This client uses the server's REST API.

- **GitHub (this repo):** https://github.com/YuryOstrovsky/sonic-mcp-community-client
- **GitHub (server):** https://github.com/YuryOstrovsky/sonic-mcp-community-server
- **Docker Hub (client):** [`extremecanada/sonic-mcp-community-client`](https://hub.docker.com/r/extremecanada/sonic-mcp-community-client)
- **Docker Hub (server):** [`extremecanada/sonic-mcp-community-server`](https://hub.docker.com/r/extremecanada/sonic-mcp-community-server)

---

## What's in the box

**Six views**, all served off a single port (`5174` by default):

| View | What it does |
|---|---|
| **Dashboard** | At-a-glance health: server reachability, device status, per-switch operational summary (BGP, interfaces, LLDP), tools registered, auto-refresh with a live fabric-health badge in the header. |
| **Fabric** | `get_fabric_topology` rendered as a reactflow graph. Nodes = switches, edges = BGP/LLDP adjacencies. Click a node → detail panel with ASN, router-id, and adjacencies. |
| **AI Console** | Chat-style NL interface. Regex router maps free text to a tool + inputs; off-script queries fall through to an LLM (OpenAI or Ollama, configured in Settings). Results render as rich per-tool widgets. History persists across reloads (last 50 turns; has a **Clear** button). |
| **Tools** | Full catalog with search, auto-generated forms from each tool's JSON Schema, policy risk pills, live result in the matching widget. |
| **Activity** | Server-side mutation ledger: timestamp, tool, switch, status, pre/post state. Search, filter by status/tool/switch, row actions (rollback supported mutations with one click). |
| **Settings** | Active LLM provider (Auto / OpenAI / Ollama), API keys, model picker, **live fabric-intent editor** with Save / Validate / Reload, and a **Fabric Inventory** section (add / remove / probe switches, LLDP seed-walk discovery with an approval dialog). |

**Cross-cutting features**

- **Command palette** (⌘K / Ctrl-K) — fuzzy search every tool, jump to any view, pick a switch.
- **Confirm-mutation modal** with editable inputs and **live combobox suggestions** fetched from the target switch (interface names, VLAN IDs, BGP peers, etc.).
- **Row actions (`⋯`)** on Interfaces / BGP / Activity tables — one-click shutdown / MTU / description / rollback, all routed through the same confirm modal.
- **Export** every result as JSON / Markdown / CSV — copy or download.
- **Structured error cards** classifying common failures (auth / timeout / requires confirmation / unreachable) with copy + activity-jump actions.
- **Toast notifications** for mutation success/failure, copies, downloads.
- **Virtualized tables** when a widget lands >200 rows (LLDP / ARP on a large fabric).
- **Auto-refresh** (off / 30s / 60s / 120s) — polls `get_fabric_health` in the background and flips the header dot red on drift.
- **Fabric inventory** — manage which switches the MCP server can reach directly from the UI. Add / remove / probe entries, override per-device credentials, or run an LLDP seed-walk (`discover_fabric_from_seed`) to propose neighbors for bulk-add after an approval review.

---

## Architecture

```
┌───────────┐   HTTP   ┌───────────────────────────────┐   HTTP   ┌───────────────────┐
│  Browser  │ ───────> │ SONiC MCP Community Client    │ ───────> │  MCP Server       │
│  (UI)     │ <─────── │  FastAPI backend on :5174     │ <─────── │  /tools, /invoke, │
│           │          │  Serves built React from /    │          │  /ready, /metrics │
└───────────┘          │  Thin /api/* proxy            │          └──────────┬────────┘
                       │  NL router + LLM fallback     │                     │ 3 transports
                       └───────────────────────────────┘                     ▼
                                                                 ┌───────────────────┐
                                                                 │  SONiC switches   │
                                                                 └───────────────────┘
```

The client does **not persist** device credentials. Credentials entered
during inventory add/probe pass **through** the backend to the MCP server
(and should be used only over a trusted network); prefer `password_env` (a
server-side env var name) over inline passwords. The client's only
persistent state is `settings.json` (LLM preferences, an optional OpenAI
key), stored under `./data`.

---

## Security and intended use

> ⚠️ **This client can invoke network-management tools and edit stored API
> keys through the MCP server.** Read this before exposing it.

- **Not for public exposure.** Docker/Compose bind to **`127.0.0.1` by
  default** — do not publish port 5174 to the Internet. For LAN access, front
  it with an authenticated reverse proxy (SSO / OAuth2-proxy / Authelia / basic
  auth).
- **Two auth boundaries** — keep the secrets distinct:
  `Browser → CLIENT_API_KEY → client backend → MCP_API_KEY → MCP server`.
  Set `MCP_API_KEY` to match the server; set `CLIENT_API_KEY` to gate this
  proxy's sensitive routes. When `CLIENT_API_KEY` is unset the backend logs a
  warning and relies on the localhost bind / reverse proxy.
- **Sending the client key from the UI:** when `CLIENT_API_KEY` is set, open
  **Settings → Client authentication** and enter the key. It's held in
  `sessionStorage` only (cleared on tab close, never written to disk). For
  shared/multi-user deployments, prefer an **authenticating reverse proxy**
  (SSO / OAuth2-proxy / Authelia / basic auth) that injects the `Authorization`
  header, rather than distributing the key to browsers.
- **External LLM disclosure:** with OpenAI selected, an unmatched NL query
  sends the query and tool descriptions to OpenAI. Device context (management
  IPs) is **withheld by default** (`LLM_INCLUDE_DEVICE_CONTEXT=0`); set `1` to
  opt in. Use Ollama or disable LLM fallback for fully local operation. Never
  put credentials or confidential data in NL prompts.

See [`SECURITY.md`](./SECURITY.md) for the full policy and private reporting.

---

## Quickstart

Three ways, from easiest to most hands-on.

### A. Docker (recommended)

**Pull the published image** (no build required):

```bash
docker pull extremecanada/sonic-mcp-community-client:latest
```

Or build from source:

```bash
cp backend/.env.example .env
# Edit .env and set MCP_BASE_URL to your server's URL
docker compose up -d --build
open http://<host>:5174/
```

The shipped `docker-compose.yml` references
`extremecanada/sonic-mcp-community-client:latest` by default, so
`docker compose up -d` pulls from Docker Hub if no local image is built.

See [`README.docker.md`](./README.docker.md) for install / stop / update
/ rebuild details, networking patterns, upgrade procedure, and
troubleshooting — in particular, the
[localhost-inside-a-container pitfall](./README.docker.md#6-networking-patterns)
that's the #1 cause of `502 Bad Gateway` errors.

### B. systemd (bare-metal)

```bash
# 1. Backend deps
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # edit MCP_BASE_URL

# 2. Build the frontend once
cd ../frontend
npm ci && npm run build

# 3. Install the systemd unit
sudo cp ../systemd/sonic-mcp-client.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sonic-mcp-client.service
```

See [`systemd/README.md`](./systemd/README.md) for operations.

### C. Manual / dev mode

```bash
# Single-port production mode
cd backend && source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 5174
# Open http://<host>:5174/

# With Vite hot-reload (two terminals)
cd backend && uvicorn main:app --port 5174 --reload
cd frontend && npm run dev   # http://<host>:5173
```

---

## Configuration

All settings are env vars loaded from `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `MCP_BASE_URL` | `http://127.0.0.1:8000` | URL of the SONiC MCP Community Server |
| `MCP_TIMEOUT_SECONDS` | `30` | HTTP timeout for upstream calls |
| `MCP_API_KEY` | — | Upstream server key, forwarded as `Authorization: Bearer`. Match the server's `MCP_API_KEY`. Backend-only — never sent to the browser. |
| `CLIENT_API_KEY` | — | Gates sensitive `/api` routes (Bearer). Unset = no client auth (logs a warning). A **different** secret from `MCP_API_KEY`. |
| `CLIENT_CORS_ORIGINS` | — (empty) | Comma-separated allowed origins. Empty = no cross-origin (single-port prod). Vite dev: `http://localhost:5173`. |
| `CLIENT_SETTINGS_PATH` | `backend/data/settings.json` | Where UI settings persist (inside the mounted volume). |
| `LLM_INCLUDE_DEVICE_CONTEXT` | `0` | Include device IPs/reachability in external-LLM prompts. Default withholds them; set `1` to opt in for better tool selection. |
| `SONIC_MCP_CLIENT_PORT` | `5174` | Port to bind uvicorn to (in Docker this is the `EXPOSE`/`-p` mapping) |
| `OPENAI_API_KEY` | — | Optional — preferred over the UI-set key if present |
| `OPENAI_MODEL` | `gpt-4o-mini` | Default OpenAI model |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama endpoint when enabled (validated: http/https, no creds, no metadata IPs) |
| `OLLAMA_MODEL` | `qwen2.5:3b-instruct` | Default Ollama model |

Runtime settings (LLM provider pick, API keys, Ollama model choice) can
also be changed live from the **Settings** view; they're persisted to
`backend/data/settings.json` (mode 0600) so they survive restarts.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| **⌘K** / **Ctrl-K** | Open command palette (fuzzy search tools / views / switches) |
| `Esc` | Close modal / command palette |
| `↵` | Submit in AI Console |
| `↑ ↓` | Navigate palette items |

---

## Adding a widget / NL pattern

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). In short:

1. Write `frontend/src/widgets/MyToolWidget.tsx` and register it in
   `widgets/index.tsx` (one line in the REGISTRY map).
2. Add a regex pattern block to `backend/nl_router.py` so free-text
   prompts route to your tool, plus an input-extraction clause if the
   tool has required args.
3. Add an entry to `HelpWidget`'s `TOOL_TO_QUERY` so the Help view gets
   a clickable "Run" button.

The client auto-discovers tools from the server's catalog — there's no
list to hand-edit when the server adds a new tool. Widgets are opt-in
enhancements; anything without a dedicated widget falls back to a
pretty JSON view.

---

## Development

```bash
cd frontend
npm ci
npm run lint       # eslint
npm run build      # tsc -b && vite build
npm run dev        # Vite dev server at :5173
```

CI (GitHub Actions) runs, on every PR: frontend ESLint + build + `npm audit`,
backend ruff + pytest, `pip-audit`, and a Docker image build + Trivy scan +
boot smoke. Dependabot keeps deps, Actions, and base images fresh.

---

## Compatibility

The client and server are released with **matching versions** — run a client
`0.1.x` against a server `0.1.x`. The client auto-discovers tools from the
server's `/tools` catalog, so it adapts to whatever tools the connected server
version exposes.

| Client | Server | Status |
|---|---|---|
| 0.1.x | 0.1.x | ✅ Supported |
| 0.1.x | other 0.x | ⚠️ Best-effort — reads work; newer server-only tools may lack a dedicated widget (fall back to JSON view) |

Auth: when the server has `MCP_API_KEY` set, the client must be given the same
value via its own `MCP_API_KEY` (see Configuration).

---

## Screenshots

<img width="1000" alt="Dashboard — server reachability, per-switch health (BGP/interfaces/LLDP), and a live fabric-health badge"
  src="https://github.com/user-attachments/assets/418053fd-21d6-41ea-8e23-5b1f7df1fe9e" />

<img width="1000" alt="Fabric view — topology graph of switches with BGP/LLDP adjacencies"
  src="https://github.com/user-attachments/assets/92184616-1bb7-4fc2-8418-23074f6cd481" />

<img width="1000" alt="AI Console — natural-language tool routing with rich per-tool result widgets"
  src="https://github.com/user-attachments/assets/9a0da236-8865-47b8-9e12-2f0fa7086eae" />

<img width="1000" alt="Settings — LLM provider selection, live fabric-intent editor, and fabric inventory management"
  src="https://github.com/user-attachments/assets/7a4a7d73-6090-4d63-a0c5-67cf4b66f3fd" />

---

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
