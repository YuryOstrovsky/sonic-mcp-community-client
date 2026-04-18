# systemd service — SONiC MCP Community Client (backend)

Runs the FastAPI backend (`uvicorn main:app`) on `:5174`, which in turn serves
the built React app from `../frontend/dist/` (single-port mode). Mirrors the
server's systemd pattern so both pieces can be managed with `systemctl`.

## Install

```bash
cd /home/user01/sonic-mcp-community-client

sudo cp systemd/sonic-mcp-client.service /etc/systemd/system/sonic-mcp-client.service
sudo systemctl daemon-reload
sudo systemctl enable --now sonic-mcp-client
```

## Verify

```bash
systemctl status sonic-mcp-client --no-pager
journalctl -u sonic-mcp-client -f          # follow logs

curl -sS http://127.0.0.1:5174/api/health | jq
curl -sS http://127.0.0.1:5174/             | head   # built HTML
```

Then open `http://<host>:5174/` from your browser.

## Day-to-day operations

```bash
sudo systemctl restart sonic-mcp-client    # after editing backend/.env or code
sudo systemctl restart sonic-mcp-client    # also after `npm run build` — static dist is picked up on next request, but restart is tidier
sudo systemctl stop sonic-mcp-client
sudo systemctl start sonic-mcp-client
sudo systemctl disable sonic-mcp-client    # stop auto-start at boot
```

## Uninstall

```bash
sudo systemctl disable --now sonic-mcp-client
sudo rm /etc/systemd/system/sonic-mcp-client.service
sudo systemctl daemon-reload
```

## Paths baked into the unit

- WorkingDirectory: `/home/user01/sonic-mcp-community-client/backend`
- Python:           `/home/user01/sonic-mcp-community-client/backend/.venv/bin/uvicorn`
- EnvironmentFile:  `/home/user01/sonic-mcp-community-client/backend/.env`
- Static UI:        `/home/user01/sonic-mcp-community-client/frontend/dist/` (served by backend)
- User / Group:     `user01`

If you move the repo or change the user, edit the unit and re-copy to
`/etc/systemd/system/`.

## Gotcha: runtime OpenAI key is lost on restart

The OpenAI API key set via the UI's top-bar `🤖 LLM` popover or the
`POST /api/openai-key` endpoint is stored **in memory only** — restarting
the service clears it. To persist a key across restarts, put it in the
backend `.env` file:

```
OPENAI_API_KEY=sk-…
```

Then `sudo systemctl restart sonic-mcp-client`.

## Related

- Server unit: `../../sonic-mcp-community-server/systemd/sonic-mcp.service`
- Both services run as `user01` on the same host.
