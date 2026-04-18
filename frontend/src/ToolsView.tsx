/**
 * Tools view — browse the catalog, auto-generate a form from each tool's
 * input_schema, invoke, render result as JSON (Phase B) / widget (Phase C).
 */

import {useEffect, useMemo, useState} from "react";
import {FG} from "./lib/figmaStyles";
import {displayName} from "./lib/state";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Loading,
  Panel,
  StatusPill,
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
  // Confirmation modal state — holds the cleaned inputs for the pending
  // MUTATION invocation until the user clicks Confirm (or Cancel).
  const [pendingConfirm, setPendingConfirm] = useState<Record<string, any> | null>(null);

  const selectedTool = useMemo(
    () => props.tools?.find((t) => t.name === selected) ?? null,
    [props.tools, selected],
  );

  // When the selected tool changes, reset inputs from schema defaults, and
  // pre-fill switch_ip from the global selection if the tool requires it.
  useEffect(() => {
    if (!selectedTool) { setInputs({}); setResult(null); setErr(null); return; }
    const init: Record<string, any> = {};
    const props_ = selectedTool.input_schema?.properties ?? {};
    for (const [k, def] of Object.entries(props_)) {
      const d = def as any;
      if (k === "switch_ip" && props.selectedSwitch) { init[k] = props.selectedSwitch; continue; }
      if (d?.default !== undefined) { init[k] = d.default; continue; }
      if (d?.type === "boolean") { init[k] = false; continue; }
      init[k] = "";
    }
    setInputs(init);
    setResult(null);
    setErr(null);
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
    // MUTATION / DESTRUCTIVE tools with requires_confirmation must pop the modal.
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
      // Fallback: if the server says we need confirmation and the initial check
      // somehow missed it, pop the modal instead of dumping an error.
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
          onConfirm={() => doInvoke(pendingConfirm, true)}
        />
      )}

      <h1 style={{margin: "0 0 16px 0", color: FG.titleColor, fontSize: 22, fontWeight: 600}}>
        Tools
      </h1>

      <div style={{display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: 16, alignItems: "start"}}>
        {/* Left — tool picker */}
        <Panel title={`Catalog (${props.tools?.length ?? "…"})`} style={{marginBottom: 0}}>
          {props.tools === null ? <Loading /> : (
            <ul style={{listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4}}>
              {props.tools.map((t) => {
                const active = t.name === selected;
                return (
                  <li key={t.name}>
                    <button
                      onClick={() => setSelected(t.name)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        background: active ? FG.rowSelectedBg : "transparent",
                        border: `1px solid ${active ? FG.rowSelectedBorder : FG.rowDefaultBorder}`,
                        borderRadius: 8,
                        color: active ? FG.titleColor : FG.bodyColor,
                        cursor: "pointer",
                        fontSize: 13,
                        transition: FG.transition,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.borderColor = FG.rowHoverBorder; e.currentTarget.style.background = FG.rowHoverBg; } }}
                      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.borderColor = FG.rowDefaultBorder; e.currentTarget.style.background = "transparent"; } }}
                    >
                      <span style={{fontFamily: "ui-monospace, monospace", fontWeight: 600}}>{t.name}</span>
                      <span style={{display: "flex", gap: 4, flexWrap: "wrap"}}>
                        <Badge>{t.category}</Badge>
                        <Badge>{t.transport}</Badge>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Right — form + result */}
        <div style={{minWidth: 0}}>
          {!selectedTool ? (
            <Panel><EmptyState>Pick a tool from the catalog on the left.</EmptyState></Panel>
          ) : (
            <>
              <Panel
                title={selectedTool.name}
                right={
                  <span style={{display: "flex", gap: 6}}>
                    <StatusPill tone="info">{selectedTool.transport}</StatusPill>
                    <StatusPill tone={
                      selectedTool.policy.risk === "DESTRUCTIVE" ? "bad" :
                      selectedTool.policy.risk === "MUTATION" ? "warn" : "good"
                    }>{selectedTool.policy.risk}</StatusPill>
                  </span>
                }
              >
                <div style={{color: FG.bodyColor, fontSize: 13, marginBottom: 14}}>
                  {selectedTool.description}
                </div>
                <ToolForm tool={selectedTool} inputs={inputs} onChange={setInputs} />
                <div style={{marginTop: 14, display: "flex", alignItems: "center", gap: 10}}>
                  <Button onClick={runInvoke} disabled={busy}>
                    {busy
                      ? <><span className="loading-spin" /> running…</>
                      : selectedTool.policy?.requires_confirmation
                        ? "⚠ Run (requires confirmation)"
                        : "Run"}
                  </Button>
                  {props.selectedSwitch && (
                    <span style={{fontSize: 12, color: FG.mutedColor}}>
                      Global target: <strong style={{color: FG.bodyColor}}>{displayName(props.selectedSwitch)}</strong> ({props.selectedSwitch})
                    </span>
                  )}
                </div>
                {selectedTool.policy?.risk === "MUTATION" && (
                  <div style={{
                    marginTop: 10,
                    padding: "8px 12px",
                    background: FG.warningBg,
                    border: `1px solid ${FG.warningBorder}`,
                    borderRadius: 8,
                    fontSize: 12,
                    color: FG.warningYellow,
                  }}>
                    ⚠ This is a <strong>MUTATION</strong> tool. It will change state on the target switch.
                    The change is recorded in the mutation ledger and visible in the Activity tab.
                  </div>
                )}
                {selectedTool.policy?.risk === "DESTRUCTIVE" && (
                  <div style={{
                    marginTop: 10,
                    padding: "8px 12px",
                    background: FG.errorBg,
                    border: `1px solid ${FG.errorBorder}`,
                    borderRadius: 8,
                    fontSize: 12,
                    color: FG.errorRed,
                  }}>
                    🛑 This is a <strong>DESTRUCTIVE</strong> tool. It will make changes that are difficult or impossible to reverse.
                  </div>
                )}
              </Panel>

              {err && <div style={{marginBottom: 12}}><ErrorBanner>{err}</ErrorBanner></div>}

              {result && (
                <Panel title="Result">
                  <ToolResultPanel
                    tool={result.result.tool}
                    payload={result.result.payload}
                    meta={{
                      status: result.result.status,
                      transport: result.result.meta?.transport,
                      duration_ms: result.result.meta?.duration_ms,
                    }}
                  />
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Form generator ──────────────────────────────────────────────
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
    <div style={{display: "grid", gridTemplateColumns: "140px 1fr", gap: 8, alignItems: "center"}}>
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

  const labelEl = (
    <label htmlFor={`f-${name}`} style={{fontSize: 13, color: FG.bodyColor, fontFamily: "ui-monospace, monospace"}}>
      {name}{required && <span style={{color: FG.errorRed}}> *</span>}
    </label>
  );

  let control: React.ReactNode;

  if (type === "boolean") {
    control = (
      <label style={{display: "flex", alignItems: "center", gap: 8, color: FG.bodyColor, fontSize: 13}}>
        <input
          id={`f-${name}`}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span style={{color: FG.mutedColor}}>{def?.description}</span>
      </label>
    );
  } else {
    control = (
      <div style={{display: "flex", flexDirection: "column", gap: 4}}>
        <input
          id={`f-${name}`}
          type={type === "integer" || type === "number" ? "number" : "text"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def?.description?.slice(0, 80) ?? ""}
          style={{
            background: FG.inputBg,
            border: `1px solid ${FG.inputBorder}`,
            color: FG.inputColor,
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 13,
            fontFamily: type === "string" ? "inherit" : "ui-monospace, monospace",
          }}
        />
        {def?.description && (
          <span style={{fontSize: 11, color: FG.mutedColor}}>{def.description}</span>
        )}
      </div>
    );
  }

  return (
    <>
      {labelEl}
      {control}
    </>
  );
}
