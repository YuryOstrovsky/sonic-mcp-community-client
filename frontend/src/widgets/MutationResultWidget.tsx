/**
 * Widget for mutation results — set_interface_admin_status and config_save.
 *
 * Generic enough to handle any MUTATION tool that returns
 *   {summary: {...}, pre_state: {...}, post_state: {...}, mutation_id}
 *
 * Shows:
 *   - summary card (action, changed flag, mutation_id badge)
 *   - pre/post side-by-side diff table when both present
 *   - stdout/stderr collapsible if present
 */

import {useState} from "react";
import {FG} from "../lib/figmaStyles";
import {Badge, ErrorBanner, JsonView, StatusPill} from "../shared";
import {KvGrid, Section} from "./common";

export function MutationResultWidget({payload}: {payload: any}) {
  // ── Error path: server rejected (policy violation, missing inputs, etc.) ──
  // The backend shapes failed /invoke responses as {error, detail} — so if
  // we see that and no summary, render the error prominently instead of
  // pretending the mutation applied.
  const hasError = payload && (payload.error || payload.detail) && !payload.summary;
  if (hasError) {
    const msg: string = payload.error
      || (typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail));
    const isConfirmNeeded = typeof msg === "string" && /requires\s+explicit\s+confirmation/i.test(msg);
    return (
      <div>
        <div style={{
          background: isConfirmNeeded ? FG.warningBg : FG.errorBg,
          border: `1px solid ${isConfirmNeeded ? FG.warningBorder : FG.errorBorder}`,
          borderRadius: 10,
          padding: "10px 14px",
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span style={{fontSize: 18}}>{isConfirmNeeded ? "⚠" : "✖"}</span>
          <div style={{flex: 1}}>
            <div style={{
              color: isConfirmNeeded ? FG.warningYellow : FG.errorRed,
              fontWeight: 600,
              fontSize: 13,
            }}>
              {isConfirmNeeded ? "Confirmation required — mutation NOT applied" : "Mutation failed"}
            </div>
            <div style={{fontSize: 12, color: FG.mutedColor, marginTop: 2, lineHeight: 1.5}}>{msg}</div>
          </div>
        </div>
        <ErrorBanner>
          <div style={{fontSize: 11, color: FG.mutedColor, marginBottom: 4}}>Raw error payload:</div>
          <JsonView data={payload} height={200} />
        </ErrorBanner>
      </div>
    );
  }

  const summary = payload?.summary ?? {};
  const pre = payload?.pre_state ?? null;
  const post = payload?.post_state ?? null;
  const mutationId: string | undefined = payload?.mutation_id;
  const stdout: string = payload?.stdout ?? "";
  const stderr: string = payload?.stderr ?? "";
  const [showStdio, setShowStdio] = useState(false);

  // Build a diff of pre vs post state, highlighting changed fields.
  const diffRows = buildDiffRows(pre, post);
  const changed = Boolean(summary.changed || diffRows.some((r) => r.changed));

  return (
    <div>
      {/* Mutation header banner */}
      <div style={{
        background: changed ? FG.warningBg : FG.successBg,
        border: `1px solid ${changed ? FG.warningBorder : FG.successBorder}`,
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <span style={{fontSize: 18}}>{changed ? "⚠" : "✓"}</span>
        <div style={{flex: 1}}>
          <div style={{
            color: changed ? FG.warningYellow : FG.successGreen,
            fontWeight: 600,
            fontSize: 13,
          }}>
            {changed ? "Mutation applied — state changed" : "Mutation applied"}
          </div>
          <div style={{fontSize: 12, color: FG.mutedColor, marginTop: 2}}>
            {summaryLine(summary)}
          </div>
        </div>
        {mutationId && (
          <Badge title="Click to view in Activity">
            <span style={{fontFamily: "ui-monospace, monospace"}}>{mutationId}</span>
          </Badge>
        )}
      </div>

      {/* Summary KVs */}
      <KvGrid columns={3} rows={summaryKvs(summary)} />

      {/* Pre / Post diff */}
      {diffRows.length > 0 && (
        <Section title="State transition" right={
          <StatusPill tone={changed ? "warn" : "good"}>
            {changed ? "changed" : "no change"}
          </StatusPill>
        }>
          <div style={{
            overflow: "auto",
            border: `1px solid ${FG.divider}`,
            borderRadius: 8,
          }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
              color: FG.bodyColor,
            }}>
              <thead>
                <tr>
                  <TH>Field</TH>
                  <TH>Before</TH>
                  <TH>After</TH>
                </tr>
              </thead>
              <tbody>
                {diffRows.map((r, i) => (
                  <tr key={r.key} style={{background: i % 2 ? "transparent" : FG.subtleBg}}>
                    <td style={{...tdStyle, fontFamily: "ui-monospace, monospace", color: FG.mutedColor}}>
                      {r.key}
                    </td>
                    <td style={{...tdStyle, fontFamily: "ui-monospace, monospace"}}>
                      {r.changed ? (
                        <span style={{color: FG.mutedColor, textDecoration: "line-through"}}>
                          {fmt(r.before)}
                        </span>
                      ) : fmt(r.before)}
                    </td>
                    <td style={{...tdStyle, fontFamily: "ui-monospace, monospace"}}>
                      <span style={{
                        color: r.changed ? FG.successGreen : FG.bodyColor,
                        fontWeight: r.changed ? 600 : 400,
                      }}>{fmt(r.after)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* stdout/stderr */}
      {(stdout || stderr) && (
        <div style={{marginTop: 10}}>
          <button
            onClick={() => setShowStdio((v) => !v)}
            style={{
              background: "transparent",
              border: `1px solid ${FG.rowDefaultBorder}`,
              color: FG.mutedColor,
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >{showStdio ? "▾ Hide" : "▸ Show"} stdout / stderr</button>
          {showStdio && (
            <div style={{marginTop: 8}}>
              {stdout && (
                <pre style={preStyle}>{stdout}</pre>
              )}
              {stderr && (
                <pre style={{...preStyle, color: FG.errorRed, borderColor: FG.errorBorder}}>{stderr}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────

function summaryLine(s: any): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.interface) parts.push(`interface ${s.interface}`);
  if (s.requested_status) parts.push(`→ ${s.requested_status}`);
  if (s.action) parts.push(`action: ${s.action}`);
  if (s.saved !== undefined) parts.push(s.saved ? "saved to disk" : "save failed");
  if (s.switch_ip && parts.length === 0) parts.push(`on ${s.switch_ip}`);
  return parts.join("  ·  ");
}

function summaryKvs(s: any): Array<{label: string; value: any; mono?: boolean}> {
  if (!s) return [];
  const entries: Array<{label: string; value: any; mono?: boolean}> = [];
  if (s.switch_ip) entries.push({label: "Switch", value: s.switch_ip, mono: true});
  if (s.interface) entries.push({label: "Interface", value: s.interface, mono: true});
  if (s.action) entries.push({label: "Action", value: s.action});
  if (s.requested_status) entries.push({label: "Requested", value: s.requested_status, mono: true});
  if (s.changed !== undefined) entries.push({label: "State changed", value: s.changed ? "yes" : "no"});
  if (s.saved !== undefined) entries.push({label: "Saved to disk", value: s.saved ? "yes" : "no"});
  if (s.duration_ms !== undefined) entries.push({label: "Duration", value: `${s.duration_ms} ms`, mono: true});
  if (s.source) entries.push({label: "Source", value: s.source, mono: true});
  return entries;
}

function buildDiffRows(pre: any, post: any): Array<{key: string; before: any; after: any; changed: boolean}> {
  if (!pre && !post) return [];
  const keys = new Set<string>([...Object.keys(pre || {}), ...Object.keys(post || {})]);
  const rows: Array<{key: string; before: any; after: any; changed: boolean}> = [];
  for (const k of keys) {
    if (k === "counters") continue; // noisy; skip from diff view
    const b = pre?.[k];
    const a = post?.[k];
    const changed = JSON.stringify(b) !== JSON.stringify(a);
    rows.push({key: k, before: b, after: a, changed});
  }
  rows.sort((x, y) => (x.changed === y.changed) ? x.key.localeCompare(y.key) : (x.changed ? -1 : 1));
  return rows;
}

function fmt(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

const TH = ({children}: {children: React.ReactNode}) => (
  <th style={{
    textAlign: "left",
    padding: "8px 10px",
    background: FG.containerBg,
    borderBottom: `1px solid ${FG.containerBorder}`,
    color: FG.mutedColor,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 1,
  }}>{children}</th>
);

const tdStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: `1px solid ${FG.divider}`,
  verticalAlign: "top",
};

const preStyle: React.CSSProperties = {
  background: "var(--bg0)",
  color: FG.bodyColor,
  border: `1px solid ${FG.divider}`,
  borderRadius: 8,
  padding: 10,
  fontSize: 11.5,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  margin: 0,
  maxHeight: 200,
  overflow: "auto",
  whiteSpace: "pre-wrap",
};
