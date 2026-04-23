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

> **⚠ The `localhost` pitfall, read this first.**
>
> Inside the client container, `localhost` is the **container's own
> loopback** — not your host. Setting `MCP_BASE_URL=http://localhost:8000`
> or `http://127.0.0.1:8000` is the #1 reason `/api/*` returns
> `502 Bad Gateway`. There are two "localhost"s in play:
>
> | Who says `localhost`        | What it means                                    |
> |-----------------------------|--------------------------------------------------|
> | Your **browser** → `:5174/` | The host's port 5174 → Docker-mapped to the client ✓ |
> | The **client container** → `MCP_BASE_URL` | The container's loopback ✗ (no MCP server there) |
>
> Use one of the patterns below — never `localhost`/`127.0.0.1` inside the container.

### A. Server runs on the host, outside Docker

```yaml
environment:
  - MCP_BASE_URL=http://host.docker.internal:8000
extra_hosts:
  - "host.docker.internal:host-gateway"   # required on Linux
```

The shipped `docker-compose.yml` includes the `extra_hosts` mapping —
works out of the box on Linux, macOS, and Windows Docker Desktop.

### B. Server and client are both in containers on the same host

Best practice: put both on a user-defined Docker network and reference
the server by its container name. Example combined compose:

```yaml
services:
  sonic-mcp:
    image: extremecanada/sonic-mcp-community-server:latest
    container_name: sonic-mcp
    env_file: server.env
    networks: [sonic_net]
    volumes:
      - ./server/config:/app/config
      - ./server/logs:/app/logs
      - ./server/snapshots:/app/snapshots

  client:
    image: extremecanada/sonic-mcp-community-client:latest
    container_name: sonic-mcp-client
    environment:
      - MCP_BASE_URL=http://sonic-mcp:8000   # ← container name, not localhost
    ports: ["5174:5174"]
    volumes:
      - ./client/data:/app/backend/data
    depends_on: [sonic-mcp]
    networks: [sonic_net]

networks:
  sonic_net:
    driver: bridge
```

No `host.docker.internal`, no `--add-host` — Docker's embedded DNS
resolves `sonic-mcp` to the other container's IP on `sonic_net`.

### C. Server runs on a remote host

```env
MCP_BASE_URL=http://10.0.0.5:8000
```

Straightforward — no extra Docker network tricks. Just make sure
port 8000 is reachable from wherever the client container lives.

### Quick reference

| Deployment                                        | `MCP_BASE_URL`                        |
|---------------------------------------------------|---------------------------------------|
| Server on host (outside Docker), client in Docker | `http://host.docker.internal:8000` *(+ extra_hosts on Linux)* |
| Both in containers, same host, same network       | `http://sonic-mcp:8000`               |
| Server on a remote host                           | `http://<server-ip-or-hostname>:8000` |
| **`localhost` / `127.0.0.1` from inside the client container** | **Broken. Always.** |

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

| Symptom | Likely cause + fix |
|---|---|
| `502 Bad Gateway` in the UI | `MCP_BASE_URL` wrong / server unreachable from inside the container. See §6. **Most common cause:** `MCP_BASE_URL=http://localhost:8000` or `127.0.0.1` — that's the container's loopback, not the host. Use `host.docker.internal` or the container name. |
| `ECONNREFUSED` to `127.0.0.1:8000` in `docker compose logs client` | Textbook localhost-from-container mistake. Change `MCP_BASE_URL` per §6. |
| Health check fails at boot | Server is completely unreachable — container boots but `/api/health` probe times out. Verify `curl -v http://<MCP_BASE_URL>/health` from a `docker exec` shell. |
| OpenAI key disappears after rebuild | `./data` wasn't mounted; settings went into the container fs. Re-add `-v $(pwd)/data:/app/backend/data`. |
| UI loads but all tools 502 | Client reached the proxy but the proxy can't reach MCP server. Check `MCP_BASE_URL` (§6) and that the server replies to `/health` from another host. |
| Settings save fails silently (OpenAI key vanishes on next load) | `./data` on the host is owned by `root` — Docker created it when the container started. `mkdir -p data` + `sudo chown 1000:1000 data` before `docker compose up`. |
