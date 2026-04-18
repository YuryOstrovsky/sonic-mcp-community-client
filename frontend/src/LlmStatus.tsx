/**
 * Top-bar LLM status pill. Click → navigate to the Settings view.
 */

import {useEffect, useState} from "react";
import {getLlmStatus} from "./lib/api";
import {cn} from "./lib/cn";

type Status = {
  openai: {configured: boolean; model: string};
  ollama: {enabled: boolean; base_url: string; model: string};
  preferred_provider?: "openai" | "ollama" | "auto";
  effective_provider?: "openai" | "ollama" | null;
  preference: "openai" | "ollama" | null;
};

export function LlmStatus(props: {onOpenSettings: () => void}) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await getLlmStatus();
        if (!cancelled) setStatus(s);
      } catch {/* ignore */}
    };
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    const iv = setInterval(refresh, 10000);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); clearInterval(iv); };
  }, []);

  const active = status?.effective_provider ?? status?.preference ?? null;
  const pinned = status?.preferred_provider;
  const dotColor = active === "openai" ? "bg-green-500"
                 : active === "ollama" ? "bg-blue-400"
                 : "bg-gray-500";

  const modelLabel =
    active === "openai" ? status?.openai.model :
    active === "ollama" ? status?.ollama.model : null;

  const label = active
    ? `LLM: ${active}${modelLabel ? ` (${modelLabel})` : ""}`
    : "LLM: off";

  const isPinned = pinned && pinned !== "auto";

  return (
    <button
      onClick={props.onOpenSettings}
      title={
        isPinned
          ? `LLM pinned to ${pinned} — click to change in Settings`
          : "Open Settings to configure the LLM fallback"
      }
      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/[0.06]"
    >
      <span className={cn("h-2 w-2 rounded-full", dotColor)} />
      <span>{label}</span>
      {isPinned && <span className="text-xs text-gray-500">📌</span>}
    </button>
  );
}
