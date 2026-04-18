/**
 * Settings view — dedicated area for configuring LLM providers and other
 * runtime options. Values are persisted in `backend/settings.json` and
 * survive `systemctl restart`.
 *
 * Currently two providers are supported:
 *   - OpenAI   (cloud, gpt-4o-mini by default; best quality)
 *   - Ollama   (local, qwen2.5:3b-instruct by default; air-gapped / free)
 *
 * Precedence used by the backend at read time:
 *   settings.json  >  environment variables (.env)  >  hardcoded defaults
 *
 * The "Source" badge next to each effective value lets the user see
 * whether a given setting is coming from persisted state or the
 * environment.
 */

import {useEffect, useState} from "react";
import {FG} from "./lib/figmaStyles";
import {Badge, Button, ErrorBanner, Loading, StatusPill} from "./shared";
import {KvGrid, Section} from "./widgets/common";
import {getSettings, patchSettings, type SettingsView as S} from "./lib/api";

// ─── Ollama model presets ─────────────────────────────────────
// Curated list of commonly-installed Ollama models, ordered by typical use.
// Sizes are approximate download sizes (quantized). "recommended" marks the
// one we've tested for JSON tool-selection (small + reliable).
const OLLAMA_PRESETS = [
  {value: "qwen2.5:3b-instruct", label: "Qwen 2.5 3B (instruct)", size: "~2 GB",  recommended: true},
  {value: "qwen2.5:7b-instruct", label: "Qwen 2.5 7B (instruct)", size: "~4.7 GB"},
  {value: "llama3.2:3b",         label: "Llama 3.2 3B",           size: "~2 GB"},
  {value: "llama3.1:8b",         label: "Llama 3.1 8B",           size: "~4.9 GB"},
  {value: "phi3.5:3.8b",         label: "Phi 3.5 Mini (3.8B)",    size: "~2.2 GB"},
  {value: "mistral:7b-instruct", label: "Mistral 7B (instruct)",  size: "~4.4 GB"},
  {value: "gemma2:2b",           label: "Gemma 2 2B",             size: "~1.6 GB"},
];

function isOllamaPreset(v: string): boolean {
  return OLLAMA_PRESETS.some((p) => p.value === v);
}

export function SettingsView() {
  const [data, setData] = useState<S | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // Controlled form state — populated from the server view; only sent on Save.
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("");
  const [ollamaEnabled, setOllamaEnabled] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");

  async function refresh() {
    setErr(null);
    try {
      const s = await getSettings();
      setData(s);
      // Sync form state with loaded effective values.
      setOpenaiKey("");
      setOpenaiModel(s.openai.model);
      setOllamaEnabled(s.ollama.enabled);
      setOllamaUrl(s.ollama.base_url);
      setOllamaModel(s.ollama.model);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  useEffect(() => { refresh(); }, []);

  async function apply(update: Parameters<typeof patchSettings>[0], msg: string) {
    setBusy(true);
    setErr(null);
    setFlash(null);
    try {
      const s = await patchSettings(update);
      setData(s);
      setFlash(msg);
      // Reset OpenAI key field after a successful save (don't echo secrets back)
      if (update.openai && "api_key" in update.openai) setOpenaiKey("");
      setTimeout(() => setFlash(null), 3000);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div style={{padding: 20}}>{err ? <ErrorBanner>{err}</ErrorBanner> : <Loading />}</div>;
  }

  return (
    <div>
      <h1 style={{margin: "0 0 4px 0", color: FG.titleColor, fontSize: 22, fontWeight: 600}}>
        Settings
      </h1>
      <div style={{fontSize: 12, color: FG.mutedColor, marginBottom: 18}}>
        Persisted at <code>{data.storage_path}</code> (mode 0600).
        Precedence: <b>settings.json → .env → default</b>.
      </div>

      {flash && (
        <div style={{
          marginBottom: 14,
          padding: "8px 12px",
          background: FG.successBg,
          border: `1px solid ${FG.successBorder}`,
          color: FG.successGreen,
          borderRadius: 8,
          fontSize: 13,
        }}>{flash}</div>
      )}
      {err && <div style={{marginBottom: 14}}><ErrorBanner>{err}</ErrorBanner></div>}

      {/* Provider selector — the explicit "which AI am I using" toggle */}
      <section style={panelStyle}>
        <header style={panelHeader}>
          <div>
            <h2 style={h2Style}>Active LLM provider</h2>
            <div style={{fontSize: 12, color: FG.mutedColor}}>
              Choose which provider the NL router falls back to when regex doesn't match.
              "Auto" picks the best available — OpenAI first, then Ollama.
            </div>
          </div>
          <StatusPill tone={
            data.effective_provider === "openai" ? "good" :
            data.effective_provider === "ollama" ? "info" : "neutral"
          }>
            🤖 active: {data.effective_provider ?? "none"}
          </StatusPill>
        </header>

        <div style={{display: "flex", flexDirection: "column", gap: 8}}>
          <ProviderRadio
            value="auto"
            selected={data.preferred_provider}
            title="Auto"
            subtitle="Use OpenAI if configured, else Ollama if enabled"
            available={true}
            onPick={(v) => apply({preferred_provider: v}, `preferred provider → ${v}`)}
            busy={busy}
          />
          <ProviderRadio
            value="openai"
            selected={data.preferred_provider}
            title={`OpenAI (${data.openai.model})`}
            subtitle={
              data.openai.configured
                ? "Cloud — ready to use"
                : "No API key configured — pin to this only after saving a key below"
            }
            available={data.openai.configured}
            onPick={(v) => apply({preferred_provider: v}, `preferred provider → ${v}`)}
            busy={busy}
          />
          <ProviderRadio
            value="ollama"
            selected={data.preferred_provider}
            title={`Ollama (${data.ollama.model})`}
            subtitle={
              data.ollama.enabled
                ? `Local — ${data.ollama.base_url}`
                : "Not enabled — turn on in the Ollama panel below first"
            }
            available={data.ollama.enabled}
            onPick={(v) => apply({preferred_provider: v}, `preferred provider → ${v}`)}
            busy={busy}
          />
        </div>

        {/* Explicit warning if a pinned provider isn't usable */}
        {data.preferred_provider === "openai" && !data.openai.configured && (
          <div style={{
            marginTop: 12,
            padding: "8px 12px",
            background: FG.warningBg,
            border: `1px solid ${FG.warningBorder}`,
            color: FG.warningYellow,
            borderRadius: 8,
            fontSize: 12,
          }}>
            ⚠ Pinned to OpenAI, but no API key is set. LLM fallback is effectively disabled until you save a key below.
          </div>
        )}
        {data.preferred_provider === "ollama" && !data.ollama.enabled && (
          <div style={{
            marginTop: 12,
            padding: "8px 12px",
            background: FG.warningBg,
            border: `1px solid ${FG.warningBorder}`,
            color: FG.warningYellow,
            borderRadius: 8,
            fontSize: 12,
          }}>
            ⚠ Pinned to Ollama, but it isn't enabled. Enable it in the Ollama panel below.
          </div>
        )}
      </section>

      {/* OpenAI panel */}
      <section style={panelStyle}>
        <header style={panelHeader}>
          <div>
            <h2 style={h2Style}>OpenAI</h2>
            <div style={{fontSize: 12, color: FG.mutedColor}}>
              Cloud LLM. Fastest path to good results. Requires an API key from{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{color: FG.titleColor}}>
                platform.openai.com
              </a>.
            </div>
          </div>
          <StatusPill tone={data.openai.configured ? "good" : "neutral"}>
            {data.openai.configured ? "configured" : "not configured"}
          </StatusPill>
        </header>

        <KvGrid columns={2} rows={[
          {label: "API key", value: (
            data.openai.key_preview
              ? <span style={{fontFamily: "ui-monospace, monospace"}}>{data.openai.key_preview} <Badge>{data.openai.key_source}</Badge></span>
              : <span style={{color: FG.mutedColor}}>no key set <Badge>{data.openai.key_source ?? "default"}</Badge></span>
          )},
          {label: "Model", value: <span style={{fontFamily: "ui-monospace, monospace"}}>{data.openai.model} <Badge>{data.openai.model_source}</Badge></span>},
        ]} />

        <div style={{height: 14}} />

        <div style={{display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center"}}>
          <label htmlFor="openai-key" style={labelStyle}>New API key</label>
          <input
            id="openai-key"
            type="password"
            placeholder="sk-…"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            style={inputStyle}
          />
          <label htmlFor="openai-model" style={labelStyle}>Model</label>
          <input
            id="openai-model"
            type="text"
            placeholder="gpt-4o-mini"
            value={openaiModel}
            onChange={(e) => setOpenaiModel(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end"}}>
          {data.openai.configured && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => apply({openai: {api_key: ""}}, "OpenAI key cleared")}
            >Clear key</Button>
          )}
          <Button
            disabled={busy || (!openaiKey.trim() && openaiModel === data.openai.model)}
            onClick={() => {
              const update: Record<string, any> = {};
              if (openaiKey.trim()) update.api_key = openaiKey.trim();
              if (openaiModel.trim() && openaiModel !== data.openai.model) update.model = openaiModel.trim();
              return apply({openai: update}, "OpenAI settings saved");
            }}
          >{busy ? "…" : "Save OpenAI"}</Button>
        </div>

        <div style={noteStyle}>
          Key is stored in <code>settings.json</code> on the backend. Never committed
          (already in <code>.gitignore</code>), never sent anywhere except the OpenAI
          API when the LLM fallback fires. This host has no auth — anyone on this
          network can read or change these settings.
        </div>
      </section>

      {/* Ollama panel */}
      <section style={panelStyle}>
        <header style={panelHeader}>
          <div>
            <h2 style={h2Style}>Ollama (local LLM)</h2>
            <div style={{fontSize: 12, color: FG.mutedColor}}>
              Runs an LLM on-host or on a nearby machine. Free, air-gapped, slower.
              Quality depends on the model you pick.
            </div>
          </div>
          <StatusPill tone={data.ollama.enabled ? "info" : "neutral"}>
            {data.ollama.enabled ? "enabled" : "disabled"}
          </StatusPill>
        </header>

        <KvGrid columns={2} rows={[
          {label: "Enabled",  value: <span>{data.ollama.enabled ? "yes" : "no"} <Badge>{data.ollama.enabled_source}</Badge></span>},
          {label: "Base URL", value: <span style={{fontFamily: "ui-monospace, monospace"}}>{data.ollama.base_url}</span>},
          {label: "Model",    value: <span style={{fontFamily: "ui-monospace, monospace"}}>{data.ollama.model}</span>},
        ]} />

        <div style={{height: 14}} />

        <div style={{display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center"}}>
          <label htmlFor="ollama-enabled" style={labelStyle}>Enable</label>
          <label style={{display: "flex", alignItems: "center", gap: 8, color: FG.bodyColor, fontSize: 13}}>
            <input
              id="ollama-enabled"
              type="checkbox"
              checked={ollamaEnabled}
              onChange={(e) => setOllamaEnabled(e.target.checked)}
            />
            <span style={{color: FG.mutedColor}}>use Ollama when OpenAI isn't configured</span>
          </label>

          <label htmlFor="ollama-url" style={labelStyle}>Base URL</label>
          <input
            id="ollama-url"
            type="text"
            placeholder="http://127.0.0.1:11434"
            value={ollamaUrl}
            onChange={(e) => setOllamaUrl(e.target.value)}
            style={inputStyle}
          />

          <label htmlFor="ollama-model" style={labelStyle}>Model</label>
          <div style={{display: "flex", flexDirection: "column", gap: 6}}>
            <select
              id="ollama-model"
              value={isOllamaPreset(ollamaModel) ? ollamaModel : "__custom__"}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  // Keep whatever's there, or default if nothing sensible
                  setOllamaModel(ollamaModel || "qwen2.5:3b-instruct");
                } else {
                  setOllamaModel(e.target.value);
                }
              }}
              style={{...inputStyle, fontFamily: "inherit"}}
            >
              {OLLAMA_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} — {p.size}{p.recommended ? "  ⭐" : ""}
                </option>
              ))}
              <option value="__custom__">Custom… (enter your own below)</option>
            </select>
            {!isOllamaPreset(ollamaModel) && (
              <input
                type="text"
                placeholder="e.g. mixtral:8x7b"
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                style={inputStyle}
              />
            )}
          </div>
        </div>

        <div style={{display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end"}}>
          <Button
            disabled={busy}
            onClick={() => apply({ollama: {
              enabled: ollamaEnabled,
              base_url: ollamaUrl,
              model: ollamaModel,
            }}, "Ollama settings saved")}
          >{busy ? "…" : "Save Ollama"}</Button>
        </div>

        <Section title={`How to install Ollama + pull ${ollamaModel || "a model"}`}>
          <div style={{
            background: "var(--bg0)",
            border: `1px solid ${FG.divider}`,
            borderRadius: 8,
            padding: 12,
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            color: FG.bodyColor,
            lineHeight: 1.6,
          }}>
            <div style={{color: FG.mutedColor, marginBottom: 4}}># 1. Install (Linux / macOS):</div>
            <div>curl -fsSL https://ollama.com/install.sh | sh</div>
            <div style={{color: FG.mutedColor, marginTop: 10, marginBottom: 4}}># 2. Pull the selected model ({ollamaModel || "pick one above"}):</div>
            <div>ollama pull {ollamaModel || "<model>"}</div>
            <div style={{color: FG.mutedColor, marginTop: 10, marginBottom: 4}}># 3. Ollama auto-starts a local service. Verify it's running:</div>
            <div>curl http://127.0.0.1:11434/api/tags</div>
            <div style={{color: FG.mutedColor, marginTop: 10, marginBottom: 4}}># 4. Enable Ollama above (checkbox + Save), then pin it in the</div>
            <div style={{color: FG.mutedColor}}>#    "Active LLM provider" panel at the top of this page.</div>
          </div>
        </Section>

        <div style={noteStyle}>
          If this backend runs on a different host than Ollama, set Base URL
          accordingly. CORS isn't a concern (the backend makes the call, not
          the browser).
        </div>
      </section>

      {/* Future providers hint */}
      <section style={panelStyle}>
        <header style={panelHeader}>
          <div>
            <h2 style={h2Style}>Other providers</h2>
            <div style={{fontSize: 12, color: FG.mutedColor}}>
              Anthropic Claude, Gemini, Mistral Cloud, etc. — not wired yet.
              The settings schema is extensible; adding a new provider is a
              single new client class in <code>backend/llm.py</code>.
            </div>
          </div>
          <StatusPill tone="neutral">planned</StatusPill>
        </header>
      </section>
    </div>
  );
}

// ─── Provider radio (used by Active-provider section above) ─────
function ProviderRadio(props: {
  value: "openai" | "ollama" | "auto";
  selected: "openai" | "ollama" | "auto";
  title: string;
  subtitle: string;
  available: boolean;
  busy: boolean;
  onPick: (v: "openai" | "ollama" | "auto") => void;
}) {
  const active = props.selected === props.value;
  const dim = !props.available && props.value !== "auto";
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "10px 12px",
        background: active ? FG.rowSelectedBg : FG.subtleBg,
        border: `1px solid ${active ? FG.rowSelectedBorder : FG.subtleBorder}`,
        borderRadius: 10,
        cursor: props.busy ? "wait" : "pointer",
        transition: FG.transition,
        opacity: dim ? 0.6 : 1,
      }}
    >
      <input
        type="radio"
        name="preferred-provider"
        checked={active}
        disabled={props.busy}
        onChange={() => props.onPick(props.value)}
        style={{marginTop: 3}}
      />
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{
          fontSize: 14,
          fontWeight: 600,
          color: active ? FG.titleColor : FG.bodyColor,
        }}>{props.title}</div>
        <div style={{fontSize: 12, color: FG.mutedColor, marginTop: 2}}>
          {props.subtitle}
        </div>
      </div>
      {active && (
        <span style={{
          fontSize: 11,
          color: FG.successGreen,
          background: FG.successBg,
          border: `1px solid ${FG.successBorder}`,
          borderRadius: 999,
          padding: "2px 8px",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}>selected</span>
      )}
    </label>
  );
}

// ─── styles ─────────────────────────────────────────────────────
const panelStyle: React.CSSProperties = {
  background: FG.containerBg,
  border: `1px solid ${FG.containerBorder}`,
  borderRadius: FG.containerRadius,
  padding: 16,
  marginBottom: 16,
  boxShadow: FG.containerShadow,
};

const panelHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 14,
};

const h2Style: React.CSSProperties = {
  margin: "0 0 2px 0",
  color: FG.headingColor,
  fontSize: 16,
  fontWeight: 600,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: FG.bodyColor,
  fontFamily: "ui-monospace, monospace",
};

const inputStyle: React.CSSProperties = {
  background: FG.inputBg,
  border: `1px solid ${FG.inputBorder}`,
  color: FG.inputColor,
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "ui-monospace, monospace",
};

const noteStyle: React.CSSProperties = {
  marginTop: 14,
  padding: "8px 12px",
  background: FG.subtleBg,
  border: `1px solid ${FG.subtleBorder}`,
  borderRadius: 8,
  color: FG.mutedColor,
  fontSize: 12,
  lineHeight: 1.5,
};
