/**
 * Tools view — browse the catalog, auto-generate a form from each tool's
 * input_schema, invoke, render result.
 */

import {useEffect, useMemo, useState} from "react";
import {Search} from "lucide-react";
import {cn} from "./lib/cn";
import {displayName} from "./lib/state";
import {
  EmptyState,
  ErrorBanner,
  Loading,
} from "./shared";
import {ToolResultPanel} from "./widgets";
import {ConfirmationModal} from "./ConfirmationModal";
import {ApiError, invoke, type InvokeEnvelope, type ToolSpec} from "./lib/api";

export function ToolsView(props: {
  tools: ToolSpec[] | null;
  selectedSwitch: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, any>>({});
  const [result, setResult] = useState<InvokeEnvelope | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<Record<string, any> | null>(null);

  const selectedTool = useMemo(
    () => props.tools?.find((t) => t.name === selected) ?? null,
    [props.tools, selected],
  );

  // The command palette can jump here with a tool pre-selected.
  useEffect(() => {
    const handler = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      if (typeof name === "string" && name) setSelected(name);
    };
    window.addEventListener("sonic-mcp:open-tool", handler);
    return () => window.removeEventListener("sonic-mcp:open-tool", handler);
  }, []);

  const filteredTools = useMemo(
    () => {
      if (!props.tools) return null;
      const q = search.trim().toLowerCase();
      if (!q) return props.tools;
      return props.tools.filter((t) =>
        t.name.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.transport?.toLowerCase().includes(q),
      );
    },
    [props.tools, search],
  );

  useEffect(() => {
    if (!selectedTool) { setInputs({}); setResult(null); setErr(null); return; }
    const init: Record<string, any> = {};
    const props_ = selectedTool.input_schema?.properties ?? {};
    for (const [k, def] of Object.entries(props_)) {
      const d = def as any;
      // Pre-fill any "*_switch_ip" field (switch_ip, seed_switch_ip,
      // source_switch_ip, left/right/src/dst_switch_ip, …) from the
      // globally-selected switch. Users still edit them freely.
      if (/(?:^|_)switch_ip$/.test(k) && props.selectedSwitch) {
        init[k] = props.selectedSwitch;
        continue;
      }
      if (d?.default !== undefined) { init[k] = d.default; continue; }
      if (d?.type === "boolean") { init[k] = false; continue; }
      init[k] = "";
    }
    setInputs(init);
    setResult(null);
    setErr(null);
    // We intentionally key the reset on tool identity + selectedSwitch,
    // not the whole selectedTool object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTool?.name, props.selectedSwitch]);

  function cleanInputs(): Record<string, any> {
    if (!selectedTool) return {};
    const cleaned: Record<string, any> = {};
    const required = new Set(selectedTool.input_schema?.required ?? []);
    for (const [k, v] of Object.entries(inputs)) {
      if (v === "" && !required.has(k)) continue;
      const def = (selectedTool.input_schema?.properties ?? {})[k] as any;
      if (def?.type === "integer" && typeof v === "string") {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) { cleaned[k] = n; continue; }
      }
      if (def?.type === "number" && typeof v === "string") {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) { cleaned[k] = n; continue; }
      }
      cleaned[k] = v;
    }
    return cleaned;
  }

  async function runInvoke() {
    if (!selectedTool) return;
    const cleaned = cleanInputs();
    if (selectedTool.policy?.requires_confirmation) {
      setPendingConfirm(cleaned);
      setErr(null);
      return;
    }
    await doInvoke(cleaned, false);
  }

  async function doInvoke(cleaned: Record<string, any>, confirm: boolean) {
    if (!selectedTool) return;
    setBusy(true);
    setErr(null);
    try {
      const envelope = await invoke(selectedTool.name, cleaned, {confirm});
      setResult(envelope);
      setPendingConfirm(null);
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : String(e?.message ?? e);
      if (e instanceof ApiError && e.status === 403 && /requires\s+explicit\s+confirmation/i.test(msg) && !confirm) {
        setPendingConfirm(cleaned);
      } else {
        setErr(e instanceof ApiError ? `${e.status}: ${e.message}` : msg);
        setPendingConfirm(null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {pendingConfirm !== null && selectedTool && (
        <ConfirmationModal
          tool={selectedTool}
          inputs={pendingConfirm}
          busy={busy}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={(edited) => doInvoke(edited, true)}
        />
      )}

      <div className="mb-4 flex items-end justify-between">
        <h1 className="text-2xl font-semibold text-gray-100">Tools</h1>
        <div className="text-sm text-gray-400">
          Catalog ({filteredTools?.length ?? "…"}{search && props.tools && filteredTools && filteredTools.length !== props.tools.length
            ? `/${props.tools.length}` : ""})
        </div>
      </div>

      <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
        {/* Left — tool picker */}
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tools…"
              className="w-full rounded-lg border border-white/10 bg-[#0d1220] py-2 pl-9 pr-3 text-sm text-gray-200 placeholder:text-gray-500 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20"
            />
          </div>

          <div className="flex max-h-[calc(100vh-230px)] flex-col gap-1 overflow-y-auto pr-1">
            {filteredTools === null ? <Loading /> : filteredTools.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">No tools match "{search}"</div>
            ) : filteredTools.map((t) => {
              const active = t.name === selected;
              return (
                <button
                  key={t.name}
                  onClick={() => setSelected(t.name)}
                  className={cn(
                    "w-full rounded-lg p-3 text-left transition-colors",
                    active
                      ? "bg-[#1a2332]"
                      : "hover:bg-[#1a2332]/50",
                  )}
                >
                  <div className="mb-1 font-mono text-sm text-gray-200">{t.name}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span>{t.transport}</span>
                    <span className={cn(
                      "uppercase",
                      t.policy.risk === "DESTRUCTIVE" ? "text-red-400" :
                      t.policy.risk === "MUTATION" ? "text-yellow-400" :
                      "text-green-400/80",
                    )}>
                      {t.policy.risk}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right — form + result */}
        <div className="min-w-0">
          {!selectedTool ? (
            <div className="flex h-[400px] items-center justify-center rounded-lg border border-white/[0.08] bg-[#1a2332] text-gray-500">
              Pick a tool from the catalog on the left
            </div>
          ) : (
            <>
              <div className="mb-4 rounded-lg border border-white/[0.08] bg-[#1a2332] p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-mono text-lg font-semibold text-gray-100">{selectedTool.name}</h3>
                  <div className="flex gap-2">
                    <span className="rounded border border-blue-500/40 px-2 py-1 text-xs text-blue-300/80">
                      {selectedTool.transport}
                    </span>
                    <span className={cn(
                      "rounded border px-2 py-1 text-xs",
                      selectedTool.policy.risk === "DESTRUCTIVE" ? "border-red-500/40 text-red-300/80" :
                      selectedTool.policy.risk === "MUTATION" ? "border-yellow-500/40 text-yellow-300/80" :
                      "border-green-500/40 text-green-300/80",
                    )}>
                      {selectedTool.policy.risk}
                    </span>
                  </div>
                </div>

                <p className="mb-5 text-sm text-gray-300">{selectedTool.description}</p>

                <ToolForm tool={selectedTool} inputs={inputs} onChange={setInputs} />

                <div className="mt-5 flex items-center gap-3">
                  <button
                    onClick={runInvoke}
                    disabled={busy}
                    className={cn(
                      "rounded px-4 py-2 text-sm font-medium text-white transition-colors",
                      selectedTool.policy?.requires_confirmation
                        ? "bg-yellow-600/90 hover:bg-yellow-600"
                        : "bg-orange-600/90 hover:bg-orange-600",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                  >
                    {busy
                      ? "running…"
                      : selectedTool.policy?.requires_confirmation
                        ? "⚠ Run (requires confirmation)"
                        : "Run"}
                  </button>
                  {props.selectedSwitch && (
                    <span className="text-sm text-gray-400">
                      Global target: <strong className="text-gray-200">{displayName(props.selectedSwitch)}</strong> ({props.selectedSwitch})
                    </span>
                  )}
                </div>

                {selectedTool.policy?.risk === "MUTATION" && (
                  <div className="mt-4 rounded-md border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
                    ⚠ This is a <strong>MUTATION</strong> tool. It will change state on the target switch.
                    The change is recorded in the mutation ledger and visible in the Activity tab.
                  </div>
                )}
                {selectedTool.policy?.risk === "DESTRUCTIVE" && (
                  <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    🛑 This is a <strong>DESTRUCTIVE</strong> tool. It will make changes that are difficult or impossible to reverse.
                  </div>
                )}
              </div>

              {err && <div className="mb-3"><ErrorBanner>{err}</ErrorBanner></div>}

              {result && (
                <div className="rounded-lg border border-white/[0.08] bg-[#1a2332] p-5">
                  <div className="mb-3 text-xs uppercase tracking-wider text-gray-500">Result</div>
                  <ToolResultPanel
                    tool={result.result.tool}
                    payload={result.result.payload}
                    meta={{
                      status: result.result.status,
                      transport: result.result.meta?.transport,
                      duration_ms: result.result.meta?.duration_ms,
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolForm(props: {
  tool: ToolSpec;
  inputs: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
}) {
  const schema = props.tool.input_schema ?? {type: "object", properties: {}};
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties ?? {});

  if (fields.length === 0) {
    return <EmptyState>No inputs.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-4">
      {fields.map(([key, def]: [string, any]) => (
        <FormField
          key={key}
          name={key}
          def={def}
          required={required.has(key)}
          value={props.inputs[key] ?? ""}
          onChange={(v) => props.onChange({...props.inputs, [key]: v})}
        />
      ))}
    </div>
  );
}

function FormField(props: {
  name: string;
  def: any;
  required: boolean;
  value: any;
  onChange: (v: any) => void;
}) {
  const {name, def, required, value, onChange} = props;
  const type = def?.type ?? "string";

  const label = (
    <label htmlFor={`f-${name}`} className="mb-1.5 block">
      <span className="font-mono text-sm text-gray-300">
        {name}{required && <span className="ml-1 text-red-400">*</span>}
      </span>
    </label>
  );

  if (type === "boolean") {
    return (
      <div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
          <input
            id={`f-${name}`}
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded accent-blue-500"
          />
          <span className="font-mono">{name}{required && <span className="ml-1 text-red-400">*</span>}</span>
          {def?.description && <span className="text-xs text-gray-500">— {def.description}</span>}
        </label>
      </div>
    );
  }

  return (
    <div>
      {label}
      <input
        id={`f-${name}`}
        type={type === "integer" || type === "number" ? "number" : "text"}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={def?.description?.slice(0, 80) ?? ""}
        className={cn(
          "w-full rounded border border-white/10 bg-[#0d1220] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500",
          "focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20",
          type === "string" ? "" : "font-mono",
        )}
      />
      {def?.description && (
        <p className="mt-1 text-xs text-gray-500">{def.description}</p>
      )}
    </div>
  );
}
