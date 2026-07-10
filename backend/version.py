# backend/version.py
"""Single authoritative version for the SONiC MCP Community Client.

Everything that reports a version — /api/health, image labels, the
frontend build info, release notes — should read `__version__` from here
so there is exactly one place to bump. Replaces the old ad-hoc
"0.1-phaseA" / "Phase A/D" strings scattered through the code.

The client and server are released with matching versions; a client
v0.1.x targets a server v0.1.x.
"""

__version__ = "0.1.0"
