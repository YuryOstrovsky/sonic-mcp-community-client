/**
 * Shared "⋯" row-action menu for widget tables.
 *
 * Each action is a small spec: label + a prompt function that produces
 * the NL text to submit. Clicking an action fires the same SUBMIT_PROMPT
 * event the HelpWidget uses — so the NL router routes the text, the
 * confirmation modal pops (for mutations) with editable inputs, and the
 * result lands in the Console as a normal turn card.
 *
 * Used by: InterfacesWidget, BgpSummaryWidget, ActivityWidget.
 */

import {useState, type ReactNode} from "react";
import {MoreHorizontal} from "lucide-react";
import {FG} from "../lib/figmaStyles";
import {SUBMIT_PROMPT_EVENT} from "./HelpWidget";

export type RowAction = {
  label: string;
  /** Produce the NL prompt to submit. Return null to disable this row. */
  prompt: () => string | null;
  /** Visual tone for the item — use "danger" for destructive actions. */
  tone?: "default" | "danger" | "warn";
};

export function RowActionsMenu(props: {
  actions: RowAction[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const align = props.align ?? "right";

  function run(action: RowAction) {
    setOpen(false);
    const prompt = action.prompt();
    if (prompt) {
      window.dispatchEvent(new CustomEvent(SUBMIT_PROMPT_EVENT, {detail: prompt}));
    }
  }

  return (
    <div style={{position: "relative", display: "inline-flex"}}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="Row actions"
        style={{
          background: "transparent",
          border: "none",
          padding: "2px 4px",
          cursor: "pointer",
          color: FG.mutedColor,
          borderRadius: 4,
          lineHeight: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = FG.headingColor)}
        onMouseLeave={(e) => (e.currentTarget.style.color = FG.mutedColor)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{position: "fixed", inset: 0, zIndex: 40}}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              [align]: 0,
              zIndex: 41,
              minWidth: 200,
              background: FG.containerBg,
              border: `1px solid ${FG.containerBorder}`,
              borderRadius: 8,
              boxShadow: FG.containerShadow,
              padding: 4,
            }}
          >
            {props.actions.map((a, i) => {
              const disabled = a.prompt() === null;
              const color =
                a.tone === "danger" ? FG.errorRed :
                a.tone === "warn"   ? FG.warningYellow :
                FG.bodyColor;
              return (
                <button
                  key={i}
                  disabled={disabled}
                  onClick={(e) => { e.stopPropagation(); run(a); }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    fontSize: 12,
                    color: disabled ? FG.dimColor : color,
                    background: "transparent",
                    border: "none",
                    borderRadius: 4,
                    cursor: disabled ? "not-allowed" : "pointer",
                    transition: FG.transition,
                  }}
                  onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = FG.rowHoverBg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >{a.label}</button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function ActionIconCell({children}: {children: ReactNode}) {
  return <div style={{display: "flex", justifyContent: "flex-end"}}>{children}</div>;
}
