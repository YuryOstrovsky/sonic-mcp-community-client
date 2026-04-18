/**
 * Settings view — configure LLM providers. Persisted in backend/settings.json.
 * Precedence at read time: settings.json → env (.env) → hardcoded defaults.
 */

import {useEffect, useState, type ReactNode} from "react";
import {ChevronDown} from "lucide-react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import {cn} from "./lib/cn";
import {ErrorBanner, Loading} from "./shared";
import {
  getSettings, patchSettings,
  getFabricIntent, putFabricIntent,
  getInventory, addInventorySwitch, deleteInventorySwitch, probeInventorySwitch, discoverFabric,
  type SettingsView as S, type FabricIntentView,
  type InventoryView, type ProbeResult,
} from "./lib/api";
import {notify} from "./lib/notify";

// Curated Ollama model presets. "recommended" marks the one we've tested for
// JSON tool-selection (small + reliable on a CPU-only lab host).
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
      if (update.openai && "api_key" in update.openai) setOpenaiKey("");
      setTimeout(() => setFlash(null), 3000);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="p-5">{err ? <ErrorBanner>{err}</ErrorBanner> : <Loading />}</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-100">Settings</h1>
        <p className="mt-2 text-sm text-gray-400">
          Persisted at <code className="rounded bg-white/[0.04] px-1.5 py-0.5 text-xs">{data.storage_path}</code> (mode 0600).
          Precedence: <b>settings.json → .env → default</b>.
        </p>
      </div>

      {flash && (
        <div className="rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-300">
          {flash}
        </div>
      )}
      {err && <ErrorBanner>{err}</ErrorBanner>}

      {/* Active provider */}
      <Section
        title="Active LLM provider"
        badge={<Chip tone={
          data.effective_provider === "openai" ? "good" :
          data.effective_provider === "ollama" ? "info" : "neutral"
        }>active: {data.effective_provider ?? "none"}</Chip>}
        defaultOpen
      >
        <p className="mb-4 text-sm text-gray-400">
          Choose which provider the NL router falls back to when regex doesn't match.
          "Auto" picks the best available — OpenAI first, then Ollama.
        </p>

        <div className="flex flex-col gap-3">
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
            subtitle={data.openai.configured ? "Cloud — ready to use" : "No API key configured — save one below first"}
            available={data.openai.configured}
            onPick={(v) => apply({preferred_provider: v}, `preferred provider → ${v}`)}
            busy={busy}
          />
          <ProviderRadio
            value="ollama"
            selected={data.preferred_provider}
            title={`Ollama (${data.ollama.model})`}
            subtitle={data.ollama.enabled ? `Local — ${data.ollama.base_url}` : "Not enabled — turn on in the Ollama panel below first"}
            available={data.ollama.enabled}
            onPick={(v) => apply({preferred_provider: v}, `preferred provider → ${v}`)}
            busy={busy}
          />
        </div>

        {data.preferred_provider === "openai" && !data.openai.configured && (
          <Warn>⚠ Pinned to OpenAI, but no API key is set. LLM fallback is effectively disabled until you save a key below.</Warn>
        )}
        {data.preferred_provider === "ollama" && !data.ollama.enabled && (
          <Warn>⚠ Pinned to Ollama, but it isn't enabled. Enable it in the Ollama panel below.</Warn>
        )}
      </Section>

      {/* OpenAI */}
      <Section
        title="OpenAI"
        badge={<Chip tone={data.openai.configured ? "good" : "neutral"}>
          {data.openai.configured ? "configured" : "not configured"}
        </Chip>}
      >
        <p className="mb-5 text-sm text-gray-400">
          Cloud LLM. Fastest path to good results. Requires an API key from{" "}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
            platform.openai.com
          </a>.
        </p>

        <div className="mb-5 grid grid-cols-2 gap-6">
          <div>
            <div className="mb-1.5 text-xs uppercase tracking-wider text-gray-500">API key</div>
            {data.openai.key_preview ? (
              <div className="flex items-center gap-2">
                <code className="font-mono text-sm text-gray-200">{data.openai.key_preview}</code>
                <SourceBadge>{data.openai.key_source}</SourceBadge>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                no key set
                <SourceBadge>{data.openai.key_source ?? "default"}</SourceBadge>
              </div>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-xs uppercase tracking-wider text-gray-500">Model</div>
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm text-gray-200">{data.openai.model}</code>
              <SourceBadge>{data.openai.model_source}</SourceBadge>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <Field label="New API key" id="openai-key">
            <input
              id="openai-key"
              type="password"
              placeholder="sk-…"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Model" id="openai-model">
            <input
              id="openai-model"
              type="text"
              placeholder="gpt-4o-mini"
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              className={INPUT_CLS}
            />
          </Field>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          {data.openai.configured && (
            <button
              disabled={busy}
              onClick={() => apply({openai: {api_key: ""}}, "OpenAI key cleared")}
              className="rounded border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.08] disabled:opacity-50"
            >Clear key</button>
          )}
          <button
            disabled={busy || (!openaiKey.trim() && openaiModel === data.openai.model)}
            onClick={() => {
              const update: Record<string, any> = {};
              if (openaiKey.trim()) update.api_key = openaiKey.trim();
              if (openaiModel.trim() && openaiModel !== data.openai.model) update.model = openaiModel.trim();
              return apply({openai: update}, "OpenAI settings saved");
            }}
            className="rounded bg-orange-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
          >{busy ? "…" : "Save OpenAI"}</button>
        </div>

        <p className="mt-4 text-xs text-gray-500">
          Key is stored in <code className="rounded bg-white/[0.04] px-1 py-0.5">settings.json</code> on the backend. Never committed
          (already in <code className="rounded bg-white/[0.04] px-1 py-0.5">.gitignore</code>), never sent anywhere except the OpenAI
          API when the LLM fallback fires. This host has no auth — anyone on this network can read or change these settings.
        </p>
      </Section>

      {/* Ollama */}
      <Section
        title="Ollama (local LLM)"
        badge={<Chip tone={data.ollama.enabled ? "info" : "neutral"}>
          {data.ollama.enabled ? "enabled" : "disabled"}
        </Chip>}
      >
        <p className="mb-5 text-sm text-gray-400">
          Runs an LLM on-host or on a nearby machine. Free, air-gapped, slower.
          Quality depends on the model you pick.
        </p>

        <div className="mb-5">
          <div className="mb-1.5 text-xs uppercase tracking-wider text-gray-500">Base URL</div>
          <code className="font-mono text-sm text-gray-200">{data.ollama.base_url}</code>
        </div>

        <div className="space-y-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={ollamaEnabled}
              onChange={(e) => setOllamaEnabled(e.target.checked)}
              className="h-4 w-4 rounded accent-blue-500"
            />
            Use Ollama when OpenAI isn't configured
          </label>

          <Field label="Base URL" id="ollama-url">
            <input
              id="ollama-url"
              type="text"
              placeholder="http://127.0.0.1:11434"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Model" id="ollama-model">
            <div className="space-y-2">
              <select
                id="ollama-model"
                value={isOllamaPreset(ollamaModel) ? ollamaModel : "__custom__"}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setOllamaModel(ollamaModel || "qwen2.5:3b-instruct");
                  } else {
                    setOllamaModel(e.target.value);
                  }
                }}
                className={INPUT_CLS}
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
                  className={INPUT_CLS}
                />
              )}
            </div>
          </Field>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            disabled={busy}
            onClick={() => apply({ollama: {
              enabled: ollamaEnabled,
              base_url: ollamaUrl,
              model: ollamaModel,
            }}, "Ollama settings saved")}
            className="rounded bg-orange-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
          >{busy ? "…" : "Save Ollama"}</button>
        </div>

        <div className="mt-5 rounded-lg border border-white/[0.06] bg-[#0d1220] p-4">
          <div className="mb-2 text-xs uppercase tracking-wider text-gray-500">
            How to install Ollama + pull {ollamaModel || "a model"}
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-400">
{`# 1. Install (Linux / macOS):
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull the selected model (${ollamaModel || "<model>"}):
ollama pull ${ollamaModel || "<model>"}

# 3. Ollama auto-starts a local service. Verify it's running:
curl http://127.0.0.1:11434/api/tags

# 4. Enable Ollama above (checkbox + Save), then pin it in the
#    "Active LLM provider" panel at the top of this page.`}
          </pre>
        </div>

        <p className="mt-4 text-xs text-gray-500">
          If this backend runs on a different host than Ollama, set Base URL accordingly. CORS isn't a concern (the backend makes the call, not the browser).
        </p>
      </Section>

      {/* Fabric inventory */}
      <FabricInventorySection />

      {/* Fabric intent editor */}
      <FabricIntentSection />

      {/* Other providers */}
      <Section
        title="Other providers"
        badge={<Chip tone="info">planned</Chip>}
      >
        <p className="text-sm text-gray-400">
          Anthropic Claude, Gemini, Mistral Cloud, etc. — not wired yet. The settings schema is extensible;
          adding a new provider is a single new client class in <code className="rounded bg-white/[0.04] px-1 py-0.5">backend/llm.py</code>.
        </p>
      </Section>
    </div>
  );
}

// ─── Fabric Intent editor section ─────────────────────────────

function FabricIntentSection() {
  const [view, setView] = useState<FabricIntentView | null>(null);
  const [text, setText] = useState<string>("");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setLoadErr(null);
    try {
      const v = await getFabricIntent();
      setView(v);
      const body = v.raw
        ? v.raw
        : v.content
          ? JSON.stringify(v.content, null, 2)
          : JSON.stringify(_EXAMPLE, null, 2);
      setText(body);
      setDirty(false);
    } catch (e: any) {
      setLoadErr(e?.message ?? String(e));
    }
  }

  useEffect(() => { load(); }, []);

  function onTextChange(v: string) {
    setText(v);
    setDirty(true);
    setFlash(null);
    setSaveErr(null);
  }

  function validateLocal(): boolean {
    setSaveErr(null);
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setSaveErr("intent must be a JSON object at the top level (e.g. {\"switches\": {…}})");
        return false;
      }
      setFlash("JSON is valid");
      setTimeout(() => setFlash(null), 2000);
      return true;
    } catch (e: any) {
      setSaveErr(`invalid JSON: ${e?.message ?? e}`);
      return false;
    }
  }

  async function save() {
    if (!validateLocal()) return;
    setBusy(true);
    setFlash(null);
    setSaveErr(null);
    try {
      const res = await putFabricIntent({raw: text});
      setFlash(`saved (${res.size_bytes} bytes)`);
      setDirty(false);
      // Re-fetch so parse_error clears / size updates.
      await load();
      setTimeout(() => setFlash(null), 3000);
    } catch (e: any) {
      setSaveErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const existsBadge = !view
    ? <Chip tone="neutral">loading</Chip>
    : view.parse_error
      ? <Chip tone="neutral">invalid JSON on disk</Chip>
      : view.exists
        ? <Chip tone="good">loaded</Chip>
        : <Chip tone="neutral">no file</Chip>;

  return (
    <Section title="Fabric intent" badge={existsBadge}>
      <p className="mb-4 text-sm text-gray-400">
        The JSON file consumed by <code className="rounded bg-white/[0.04] px-1 py-0.5">validate_fabric_vs_intent</code>.
        Declare expected ASN, BGP peers, and interface IP/MTU per switch; the tool reports drift against live state.
      </p>

      {loadErr && <ErrorBanner>{loadErr}</ErrorBanner>}
      {view && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="uppercase tracking-wider text-gray-500">Path</span>
          <code className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-gray-200">{view.path}</code>
          {view.source && <Chip tone="neutral">source: {view.source}</Chip>}
          {view.size_bytes != null && <span className="text-gray-500">{view.size_bytes} bytes</span>}
        </div>
      )}

      {view?.parse_error && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          on-disk file has a syntax error: {view.parse_error}. Fix it here and click Save.
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        spellCheck={false}
        className={cn(
          "block min-h-[320px] w-full resize-y rounded border border-white/10 bg-[#0d1220] px-3 py-2",
          "font-mono text-xs leading-relaxed text-gray-200 placeholder:text-gray-500",
          "focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20",
        )}
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-xs text-gray-500">
          {dirty ? "unsaved changes" : "no unsaved changes"}
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={busy}
            className="rounded border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.08] disabled:opacity-50"
          >Reload</button>
          <button
            onClick={validateLocal}
            disabled={busy}
            className="rounded border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.08] disabled:opacity-50"
          >Validate JSON</button>
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="rounded bg-orange-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
          >{busy ? "…" : "Save intent"}</button>
        </div>
      </div>

      {flash && (
        <div className="mt-3 rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-300">
          {flash}
        </div>
      )}
      {saveErr && (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {saveErr}
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500">
        Override the path at runtime by setting <code className="rounded bg-white/[0.04] px-1 py-0.5">SONIC_FABRIC_INTENT_PATH</code> on
        the server. In Docker, bind-mount your intent file into <code className="rounded bg-white/[0.04] px-1 py-0.5">/app/config</code>.
      </p>
    </Section>
  );
}

const _EXAMPLE = {
  switches: {
    "10.46.11.50": {
      asn: 65100,
      hostname: "vm1",
      expected_bgp_peers: [{peer_ip: "192.168.1.2", remote_asn: 65100}],
      expected_interfaces: [{name: "Ethernet0", address: "192.168.1.1/30", mtu: 9100}],
    },
  },
};

// ─── Section: Radix collapsible panel ───────────────────────────
function Section({title, badge, children, defaultOpen = false}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <CollapsiblePrimitive.Root
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-lg border border-white/[0.08] bg-[#1a2332]"
    >
      <CollapsiblePrimitive.Trigger
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[#1d2738]"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
          {badge}
        </div>
        <ChevronDown className={cn("h-5 w-5 text-gray-400 transition-transform", open && "rotate-180")} />
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="cols-anim overflow-hidden">
        <div className="border-t border-white/[0.06] px-5 pb-6 pt-5">
          {children}
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}

// ─── Field wrapper ────────────────────────────────────────────
function Field({label, id, children}: {label: string; id?: string; children: ReactNode}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-gray-300">{label}</label>
      {children}
    </div>
  );
}

// ─── Chip / badge variants ────────────────────────────────────
function Chip({tone, children}: {tone: "good" | "info" | "neutral"; children: ReactNode}) {
  const cls = tone === "good"
    ? "bg-green-500/10 text-green-300 border-green-500/20"
    : tone === "info"
    ? "bg-blue-500/10 text-blue-300 border-blue-500/20"
    : "bg-white/[0.04] text-gray-400 border-white/10";
  return <span className={cn("rounded border px-2.5 py-1 text-xs", cls)}>{children}</span>;
}

function SourceBadge({children}: {children: ReactNode}) {
  return <span className="rounded bg-white/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-400">{children}</span>;
}

function Warn({children}: {children: ReactNode}) {
  return (
    <div className="mt-4 rounded-md border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
      {children}
    </div>
  );
}

// ─── Provider radio card ───────────────────────────────────────
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
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 transition-colors",
        active
          ? "border-blue-500/40 bg-[#0d1220]"
          : "border-white/10 bg-[#0d1220]/50 hover:border-white/20",
        dim && "opacity-60",
        props.busy && "cursor-wait",
      )}
    >
      <div className="flex items-center gap-3">
        <input
          type="radio"
          name="preferred-provider"
          checked={active}
          disabled={props.busy}
          onChange={() => props.onPick(props.value)}
          className="h-4 w-4 accent-blue-500"
        />
        <div>
          <div className={cn("text-sm font-medium", active ? "text-gray-100" : "text-gray-200")}>
            {props.title}
          </div>
          <div className="mt-0.5 text-xs text-gray-400">{props.subtitle}</div>
        </div>
      </div>
      {active && (
        <span className="rounded bg-green-500/10 px-2 py-1 text-xs text-green-300">selected</span>
      )}
    </label>
  );
}

// ─── Shared input class ───────────────────────────────────────
const INPUT_CLS = "w-full rounded border border-white/10 bg-[#0d1220] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20";

// ─── Fabric Inventory section ───────────────────────────────
//
// Lets operators add/remove/probe switches from the web UI without
// editing `sonic/inventory.py` or bouncing the container. Backed by the
// server's /inventory endpoints; writes go straight to
// config/inventory.json (live-reloaded by the server).

function FabricInventorySection() {
  const [inv, setInv] = useState<InventoryView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState<Record<string, boolean>>({});
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult>>({});

  // Add-form state
  const [form, setForm] = useState({name: "", mgmt_ip: "", tags: "", username: "", password: ""});

  // Discovery state
  const [discoverSeed, setDiscoverSeed] = useState("");
  const [discovering, setDiscovering] = useState(false);

  async function refresh() {
    setErr(null);
    try { setInv(await getInventory()); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }
  useEffect(() => { refresh(); }, []);

  async function addSwitch() {
    if (!form.mgmt_ip.trim()) { notify.err("mgmt_ip is required"); return; }
    setBusy(true);
    try {
      const next = await addInventorySwitch({
        name: form.name.trim() || form.mgmt_ip.trim(),
        mgmt_ip: form.mgmt_ip.trim(),
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        username: form.username.trim() || undefined,
        password: form.password || undefined,
      });
      setInv(next);
      setForm({name: "", mgmt_ip: "", tags: "", username: "", password: ""});
      notify.ok(`added ${form.mgmt_ip}`);
    } catch (e: any) {
      notify.err("add failed", e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  async function removeSwitch(ip: string) {
    if (!confirm(`Remove ${ip} from inventory?`)) return;
    setBusy(true);
    try {
      const next = await deleteInventorySwitch(ip);
      setInv(next);
      setProbeResults((p) => { const c = {...p}; delete c[ip]; return c; });
      notify.ok(`removed ${ip}`);
    } catch (e: any) {
      notify.err("remove failed", e?.message ?? String(e));
    } finally { setBusy(false); }
  }

  async function probeOne(ip: string) {
    setProbing((p) => ({...p, [ip]: true}));
    try {
      const res = await probeInventorySwitch({mgmt_ip: ip});
      setProbeResults((p) => ({...p, [ip]: res}));
      if (res.restconf && res.ssh) notify.ok(`${ip} reachable on both transports`);
      else if (res.restconf || res.ssh) notify.warn(`${ip} partial — ${res.restconf ? "RESTCONF" : "SSH"} only`);
      else notify.err(`${ip} unreachable`, res.errors.join("; ") || undefined);
    } catch (e: any) {
      notify.err("probe failed", e?.message ?? String(e));
    } finally {
      setProbing((p) => { const c = {...p}; delete c[ip]; return c; });
    }
  }

  async function runDiscovery() {
    if (!discoverSeed.trim()) { notify.err("pick a seed switch first"); return; }
    setDiscovering(true);
    try {
      const env = await discoverFabric(discoverSeed.trim(), 2);
      const payload = env?.result?.payload ?? {};
      const proposals = payload.proposed_additions ?? [];
      if (proposals.length === 0) {
        notify.info("no new switches found", "LLDP RX is often empty on SONiC VS — try real hardware.");
      } else {
        const list = proposals.map((p: any) => `${p.name} (${p.mgmt_ip})`).join(", ");
        if (confirm(`Found ${proposals.length} switch(es): ${list}\n\nAdd them all to inventory?`)) {
          for (const p of proposals) {
            await addInventorySwitch({name: p.name, mgmt_ip: p.mgmt_ip, tags: p.tags ?? ["discovered"]});
          }
          await refresh();
          notify.ok(`added ${proposals.length} discovered switch(es)`);
        }
      }
    } catch (e: any) {
      notify.err("discovery failed", e?.message ?? String(e));
    } finally { setDiscovering(false); }
  }

  return (
    <Section
      title="Fabric inventory"
      badge={inv ? <Chip tone={inv.source === "file" ? "good" : "neutral"}>{inv.source}</Chip> : <Chip tone="neutral">loading</Chip>}
    >
      <p className="mb-4 text-sm text-gray-400">
        The list of switches this MCP server talks to. Changes persist to
        <code className="mx-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-xs">{inv?.path ?? "config/inventory.json"}</code>
        and reload live — no server restart.
      </p>

      {err && <ErrorBanner>{err}</ErrorBanner>}

      {/* Switch list */}
      {inv && (
        <div className="mb-5 overflow-hidden rounded-lg border border-white/[0.08]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0d1220] text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Mgmt IP</th>
                <th className="px-3 py-2">Tags</th>
                <th className="px-3 py-2">Creds</th>
                <th className="px-3 py-2">Last probe</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {inv.switches.length === 0 ? (
                <tr><td colSpan={6} className="p-4 text-center text-xs text-gray-500">No switches configured.</td></tr>
              ) : inv.switches.map((d) => {
                const pr = probeResults[d.mgmt_ip];
                return (
                  <tr key={d.mgmt_ip} className="border-t border-white/[0.06]">
                    <td className="px-3 py-2 font-semibold text-gray-100">{d.name}</td>
                    <td className="px-3 py-2 font-mono text-gray-300">{d.mgmt_ip}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">{d.tags.join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {d.username || d.has_password
                        ? <span className="text-gray-300">override set</span>
                        : <span className="text-gray-500">env defaults</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {pr
                        ? <ProbeBadge result={pr} />
                        : <span className="text-gray-500">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => probeOne(d.mgmt_ip)}
                        disabled={!!probing[d.mgmt_ip]}
                        className="mr-2 rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-gray-300 hover:bg-white/[0.08] disabled:opacity-50"
                      >{probing[d.mgmt_ip] ? "probing…" : "probe"}</button>
                      <button
                        onClick={() => removeSwitch(d.mgmt_ip)}
                        disabled={busy}
                        className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                      >remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add form */}
      <div className="mb-5 rounded-lg border border-white/[0.08] bg-[#0d1220] p-4">
        <div className="mb-3 text-xs uppercase tracking-wider text-gray-500">Add / update a switch</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" id="inv-name">
            <input id="inv-name" className={INPUT_CLS}
              placeholder="e.g. leaf-01 (falls back to mgmt_ip)"
              value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
          </Field>
          <Field label="Management IP *" id="inv-ip">
            <input id="inv-ip" className={INPUT_CLS}
              placeholder="10.0.0.5"
              value={form.mgmt_ip} onChange={(e) => setForm({...form, mgmt_ip: e.target.value})} />
          </Field>
          <Field label="Tags (comma-separated)" id="inv-tags">
            <input id="inv-tags" className={INPUT_CLS}
              placeholder="leaf, rack-3"
              value={form.tags} onChange={(e) => setForm({...form, tags: e.target.value})} />
          </Field>
          <Field label="Username (optional override)" id="inv-user">
            <input id="inv-user" className={INPUT_CLS}
              placeholder="leave blank → SONIC_DEFAULT_USERNAME"
              value={form.username} onChange={(e) => setForm({...form, username: e.target.value})} />
          </Field>
          <Field label="Password (optional override)" id="inv-pw">
            <input id="inv-pw" type="password" className={INPUT_CLS}
              placeholder="leave blank → SONIC_DEFAULT_PASSWORD"
              value={form.password} onChange={(e) => setForm({...form, password: e.target.value})} />
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={addSwitch} disabled={busy || !form.mgmt_ip.trim()}
            className="rounded bg-orange-600/90 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
          >{busy ? "…" : "Add switch"}</button>
        </div>
      </div>

      {/* LLDP-seed discovery */}
      <div className="rounded-lg border border-white/[0.08] bg-[#0d1220] p-4">
        <div className="mb-3 text-xs uppercase tracking-wider text-gray-500">Discover via LLDP (seed walk)</div>
        <p className="mb-3 text-xs text-gray-500">
          Starts from an existing switch, reads its LLDP neighbors, resolves each management IP, and proposes additions.
          Works best on real hardware — SONiC VS has known LLDP-RX issues.
        </p>
        <div className="flex items-center gap-2">
          <select
            value={discoverSeed} onChange={(e) => setDiscoverSeed(e.target.value)}
            className="h-9 flex-1 rounded border border-white/10 bg-[#1a2332] px-3 text-sm text-gray-200"
          >
            <option value="">— pick a seed switch —</option>
            {(inv?.switches ?? []).map((d) => (
              <option key={d.mgmt_ip} value={d.mgmt_ip}>{d.name} ({d.mgmt_ip})</option>
            ))}
          </select>
          <button
            onClick={runDiscovery} disabled={discovering || !discoverSeed}
            className="rounded border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.08] disabled:opacity-50"
          >{discovering ? "walking LLDP…" : "Discover"}</button>
        </div>
      </div>
    </Section>
  );
}

function ProbeBadge({result}: {result: ProbeResult}) {
  if (result.restconf && result.ssh) return <Chip tone="good">ok</Chip>;
  if (result.restconf || result.ssh) return <Chip tone="neutral">partial</Chip>;
  return <Chip tone="neutral">down</Chip>;
}
