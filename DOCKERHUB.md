# SONiC MCP Community Client

Web UI + thin API proxy for the
[`extremecanada/sonic-mcp-community-server`](https://hub.docker.com/r/extremecanada/sonic-mcp-community-server).
A dark, keyboard-first dashboard with a live fabric topology graph, an
AI console with regex routing + optional LLM fallback, an editable
mutation-confirm modal, and a command palette — all served on a single
port.

---

## 📂 Before you pull — host directory

The image runs as non-root user `mcpc` (**uid 1000**). If a bind-mount
source doesn't exist when the container starts, Docker creates it as
`root` and the container user can't write to it. Symptom: the Settings
view saves silently fail — the OpenAI key and LLM provider choice
disappear on the next restart. Pre-create the dir so it lands with
sensible ownership:

```bash
mkdir -p data

# Most dev machines already have uid 1000 as the first user — check:
id -u                # if this prints 1000, you're done

# If your uid is different, align ownership with the container user:
sudo chown -R 1000:1000 data
```

| Host dir  | What lives there                                             |
|-----------|--------------------------------------------------------------|
| `./data/` | `settings.json` — active LLM provider + optional OpenAI key  |

Nothing switch-facing is stored here; switch credentials live on the
MCP server side.

---

## 🚀 Quick start

```bash
docker pull extremecanada/sonic-mcp-community-client:latest

docker run -d --name sonic-mcp-client \
  -p 5174:5174 \
  -e MCP_BASE_URL=http://<your-mcp-server>:8000 \
  -v $(pwd)/data:/app/backend/data \
  --add-host=host.docker.internal:host-gateway \
  extremecanada/sonic-mcp-community-client:latest

# then open:  http://<host>:5174/
```

`MCP_BASE_URL` is the only required setting.

---

## ⚠ Common pitfall: `localhost` has two meanings in Docker

The most frequent setup failure is `MCP_BASE_URL=http://localhost:8000`
or `http://127.0.0.1:8000`. Inside the container, `localhost` is the
**container's own loopback** — not your host. The MCP server isn't
there, so every `/api/*` call returns `502 Bad Gateway`.

There are two separate "localhost"s in play:

| Who says `localhost`        | What it means                                            |
|-----------------------------|----------------------------------------------------------|
| Your **browser** → `:5174/` | The host's port 5174 → Docker-mapped to the client ✓     |
| The **client container** → `MCP_BASE_URL` | The container's own loopback ✗ (no MCP server there) |

Pick the pattern that matches your deployment:

| Deployment                                    | Correct `MCP_BASE_URL`                                       |
|-----------------------------------------------|--------------------------------------------------------------|
| Server runs on the host, outside Docker       | `http://host.docker.internal:8000` (use `--add-host=host.docker.internal:host-gateway` on Linux) |
| Server runs in its own container, same host   | `http://sonic-mcp:8000` (both containers on the same user-defined Docker network, referenced by container name) |
| Server runs on a remote host                  | `http://<server-lan-ip>:8000`                                |
| **Anything with `localhost` / `127.0.0.1`**   | **Broken — don't.**                                          |

If you see `502` in the UI and `ECONNREFUSED` in `docker logs`, this is
almost always the cause.

---

## 🧱 docker-compose

```yaml
services:
  client:
    image: extremecanada/sonic-mcp-community-client:latest
    container_name: sonic-mcp-client
    restart: unless-stopped
    ports: ["5174:5174"]
    env_file: .env
    environment:
      - MCP_BASE_URL=${MCP_BASE_URL:-http://host.docker.internal:8000}
    volumes:
      - ./data:/app/backend/data       # persistent settings.json
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Create `.env` alongside (only `MCP_BASE_URL` is strictly required):

```env
MCP_BASE_URL=http://<your-mcp-server>:8000
MCP_TIMEOUT_SECONDS=30

# Optional — baseline LLM config. You can also set these from the
# Settings view at runtime; those are stored in data/settings.json.
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4o-mini
# OLLAMA_BASE_URL=http://127.0.0.1:11434
# OLLAMA_MODEL=qwen2.5:3b-instruct
```

Then: `docker compose up -d`.

---

## 🔑 Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MCP_BASE_URL` | `http://127.0.0.1:8000` | Upstream SONiC MCP server URL |
| `MCP_TIMEOUT_SECONDS` | `30` | HTTP timeout for upstream calls |
| `SONIC_MCP_CLIENT_PORT` | `5174` | In-container bind port |
| `OPENAI_API_KEY` | — | Optional. Takes precedence over any UI-set key |
| `OPENAI_MODEL` | `gpt-4o-mini` | Default OpenAI model |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama endpoint when enabled |
| `OLLAMA_MODEL` | `qwen2.5:3b-instruct` | Default Ollama model |

Runtime settings (active LLM provider, API keys, Ollama model) can
also be changed live from the Settings view — those persist to
`data/settings.json` (mode 0600) so they survive rebuilds.

---

## 📂 Volumes

| Mount | Purpose | Mode |
|---|---|---|
| `/app/backend/data` | `settings.json` (LLM prefs + optional OpenAI key) | `rw` |

That's it — the client holds no device credentials of its own.
Everything switch-facing stays on the server side.

---

## 🖥️ What you get

Six views, all on one port:

| View | What it does |
|---|---|
| **Dashboard** | Device reachability, per-switch operational summary, live fabric-health badge |
| **Fabric** | `get_fabric_topology` rendered as an interactive graph (reactflow) with clickable nodes |
| **AI Console** | Regex-first NL router, optional LLM fallback, persistent chat history, widget-rich results |
| **Tools** | Auto-generated forms from each tool's JSON Schema |
| **Activity** | Mutation ledger with search, filters, and one-click rollback row actions |
| **Settings** | LLM provider picker, live fabric-intent editor, and a **Fabric Inventory** section (add / remove / probe switches, LLDP seed-walk discovery with bulk-add on approval) |

Plus cross-cutting niceties:

- **⌘K / Ctrl-K** — fuzzy-search command palette
- **Editable mutation-confirm modal** with live combobox suggestions
  (interface names, VLAN IDs, BGP peers — fetched from the target switch)
- **Auto-refresh** (off / 30s / 60s / 120s) with a header health dot
  that pulses red on fabric drift
- **Export** any result (Copy JSON/Markdown, Download .json/.md/.csv)
- **Row actions** on Interfaces / BGP / Activity tables
- **Structured error cards** that classify common failures

---

## 🧰 Companion server

The backend this UI talks to is a separate image — pair them:

```bash
docker pull extremecanada/sonic-mcp-community-server:latest
```

See [`extremecanada/sonic-mcp-community-server`](https://hub.docker.com/r/extremecanada/sonic-mcp-community-server)
for its own quickstart.

---

## 🌐 Networking patterns

**Server on the same host, outside Docker** — use `host.docker.internal`.
The shipped compose already maps it to the host gateway for Linux.

**Both containers on the same host, on a user-defined network**:
```yaml
services:
  client:
    environment:
      - MCP_BASE_URL=http://sonic-mcp:8000   # container name
    networks: [sonic_net]
```

**Server on a remote host**:
```env
MCP_BASE_URL=http://10.0.0.5:8000
```

---

## 🔗 Links

- **Source:** https://github.com/YuryOstrovsky/sonic-mcp-community-client
- **Server repo:** https://github.com/YuryOstrovsky/sonic-mcp-community-server
- **Server image:** [`extremecanada/sonic-mcp-community-server`](https://hub.docker.com/r/extremecanada/sonic-mcp-community-server)
- **License:** Apache-2.0

---

## ⚠️ Notes

- The web UI and `/api/*` proxy are **unauthenticated**. Run behind a
  VPN / Tailscale / reverse-proxy with auth — not exposed to the
  public internet.
- If the **Settings** view has an OpenAI key configured, that key lives
  in `data/settings.json` on the host. Keep that directory's
  permissions tight.
- Container runs as non-root user `mcpc` (uid 1000) with
  `no-new-privileges`.
- Tags: `:latest`, `:<major>`, `:<major>.<minor>`, `:<full-semver>`.
  Pin to an exact version in production.
