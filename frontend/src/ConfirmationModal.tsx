/**
 * Confirmation modal for MUTATION / DESTRUCTIVE tools.
 *
 * Shown before any tool with policy.requires_confirmation=true is invoked.
 * Inputs are EDITABLE — the values passed in are the proposed defaults
 * (from NL routing or from Help-widget clicks), and the user can tweak
 * each field before committing. Switch target stays read-only (that's a
 * global selection concept). On confirm, we hand the edited inputs back
 * to the caller via onConfirm(nextInputs).
 *
 * UX notes:
 *   - Enter does NOT auto-confirm — mutations deserve a deliberate click.
 *   - Esc / backdrop click / Cancel abort.
 *   - Required-but-empty fields + enum-mismatches are highlighted and
 *     block the Confirm button.
 */

import {useEffect, useMemo, useState} from "react";
import {FG} from "./lib/figmaStyles";
import {displayName} from "./lib/state";
import {Badge, StatusPill} from "./shared";
import {getSuggestionProvider, type Suggestion} from "./lib/fieldSuggestions";
import type {ToolSpec} from "./lib/api";

export function ConfirmationModal(props: {
  tool: ToolSpec;
  inputs: Record<string, any>;
  onCancel: () => void;
  onConfirm: (editedInputs: Record<string, any>) => void;
  busy?: boolean;
}) {
  const {tool, inputs: initial, onCancel, onConfirm, busy} = props;
  const risk = tool.policy?.risk || "SAFE_READ";
  const isDestructive = risk === "DESTRUCTIVE";

  // Edit buffer — seeded from the incoming inputs. The caller's object
  // is never mutated; we pass a new object back in onConfirm.
  const [edited, setEdited] = useState<Record<string, any>>(() => ({...initial}));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel, busy]);

  // Collect every "target switch" field present on the inputs, so the
  // top panel shows them with resolved names. switch_ip is treated as
  // the canonical global target (editable only via the top-bar picker);
  // sibling *_switch_ip fields (seed_switch_ip, source_switch_ip,
  // left/right_switch_ip, src/dst_switch_ip, etc.) stay editable below.
  const targetSwitchEntries: {key: string; ip: string}[] = Object.entries(edited)
    .filter(([k, v]) => /(?:^|_)switch_ip$/.test(k) && typeof v === "string" && v)
    .map(([key, ip]) => ({key, ip: ip as string}));
  // Fields to render as editable rows = everything in the input schema
  // EXCEPT switch_ip (that's set elsewhere via the top-bar picker).
  const schema = tool.input_schema ?? {type: "object", properties: {}};
  const requiredSet = new Set(schema.required ?? []);
  const fieldOrder = useMemo(() => {
    const fromSchema = Object.keys(schema.properties ?? {}).filter((k) => k !== "switch_ip");
    // Append any inputs that aren't in the schema — unusual but lets the
    // modal round-trip NL-derived values even if they're not declared.
    const extras = Object.keys(edited).filter(
      (k) => k !== "switch_ip" && !fromSchema.includes(k),
    );
    return [...fromSchema, ...extras];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.name]);

  // ---------- Validation ----------
  const errors: Record<string, string> = {};
  for (const key of fieldOrder) {
    const def = (schema.properties ?? {})[key] as any || {};
    const val = edited[key];
    const isEmpty = val === "" || val === null || val === undefined;
    if (requiredSet.has(key) && isEmpty) {
      errors[key] = "required";
      continue;
    }
    if (isEmpty) continue;
    if (def.type === "integer" || def.type === "number") {
      const n = typeof val === "number" ? val : Number(val);
      if (Number.isNaN(n)) { errors[key] = "must be a number"; continue; }
      if (def.minimum !== undefined && n < def.minimum) errors[key] = `min ${def.minimum}`;
      if (def.maximum !== undefined && n > def.maximum) errors[key] = `max ${def.maximum}`;
    }
    if (def.enum && !def.enum.includes(val)) {
      errors[key] = `must be one of ${def.enum.join(" | ")}`;
    }
  }
  const canConfirm = Object.keys(errors).length === 0 && !busy;

  function update(key: string, next: any) {
    setEdited((prev) => ({...prev, [key]: next}));
  }

  function coerceAndConfirm() {
    const out: Record<string, any> = {...edited};
    // Drop empty optional fields so the server sees them as absent rather
    // than "". Integers/numbers get coerced to their numeric type.
    for (const key of Object.keys(out)) {
      const def = ((schema.properties ?? {})[key] as any) || {};
      const v = out[key];
      if (v === "" && !requiredSet.has(key)) {
        delete out[key];
        continue;
      }
      if ((def.type === "integer" || def.type === "number") && typeof v === "string") {
        const n = def.type === "integer" ? parseInt(v, 10) : parseFloat(v);
        if (!Number.isNaN(n)) out[key] = n;
      }
    }
    onConfirm(out);
  }

  return (
    <div
      onClick={() => { if (!busy) onCancel(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          background: FG.containerBg,
          border: `2px solid ${isDestructive ? FG.errorBorder : FG.warningBorder}`,
          borderRadius: 12,
          boxShadow: FG.containerShadow,
          padding: 0,
          width: "min(620px, 92vw)",
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        <header style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${FG.containerBorder}`,
          background: isDestructive ? FG.errorBg : FG.warningBg,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span style={{fontSize: 20}}>{isDestructive ? "🛑" : "⚠"}</span>
          <h2 style={{
            margin: 0,
            color: isDestructive ? FG.errorRed : FG.warningYellow,
            fontSize: 16,
            fontWeight: 600,
            flex: 1,
          }}>Confirm {risk.toLowerCase()}</h2>
          <StatusPill tone={isDestructive ? "bad" : "warn"}>{risk}</StatusPill>
        </header>

        <div style={{padding: 18}}>
          <div style={{fontSize: 13, color: FG.bodyColor, marginBottom: 14, lineHeight: 1.5}}>
            Review the target and inputs — all fields below are editable.
            The change will be recorded in the server-side mutation ledger
            and appear in the Activity view.
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "120px 1fr",
            gap: 10,
            marginBottom: 14,
            alignItems: "center",
          }}>
            <FieldLabel>Tool</FieldLabel>
            <code style={{color: FG.titleColor, fontWeight: 600}}>{tool.name}</code>
            <FieldLabel>Category</FieldLabel>
            <span style={{display: "flex", gap: 4}}>
              <Badge>{tool.category}</Badge>
              <Badge>{tool.transport}</Badge>
            </span>
            {targetSwitchEntries.map(({key, ip}) => (
              <TargetSwitchRow key={key} fieldKey={key} ip={ip} />
            ))}
          </div>

          {fieldOrder.length > 0 && (
            <div style={{
              background: "var(--bg0)",
              border: `1px solid ${FG.divider}`,
              borderRadius: 8,
              padding: "12px 14px",
              marginBottom: 14,
            }}>
              <div style={{
                fontSize: 11,
                color: FG.mutedColor,
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 10,
              }}>Inputs</div>
              <div style={{display: "flex", flexDirection: "column", gap: 10}}>
                {fieldOrder.map((key) => (
                  <EditableField
                    key={key}
                    toolName={tool.name}
                    name={key}
                    def={(schema.properties ?? {})[key] as any}
                    required={requiredSet.has(key)}
                    value={edited[key]}
                    inputs={edited}
                    onChange={(v) => update(key, v)}
                    error={errors[key]}
                    disabled={!!busy}
                  />
                ))}
              </div>
            </div>
          )}

          {tool.description && (
            <div style={{
              fontSize: 12,
              color: FG.mutedColor,
              padding: "8px 12px",
              background: FG.subtleBg,
              border: `1px solid ${FG.subtleBorder}`,
              borderRadius: 8,
              marginBottom: 8,
              lineHeight: 1.5,
            }}>
              <strong style={{color: FG.bodyColor}}>What this does:</strong> {tool.description}
            </div>
          )}
        </div>

        <footer style={{
          padding: "12px 18px",
          borderTop: `1px solid ${FG.divider}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}>
          <div style={{fontSize: 11, color: errors && Object.keys(errors).length > 0 ? FG.warningYellow : FG.mutedColor}}>
            {Object.keys(errors).length > 0
              ? `${Object.keys(errors).length} field(s) need attention`
              : "inputs look good"}
          </div>
          <div style={{display: "flex", gap: 8}}>
            <button
              onClick={onCancel}
              disabled={busy}
              style={{
                padding: "6px 16px",
                border: `1px solid ${FG.btnSecondaryBorder}`,
                background: "transparent",
                color: FG.btnSecondaryColor,
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: busy ? "wait" : "pointer",
              }}
            >Cancel</button>
            <button
              onClick={coerceAndConfirm}
              disabled={!canConfirm}
              title={canConfirm ? "" : "Fix the highlighted fields first"}
              style={{
                padding: "6px 16px",
                border: `1px solid ${isDestructive ? FG.errorBorder : FG.warningBorder}`,
                background: canConfirm
                  ? (isDestructive ? FG.errorRed : FG.warningYellow)
                  : FG.btnDisabledBg,
                color: canConfirm ? "#0b1220" : FG.btnDisabledColor,
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                cursor: canConfirm ? "pointer" : "not-allowed",
                transition: FG.transition,
              }}
            >{busy ? "running…" : `${isDestructive ? "🛑" : "⚠"}  Confirm & Run`}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─── Field renderer ────────────────────────────────────────────

function EditableField(props: {
  toolName: string;
  name: string;
  def: any;
  required: boolean;
  value: any;
  inputs: Record<string, any>;
  onChange: (v: any) => void;
  error?: string;
  disabled?: boolean;
}) {
  const {toolName, name, def, required, value, inputs, onChange, error, disabled} = props;
  const type = def?.type ?? "string";

  // Fetch live suggestions for this (tool, field) if a provider exists.
  // The provider returns strings like ["Ethernet0", "Ethernet4", …] that
  // we surface as <datalist> options — a combobox that still lets the
  // user type anything the list doesn't cover.
  const provider = getSuggestionProvider(toolName, name);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    setLoadingSuggestions(true);
    provider({switchIp: inputs.switch_ip as string | undefined, inputs})
      .then((list) => { if (!cancelled) setSuggestions(list); })
      .catch(() => { if (!cancelled) setSuggestions([]); })
      .finally(() => { if (!cancelled) setLoadingSuggestions(false); });
    return () => { cancelled = true; };
    // Re-fetch when the target switch changes (rare inside the modal but
    // keeps things correct if a caller swaps it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolName, name, inputs.switch_ip]);

  const listId = useMemo(
    () => `f-${toolName}-${name}-${Math.random().toString(36).slice(2, 8)}`,
    [toolName, name],
  );

  let control: React.ReactNode;
  if (def?.enum) {
    // enum stays a hard <select> — values are closed by definition.
    control = (
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle(!!error)}
      >
        <option value="">— select —</option>
        {def.enum.map((opt: string) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  } else if (type === "boolean") {
    control = (
      <label style={{display: "flex", alignItems: "center", gap: 8, color: FG.bodyColor, fontSize: 13}}>
        <input
          type="checkbox"
          checked={!!value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span style={{color: FG.mutedColor, fontSize: 12}}>
          {value ? "true" : "false"}
        </span>
      </label>
    );
  } else {
    const inputType = type === "integer" || type === "number" ? "number" : "text";
    control = (
      <>
        <input
          type={inputType}
          value={value ?? ""}
          list={provider ? listId : undefined}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def?.description?.slice(0, 80) ?? ""}
          style={inputStyle(!!error)}
        />
        {provider && suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label ?? s.value}
              </option>
            ))}
          </datalist>
        )}
      </>
    );
  }

  return (
    <div style={{display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, alignItems: "start"}}>
      <label style={{paddingTop: 8}}>
        <code style={{fontSize: 12, color: FG.bodyColor}}>
          {name}{required && <span style={{color: FG.errorRed}}> *</span>}
        </code>
      </label>
      <div style={{display: "flex", flexDirection: "column", gap: 4}}>
        {control}
        {error && (
          <span style={{fontSize: 11, color: FG.warningYellow}}>{error}</span>
        )}
        {!error && provider && (
          <span style={{fontSize: 11, color: FG.dimColor, lineHeight: 1.4}}>
            {loadingSuggestions
              ? "fetching options from the switch…"
              : suggestions.length > 0
                ? `${suggestions.length} option${suggestions.length === 1 ? "" : "s"} available — click the field or type to filter`
                : def?.description}
          </span>
        )}
        {!error && !provider && def?.description && (
          <span style={{fontSize: 11, color: FG.dimColor, lineHeight: 1.4}}>
            {def.description}
          </span>
        )}
      </div>
    </div>
  );
}

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    background: FG.inputBg,
    border: `1px solid ${hasError ? FG.warningBorder : FG.inputBorder}`,
    color: FG.inputColor,
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "ui-monospace, monospace",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };
}

function TargetSwitchRow({fieldKey, ip}: {fieldKey: string; ip: string}) {
  const isCanonical = fieldKey === "switch_ip";
  const label = isCanonical
    ? "Target switch"
    : fieldKey.replace(/_switch_ip$/, "").replace(/_/g, " ") + " switch";
  return (
    <>
      <FieldLabel>{label}</FieldLabel>
      <div>
        <strong style={{color: FG.titleColor}}>{displayName(ip)}</strong>
        <code style={{color: FG.mutedColor, fontSize: 12, marginLeft: 8}}>{ip}</code>
        {isCanonical && (
          <span style={{marginLeft: 8, fontSize: 10, color: FG.dimColor, textTransform: "uppercase", letterSpacing: 1}}>
            (change in top-bar picker)
          </span>
        )}
      </div>
    </>
  );
}

function FieldLabel({children}: {children: React.ReactNode}) {
  return (
    <div style={{
      fontSize: 11,
      color: FG.mutedColor,
      textTransform: "uppercase",
      letterSpacing: 1,
      alignSelf: "center",
    }}>{children}</div>
  );
}
