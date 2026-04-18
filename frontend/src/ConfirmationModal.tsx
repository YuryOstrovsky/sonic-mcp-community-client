/**
 * Confirmation modal for MUTATION / DESTRUCTIVE tools.
 *
 * Shown before any tool with policy.requires_confirmation=true is invoked.
 * User reviews the inputs, confirms, then we send the invoke with
 * confirm=true. Close-on-backdrop, Esc-to-cancel, no auto-enter-to-confirm
 * (intentional — mutations should require a deliberate click).
 */

import {useEffect} from "react";
import {FG} from "./lib/figmaStyles";
import {displayName} from "./lib/state";
import {Badge, Button, StatusPill} from "./shared";
import type {ToolSpec} from "./lib/api";

export function ConfirmationModal(props: {
  tool: ToolSpec;
  inputs: Record<string, any>;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const {tool, inputs, onCancel, onConfirm, busy} = props;
  const risk = tool.policy?.risk || "SAFE_READ";
  const isDestructive = risk === "DESTRUCTIVE";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while modal is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel, busy]);

  const switchIp = inputs.switch_ip as string | undefined;
  const otherInputs = Object.entries(inputs).filter(([k]) => k !== "switch_ip");

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
          width: "min(560px, 92vw)",
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
            You are about to invoke a write operation. Review the target and
            inputs carefully. The change will be recorded in the server-side
            mutation ledger and will appear in the Activity view.
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "120px 1fr",
            gap: 8,
            marginBottom: 16,
          }}>
            <FieldLabel>Tool</FieldLabel>
            <code style={{color: FG.titleColor, fontWeight: 600}}>{tool.name}</code>
            <FieldLabel>Category</FieldLabel>
            <span style={{display: "flex", gap: 4}}>
              <Badge>{tool.category}</Badge>
              <Badge>{tool.transport}</Badge>
            </span>
            {switchIp && (
              <>
                <FieldLabel>Target switch</FieldLabel>
                <div>
                  <strong style={{color: FG.titleColor}}>{displayName(switchIp)}</strong>
                  <code style={{color: FG.mutedColor, fontSize: 12, marginLeft: 8}}>{switchIp}</code>
                </div>
              </>
            )}
          </div>

          {otherInputs.length > 0 && (
            <div style={{
              background: "var(--bg0)",
              border: `1px solid ${FG.divider}`,
              borderRadius: 8,
              padding: "10px 12px",
              marginBottom: 16,
            }}>
              <div style={{
                fontSize: 11,
                color: FG.mutedColor,
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 6,
              }}>Inputs</div>
              <div style={{display: "grid", gridTemplateColumns: "140px 1fr", gap: 6}}>
                {otherInputs.map(([k, v]) => (
                  <div key={k} style={{display: "contents"}}>
                    <code style={{fontSize: 12, color: FG.bodyColor}}>{k}</code>
                    <code style={{
                      fontSize: 12,
                      color: FG.headingColor,
                      fontWeight: 500,
                    }}>{formatInputValue(v)}</code>
                  </div>
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
              marginBottom: 16,
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
          justifyContent: "flex-end",
          gap: 8,
        }}>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: "6px 16px",
              border: `1px solid ${isDestructive ? FG.errorBorder : FG.warningBorder}`,
              background: isDestructive ? FG.errorRed : FG.warningYellow,
              color: "#0b1220",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: busy ? "wait" : "pointer",
              transition: FG.transition,
            }}
          >{busy ? "running…" : `${isDestructive ? "🛑" : "⚠"}  Confirm & Run`}</button>
        </footer>
      </div>
    </div>
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

function formatInputValue(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}
