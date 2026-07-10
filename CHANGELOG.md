# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — Client auth integration + packaging fixes

Follow-up to the re-audit: makes the React UI actually usable with
`CLIENT_API_KEY` and fixes the primary Docker install path.

### Fixed

- **React UI now sends `CLIENT_API_KEY`** — the shared `headers()` helper adds
  `Authorization: Bearer <key>` (from `sessionStorage`), and every protected
  call (invoke, nl, settings read/write, OpenAI key, inventory writes/probe,
  intent write, client-settings) routes through it. Previously sensitive
  actions returned 401 whenever the operator enabled `CLIENT_API_KEY`.
- **New Settings → Client authentication** field to enter/clear the key
  (`sessionStorage` only; renders even when the settings load is itself 401'd).
- **Docker Compose image name** corrected to
  `extremecanada/sonic-mcp-community-client:latest` (was the unqualified
  `sonic-mcp-community-client:latest`, which pulled a nonexistent
  `library/…` image and broke `docker compose up -d`).
- **`password_env` in the frontend** — added to inventory types and the
  add-switch form (and surfaced in the switch table), completing end-to-end
  support for referencing a server-side env var instead of an inline password.

### Changed

- `LLM_INCLUDE_DEVICE_CONTEXT` now defaults to **`0`** (security-first) — device
  IPs are withheld from external-LLM prompts unless explicitly opted in.

## [0.1.0] — First community release candidate

First public community release of the SONiC MCP Community Client — a web UI +
FastAPI proxy for the SONiC MCP Community Server. Client v0.1.x targets server
v0.1.x.

### Added

- **Upstream auth forwarding** — `MCP_API_KEY` is forwarded as
  `Authorization: Bearer` to the MCP server so protected server endpoints work.
  Backend-only; never sent to the browser.
- **Client-facing auth** — optional `CLIENT_API_KEY` gates sensitive `/api`
  routes (invoke, nl, inventory writes, probe, settings, intent). A distinct
  secret from `MCP_API_KEY`; startup warning when unset.
- **Ollama URL validation** — settings reject non-http(s) schemes, embedded
  credentials, and link-local / cloud-metadata targets (SSRF hardening).
- **`password_env`** support in the inventory model, matching the server.
- Backend **pytest suite** (auth forwarding, client auth, CORS, error
  sanitization, settings persistence, redaction, SSRF, version).
- Single authoritative version module (`backend/version.py`).
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, this `CHANGELOG.md`, Dependabot (+ grouped
  auto-merge), pip-audit, npm audit, and Trivy in CI; full release workflow
  (verify → dual-registry GHCR + Docker Hub → SBOM → provenance → Trivy → notes).
- `LLM_INCLUDE_DEVICE_CONTEXT` toggle to withhold device IPs from external LLMs.

### Changed

- **CORS restrictive by default** — empty allow-list (`CLIENT_CORS_ORIGINS`);
  was `allow_origins=["*"]`.
- **Settings persisted to `backend/data/settings.json`** (inside the mounted
  volume) via `CLIENT_SETTINGS_PATH`; the old `backend/settings.json` was
  outside the volume and lost on container replacement.
- **Docker/Compose bind to `127.0.0.1` by default** — the proxy is no longer
  world-reachable out of the box.
- Dependencies bumped to clear known CVEs (`starlette` → 1.3.1, `python-dotenv`
  → 1.2.2, FastAPI/pydantic aligned with the server).
- Errors sanitized — upstream failures return a generic message + request ID;
  the MCP URL is no longer exposed to unauthenticated callers.
- Removed obsolete "Phase A/D" labels from production-facing code.

### Security

- See `SECURITY.md` for the browser→client→server trust boundaries. The client
  is intended for localhost / trusted networks behind an authenticated proxy.

[Unreleased]: https://github.com/YuryOstrovsky/sonic-mcp-community-client/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/YuryOstrovsky/sonic-mcp-community-client/releases/tag/v0.1.0
