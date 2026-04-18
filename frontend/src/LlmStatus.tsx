/**
 * Top-bar LLM status pill. Click → navigate to the Settings view.
 *
 * Reads /api/llm-status and shows:
 *   - effective provider (what's actually being used) — or "off" if none
 *   - model name for the active provider
 *   - a 📌 indicator if the user has explicitly pinned a provider (vs "auto")
 */

import {useEffect, useState} from "react";
import {StatusPill} from "./shared";
import {getLlmStatus} from "./lib/api";

type Status = {
  openai: {configured: boolean; model: string};
  ollama: {enabled: boolean; base_url: string; model: string};
  preferred_provider?: "openai" | "ollama" | "auto";
  effective_provider?: "openai" | "ollama" | null;
  preference: "openai" | "ollama" | null; // legacy alias
};

export function LlmStatus(props: {onOpenSettings: () => void}) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await getLlmStatus();
        if (!cancelled) setStatus(s);
      } catch {/* ignore; pill stays at loading state */}
    };
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    // Poll every 10s so the pill stays in sync if settings change in another tab.
    const iv = setInterval(refresh, 10000);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); clearInterval(iv); };
  }, []);

  // Prefer the explicit effective_provider; fall back to the legacy `preference`.
  const active = status?.effective_provider ?? status?.preference ?? null;
  const pinned = status?.preferred_provider;
  const tone: "good" | "info" | "neutral" =
    active === "openai" ? "good" : active === "ollama" ? "info" : "neutral";

  const modelLabel =
    active === "openai" ? status?.openai.model :
    active === "ollama" ? status?.ollama.model : null;

  const label = active
    ? `LLM: ${active}${modelLabel ? ` (${modelLabel})` : ""}`
    : "LLM: off";

  // 📌 = user explicitly pinned this provider (not "auto")
  const isPinned = pinned && pinned !== "auto";

  return (
    <button
      onClick={props.onOpenSettings}
      title={
        isPinned
          ? `LLM pinned to ${pinned} — click to change in Settings`
          : "Open Settings to configure the LLM fallback"
      }
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
      }}
    >
      <StatusPill tone={tone}>🤖 {label}{isPinned ? " 📌" : ""}</StatusPill>
    </button>
  );
}
