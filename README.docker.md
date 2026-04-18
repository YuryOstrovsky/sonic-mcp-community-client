# SONiC MCP Community Client — Docker quickstart

A single-image deploy: Node builds the React app, Python/FastAPI serves
it along with the `/api/*` proxy to the upstream SONiC MCP server.

## 1. Prerequisites

- Docker 24+ with the `compose` plugin (or `docker-compose` 2.x).
- An MCP server reachable from the container. By default that's
  `http://host.docker.internal:8000`; change `MCP_BASE_URL` in `.env` if
  it lives elsewhere.
- About 600 MB of free disk for the build cache.

## 2. Configure

```bash
cp backend/.env.example .env
# Edit .env:
#   MCP_BASE_URL=http://<host-or-container>:8000
```

The only *required* setting is `MCP_BASE_URL`. Everything else (LLM
provider, OpenAI key, Ollama model) is manageable from the Settings
view in the UI and persisted to `./data/settings.json` on the host.

## 3. Build + run

```bash
docker compose up -d --build
docker compose logs -f      # watch boot
```

Smoke test:

```bash
curl -sf http://localhost:5174/api/health          # backend up
curl -sf http://localhost:5174/api/tools | jq 'length'
# open http://<host>:5174/ in a browser
```

## 4. Lifecycle

| Action | Command |
|---|---|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Restart | `docker compose restart` |
| Logs (follow) | `docker compose logs -f` |
| Rebuild after a git pull | `docker compose up -d --build` |
| Pull image updates (if using a registry tag) | `docker compose pull && docker compose up -d` |
| Shell into the container | `docker compose exec client bash` |
| Check health | `docker inspect sonic-mcp-client --format '{{.State.Health.Status}}'` |
| Wipe persistent settings | `docker compose down && rm -rf data/` |

## 5. What lives where

| Host path | Container path | Purpose |
|---|---|---|
| `./.env` | loaded as env | `MCP_BASE_URL`, timeouts, optional API keys |
| `./data/` | `/app/backend/data` | `settings.json` (LLM prefs, keys) — survives rebuilds |
| *(baked into image)* | `/app/frontend/dist` | Built React app served at `/` |

The image itself is stateless and fabric-agnostic — pull or rebuild
freely; state sits on the host.

## 6. Networking patterns

**Server on the same host (outside Docker):**
```yaml
environment:
  - MCP_BASE_URL=http://host.docker.internal:8000
```
On Linux this works because `docker-compose.yml` maps
`host.docker.internal → host-gateway` explicitly.

**Server in its own container on the same host:**
Put both containers on a user-defined network and reference by name:
```yaml
environment:
  - MCP_BASE_URL=http://sonic-mcp:8000
networks:
  - sonic_net
```
(Server must also join `sonic_net`.)

**Server on a remote host:**
```env
MCP_BASE_URL=http://10.0.0.5:8000
```
Straightforward — no extra docker network tricks needed.

## 7. Security notes

- Runs as non-root user `mcpc` (uid 1000) with `no-new-privileges`.
- `settings.json` (which may contain an OpenAI API key) is written with
  mode 0600 by the backend. Keep `./data/` permissions tight on the host.
- **This build has no auth on the web UI or the `/api/*` proxy.** Put
  it on a trusted network (VPN, Tailscale, Cloudflare Access…) before
  exposing to the public internet.
- The mutation ledger lives on the *server* side, not the client —
  rebuilding or redeploying the client never loses audit trail.

## 8. Upgrading

```bash
# local source update
git pull
docker compose up -d --build

# published image (once we tag to GHCR)
docker compose pull
docker compose up -d
```

User-visible settings (LLM provider, API keys) persist because they're
in `./data` — the image swap doesn't touch them.

## 9. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `502 Bad Gateway` in the UI | `MCP_BASE_URL` wrong / server unreachable from container |
| Health check fails at boot | Server is completely unreachable — container boots but `/api/health` probe times out |
| OpenAI key disappears after rebuild | `./data` wasn't mounted; settings went into the container fs |
| UI loads but all tools 502 | Client reached backend but backend can't reach MCP server — check `docker compose logs client` |
