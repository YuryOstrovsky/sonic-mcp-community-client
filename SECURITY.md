# Security Policy

The SONiC MCP Community Client is a web UI + backend proxy in front of the
SONiC MCP Community Server. Through that server it can **indirectly read and
change the configuration of network infrastructure**, and it stores an
optional OpenAI API key. Treat it accordingly.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ |
| < 0.1   | ❌ |

The client and server are released with matching versions; a client v0.1.x
targets a server v0.1.x.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.** Report privately
via GitHub's [Report a vulnerability](https://github.com/YuryOstrovsky/sonic-mcp-community-client/security/advisories/new)
("Security" → "Advisories"). Include impact, reproduction, affected version,
and any suggested fix. Do not include API keys, credentials, management IPs,
or settings files in public reports.

Acknowledgement within ~7 days; assessment within ~14; fixes for confirmed
high-severity issues as fast as reasonably possible, coordinated before
public disclosure.

## Trust boundaries

There are **two** distinct trust relationships — keep them separate:

```
Browser / user  --CLIENT_API_KEY-->  Client backend  --MCP_API_KEY-->  MCP server
```

- **Browser → client backend:** gated by `CLIENT_API_KEY` when set. Because a
  browser can't hold a secret safely, the recommended posture for a UI is an
  **authenticating reverse proxy** (SSO / OAuth2-proxy / Authelia / basic auth)
  and/or a **localhost bind**. `CLIENT_API_KEY` is primarily for scripted or
  proxy-injected access.
- **Client backend → MCP server:** the backend forwards `MCP_API_KEY` to the
  server. This key stays in the backend and is **never** sent to the browser.

Do **not** reuse the same secret for both — they protect different hops.

## Intended use

- **Not for public exposure.** The Docker/Compose default binds to
  `127.0.0.1`. Do not publish port 5174 to the Internet. For LAN access, front
  it with an authenticated reverse proxy.
- If `CLIENT_API_KEY` is unset the backend logs a warning: anyone who can reach
  the port can invoke tools, change inventory, and edit stored settings/keys.

## Credential handling

- The client does **not persist device credentials**. Credentials entered
  during inventory add/probe pass **through** the backend to the MCP server —
  use only over a trusted network. Prefer `password_env` (a server-side env var
  name) over inline passwords.
- The OpenAI API key, if set via the UI, is stored in
  `backend/data/settings.json` with mode `0600` and redacted in API responses.
  Keep `./data` off shared/backup storage you don't control.

## External LLM data disclosure

For an unmatched natural-language query with OpenAI selected, the backend sends
the query, tool descriptions, and (unless `LLM_INCLUDE_DEVICE_CONTEXT=0`)
limited device context (management IPs, reachability) to OpenAI — data leaves
the local environment. Use **Ollama** or disable LLM fallback for fully local
operation. Never put credentials or confidential production data in NL prompts.

## Settings / SSRF

The backend issues HTTP requests to the configured Ollama `base_url`. The
settings route validates it (http/https only, no embedded credentials, no
link-local / cloud-metadata targets) to limit SSRF. Gate settings writes with
`CLIENT_API_KEY` and/or a reverse proxy.

## Known boundaries

- No built-in per-user identity or RBAC — `CLIENT_API_KEY` is a single shared
  secret. Use a reverse proxy with SSO for per-user auth.
- Rollback executed via the server is best-effort, not transactional (see the
  server's docs).
