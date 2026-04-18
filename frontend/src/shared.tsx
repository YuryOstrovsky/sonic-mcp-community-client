/**
 * Shared presentational components — Panel, StatusPill, JsonView, Badge, Button.
 * Kept in one file so individual widgets don't reinvent them.
 */

import {useState, type CSSProperties, type ReactNode} from "react";
import {FG} from "./lib/figmaStyles";

// ─── Panel ────────────────────────────────────────────────────────
export function Panel(props: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section style={{
      background: FG.containerBg,
      border: `1px solid ${FG.containerBorder}`,
      borderRadius: FG.containerRadius,
      padding: 16,
      marginBottom: 16,
      boxShadow: FG.containerShadow,
      ...props.style,
    }}>
      {(props.title || props.right) && (
        <header style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}>
          <h2 style={{
            margin: 0,
            color: FG.headingColor,
            fontSize: 16,
            fontWeight: 600,
          }}>{props.title}</h2>
          {props.right}
        </header>
      )}
      {props.children}
    </section>
  );
}

// ─── Status pill ──────────────────────────────────────────────────
type Tone = "good" | "warn" | "bad" | "neutral" | "info";

const TONES: Record<Tone, {bg: string; fg: string; border: string}> = {
  good: {bg: FG.successBg, fg: FG.successGreen, border: FG.successBorder},
  warn: {bg: FG.warningBg, fg: FG.warningYellow, border: FG.warningBorder},
  bad:  {bg: FG.errorBg, fg: FG.errorRed, border: FG.errorBorder},
  info: {bg: FG.infoBg, fg: FG.infoBlue, border: FG.infoBorder},
  neutral: {bg: FG.subtleBg, fg: FG.mutedColor, border: FG.subtleBorder},
};

export function StatusPill(props: {tone: Tone; children: ReactNode; title?: string}) {
  const t = TONES[props.tone];
  return (
    <span title={props.title} style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "2px 8px",
      background: t.bg,
      color: t.fg,
      border: `1px solid ${t.border}`,
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      {props.children}
    </span>
  );
}

// ─── Badge (simple) ───────────────────────────────────────────────
export function Badge(props: {children: ReactNode; title?: string}) {
  return (
    <span title={props.title} style={{
      display: "inline-block",
      padding: "1px 6px",
      background: FG.subtleBg,
      border: `1px solid ${FG.subtleBorder}`,
      borderRadius: 6,
      fontSize: 10,
      color: FG.mutedColor,
      fontFamily: "ui-monospace, SFMono-Regular, monospace",
      whiteSpace: "nowrap",
    }}>{props.children}</span>
  );
}

// ─── Button ───────────────────────────────────────────────────────
export function Button(props: {
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  children: ReactNode;
  style?: CSSProperties;
  type?: "button" | "submit";
}) {
  const v = props.variant ?? "primary";
  const base: CSSProperties = {
    padding: "6px 14px",
    border: "1px solid transparent",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: props.disabled ? "not-allowed" : "pointer",
    transition: FG.transition,
  };
  const variants: Record<string, CSSProperties> = {
    primary: {
      // Disabled state keeps a clearly-visible orange outline + label so
      // the button is always identifiable as a button, not just a blank block.
      background: props.disabled ? "rgba(234,88,12,0.12)" : FG.btnPrimaryBg,
      color: props.disabled ? "#f97316" : "#fff",
      borderColor: props.disabled ? "#ea580c80" : FG.btnPrimaryBorder,
    },
    secondary: {
      background: "transparent",
      color: props.disabled ? FG.btnDisabledColor : FG.btnSecondaryColor,
      borderColor: props.disabled ? FG.btnDisabledBorder : FG.btnSecondaryBorder,
    },
    ghost: {
      background: "transparent",
      color: FG.btnSecondaryColor,
      borderColor: "transparent",
    },
  };
  return (
    <button
      type={props.type ?? "button"}
      disabled={props.disabled}
      onClick={props.onClick}
      style={{...base, ...variants[v], ...props.style}}
    >{props.children}</button>
  );
}

// ─── Copy button ──────────────────────────────────────────────────
// Uses navigator.clipboard where available (HTTPS / localhost); falls
// back to execCommand('copy') on plain HTTP where the modern API isn't
// exposed. Shows "copied ✓" or "copy failed" so the user gets feedback.
async function copyToClipboard(text: string): Promise<boolean> {
  // Modern API requires a secure context — bare HTTP on a non-localhost host
  // (e.g., http://10.46.11.8:5174/) does NOT qualify.
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fall through to execCommand path */ }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Keep offscreen but selectable
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.left = "-1000px";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton(props: {text: string; label?: string}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        const ok = await copyToClipboard(props.text);
        setState(ok ? "copied" : "failed");
        setTimeout(() => setState("idle"), 1500);
      }}
      style={{fontSize: 11, padding: "2px 8px"}}
    >
      {state === "copied"  ? "copied ✓" :
       state === "failed"  ? "copy failed" :
       (props.label ?? "copy")}
    </Button>
  );
}

// ─── JSON view ────────────────────────────────────────────────────
// Simple: pretty-printed JSON with a copy button in the corner.
// Phase C widgets will render structured data nicely; this is the fallback.
export function JsonView(props: {data: unknown; style?: CSSProperties; height?: number | string}) {
  const text = (() => {
    try { return JSON.stringify(props.data, null, 2); }
    catch { return String(props.data); }
  })();
  return (
    <div style={{position: "relative", ...props.style}}>
      <div style={{position: "absolute", top: 6, right: 6, zIndex: 1}}>
        <CopyButton text={text} />
      </div>
      <pre style={{
        background: "var(--bg0)",
        color: FG.bodyColor,
        border: `1px solid ${FG.divider}`,
        borderRadius: 8,
        padding: 12,
        paddingTop: 24,
        fontSize: 12,
        lineHeight: 1.5,
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        overflow: "auto",
        margin: 0,
        maxHeight: props.height ?? 500,
      }}>{text}</pre>
    </div>
  );
}

// ─── Loading / empty / error blocks ───────────────────────────────
export function Loading(props: {label?: string}) {
  return (
    <div style={{color: FG.mutedColor, display: "flex", alignItems: "center", gap: 8, fontSize: 13}}>
      <span className="loading-spin" /> {props.label ?? "loading…"}
    </div>
  );
}

export function EmptyState(props: {children: ReactNode}) {
  return (
    <div style={{
      color: FG.mutedColor,
      padding: "24px 12px",
      textAlign: "center",
      fontSize: 13,
    }}>{props.children}</div>
  );
}

export function ErrorBanner(props: {children: ReactNode}) {
  return (
    <div style={{
      background: FG.errorBg,
      border: `1px solid ${FG.errorBorder}`,
      borderRadius: 8,
      padding: 12,
      color: FG.errorRed,
      fontSize: 13,
    }}>{props.children}</div>
  );
}
