"""Runtime-persisted client settings.

Lives in `backend/settings.json` alongside this module. Stores values the
operator chose through the UI (LLM provider config, OpenAI API key,
Ollama host, etc.) so they survive `systemctl restart`.

Precedence (highest to lowest):
  1. settings.json (written by the UI)
  2. Environment variables loaded from .env at process start
  3. Hardcoded defaults in this module

Security notes:
  - `settings.json` is in the working directory and written with mode 0600.
  - `.gitignore` excludes it so API keys never end up in the repo.
  - This server has NO AUTH — anyone who can reach `:5174` can read or
    change these settings. Intended for trusted VPN / lab networks only.
"""

from __future__ import annotations

import json
import logging
import os
import stat
import threading
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("mcp-client.settings")

_SETTINGS_PATH = Path(__file__).resolve().parent / "settings.json"
_LOCK = threading.Lock()
_cache: Optional[Dict[str, Any]] = None


def _read_disk() -> Dict[str, Any]:
    if not _SETTINGS_PATH.exists():
        return {}
    try:
        return json.loads(_SETTINGS_PATH.read_text())
    except Exception as e:
        logger.warning("settings.json unreadable (%s) — treating as empty", e)
        return {}


def _write_disk(data: Dict[str, Any]) -> None:
    tmp = _SETTINGS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True))
    try:
        tmp.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except Exception:
        pass
    tmp.replace(_SETTINGS_PATH)


def _all() -> Dict[str, Any]:
    global _cache
    with _LOCK:
        if _cache is None:
            _cache = _read_disk()
        return dict(_cache)


def update(partial: Dict[str, Any]) -> Dict[str, Any]:
    """Merge `partial` into current settings and persist. Deep-merges at
    one level of nesting (enough for our {openai:{…}, ollama:{…}} schema).
    Returns the full post-update settings (raw, not redacted).
    """
    global _cache
    with _LOCK:
        current = _read_disk()
        for k, v in (partial or {}).items():
            if isinstance(v, dict) and isinstance(current.get(k), dict):
                for ik, iv in v.items():
                    if iv is None or iv == "":
                        current[k].pop(ik, None)
                    else:
                        current[k][ik] = iv
                if not current[k]:
                    current.pop(k, None)
            elif v is None or v == "":
                current.pop(k, None)
            else:
                current[k] = v
        _write_disk(current)
        _cache = current
        return dict(current)


# ---------- Effective-value accessors (settings > env > default) ----------

def _provider_field(provider: str, field: str, default: Any = None) -> Any:
    p = (_all().get(provider) or {})
    v = p.get(field)
    if v is None or v == "":
        return default
    return v


def get_openai_key() -> Optional[str]:
    persisted = _provider_field("openai", "api_key")
    if persisted:
        return str(persisted)
    return os.environ.get("OPENAI_API_KEY") or None


def get_openai_model() -> str:
    return _provider_field("openai", "model") or os.environ.get("OPENAI_MODEL", "gpt-4o-mini")


def get_ollama_enabled() -> bool:
    v = _provider_field("ollama", "enabled")
    if v is not None:
        return bool(v)
    return os.environ.get("OLLAMA_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")


def get_ollama_base_url() -> str:
    return _provider_field("ollama", "base_url") or os.environ.get(
        "OLLAMA_BASE_URL", "http://127.0.0.1:11434"
    )


def get_ollama_model() -> str:
    return _provider_field("ollama", "model") or os.environ.get(
        "OLLAMA_MODEL", "qwen2.5:3b-instruct"
    )


def get_preferred_provider() -> str:
    """Returns the user's explicit provider choice, or 'auto'.

    Valid values:
      'openai' — always OpenAI (fails if no key set; no silent fallback)
      'ollama' — always Ollama (fails if not enabled; no silent fallback)
      'auto'   — use OpenAI if configured, else Ollama if enabled, else none
    """
    v = _all().get("preferred_provider")
    if v in ("openai", "ollama", "auto"):
        return v
    return "auto"


def compute_effective_provider() -> Optional[str]:
    """Pick the provider that will actually be used given the current
    preference + availability. May be None if nothing is usable."""
    pref = get_preferred_provider()
    openai_ok = bool(get_openai_key())
    ollama_ok = get_ollama_enabled()
    if pref == "openai":
        return "openai" if openai_ok else None
    if pref == "ollama":
        return "ollama" if ollama_ok else None
    # auto
    if openai_ok:
        return "openai"
    if ollama_ok:
        return "ollama"
    return None


# ---------- Safe view for GET /api/settings ----------

def safe_view() -> Dict[str, Any]:
    """Return a summary suitable for the UI. API keys are redacted to the
    last 4 chars; booleans for 'is_configured' expose the truth without
    leaking secrets.
    """
    s = _all()
    openai_raw = s.get("openai") or {}
    ollama_raw = s.get("ollama") or {}

    # API key reveal: show a redacted fingerprint when present.
    key = get_openai_key()
    if key:
        key_preview = (key[:3] + "…" + key[-4:]) if len(key) > 10 else "set"
    else:
        key_preview = None

    env_key = bool(os.environ.get("OPENAI_API_KEY"))
    persisted_key = bool(openai_raw.get("api_key"))

    return {
        "openai": {
            "configured": bool(key),
            "key_preview": key_preview,
            "key_source": (
                "settings.json" if persisted_key
                else ("env" if env_key else None)
            ),
            "model": get_openai_model(),
            "model_source": (
                "settings.json" if openai_raw.get("model")
                else ("env" if os.environ.get("OPENAI_MODEL") else "default")
            ),
        },
        "ollama": {
            "enabled": get_ollama_enabled(),
            "base_url": get_ollama_base_url(),
            "model": get_ollama_model(),
            "enabled_source": (
                "settings.json" if ollama_raw.get("enabled") is not None
                else ("env" if os.environ.get("OLLAMA_ENABLED") else "default")
            ),
        },
        "preferred_provider": get_preferred_provider(),
        "effective_provider": compute_effective_provider(),
        # Legacy field — kept so older client builds still render something
        "preference": compute_effective_provider(),
        "storage_path": str(_SETTINGS_PATH),
    }
