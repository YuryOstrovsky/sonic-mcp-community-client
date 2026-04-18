# SONiC MCP Community Client — single-image deploy (frontend + backend).
#
# Two-stage build:
#   1. Node stage compiles the React/Vite frontend into /frontend/dist
#   2. Python stage runs the FastAPI backend (which serves /api/* and
#      also mounts the built frontend at /)
#
# The image is fabric-agnostic — MCP_BASE_URL and credentials come in
# via the runtime environment (see docker-compose.yml).

# ---------------------------------------------------------------
# Stage 1 — build the React frontend
# ---------------------------------------------------------------
FROM node:22-alpine AS frontend-build

WORKDIR /frontend

# Cached dep layer.
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Source + build. Vite outputs to /frontend/dist which stage 2 copies.
COPY frontend/ ./
RUN npm run build


# ---------------------------------------------------------------
# Stage 2 — Python FastAPI runtime
# ---------------------------------------------------------------
FROM python:3.11-slim

LABEL org.opencontainers.image.title="SONiC MCP Community Client" \
      org.opencontainers.image.description="Web UI + thin API proxy for the SONiC MCP Community Server" \
      org.opencontainers.image.source="https://github.com/YuryOstrovsky/sonic-mcp-community-client" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Non-root user; uid 1000 lines up with typical host user so bind-mount
# ownership (for settings.json) behaves naturally.
RUN groupadd --system --gid 1000 mcpc \
 && useradd  --system --uid 1000 --gid 1000 --home-dir /app --shell /bin/bash mcpc \
 && mkdir -p /app/backend /app/frontend/dist \
 && chown -R mcpc:mcpc /app

WORKDIR /app

COPY --chown=mcpc:mcpc backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Backend source — main.py, llm.py, nl_router.py, settings helpers, etc.
COPY --chown=mcpc:mcpc backend/ ./backend/

# Built React assets from stage 1. The backend expects frontend/dist to
# sit as a sibling of backend/ (see _FRONTEND_DIST in main.py).
COPY --from=frontend-build --chown=mcpc:mcpc /frontend/dist ./frontend/dist

USER mcpc

EXPOSE 5174

ENV MCP_BASE_URL=http://host.docker.internal:8000 \
    MCP_TIMEOUT_SECONDS=30 \
    SONIC_MCP_CLIENT_PORT=5174

# The backend's settings.json lives here in a volume so API keys /
# preferences survive rebuilds without being baked into the image.
VOLUME ["/app/backend/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5174/api/health', timeout=3)" || exit 1

WORKDIR /app/backend
ENTRYPOINT ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5174"]
