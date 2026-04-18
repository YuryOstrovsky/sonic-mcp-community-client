/**
 * Widget for get_fabric_reachability_matrix — colour-coded N×N grid.
 *
 * Cells are: green (reachable, 0% loss), yellow (reachable, some loss),
 * red (unreachable), slate (self-pair, not probed).
 */

import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {Section, SummaryStrip} from "./common";

type CellData = {
  reachable?: boolean;
  loss_pct?: number | null;
  rtt_avg_ms?: number | null;
  transmitted?: number | null;
  received?: number | null;
  error?: string;
};

export function ReachabilityMatrixWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const matrix: Record<string, Record<string, CellData>> = payload?.matrix ?? {};
  const targets: string[] = summary.targets ?? [];
  const reachPct: number | null = summary.reachable_pct ?? null;
  const broken: any[] = summary.broken_pairs ?? [];

  const verdictTone: "good" | "warn" | "bad" =
    reachPct === 100 ? "good" :
    reachPct === null ? "bad" :
    reachPct > 50 ? "warn" : "bad";
  const verdictText =
    reachPct === null ? "no probes"
    : reachPct === 100 ? "fully reachable"
    : `${reachPct}% reachable`;

  return (
    <div>
      <div style={{
        background: verdictTone === "good" ? FG.successBg : verdictTone === "warn" ? FG.warningBg : FG.errorBg,
        border: `1px solid ${verdictTone === "good" ? FG.successBorder : verdictTone === "warn" ? FG.warningBorder : FG.errorBorder}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <StatusPill tone={verdictTone}>{verdictText}</StatusPill>
        <div style={{fontSize: 13, color: FG.bodyColor}}>
          {summary.probe_count} probe{summary.probe_count === 1 ? "" : "s"} across {targets.length} switch{targets.length === 1 ? "" : "es"}
          {broken.length > 0 && ` · ${broken.length} broken`}
        </div>
      </div>

      <SummaryStrip items={[
        {label: "Switches",   value: targets.length},
        {label: "Probes",     value: summary.probe_count ?? 0},
        {label: "Reachable",  value: summary.reachable_count ?? 0},
        {label: "Broken",     value: summary.broken_pair_count ?? 0},
      ]} />

      <Section title="Reachability matrix">
        <div style={{
          overflow: "auto",
          border: `1px solid ${FG.divider}`,
          borderRadius: 8,
          background: "var(--bg0)",
        }}>
          <table style={{borderCollapse: "collapse", fontSize: 12}}>
            <thead>
              <tr>
                <th style={thSticky}>from \ to</th>
                {targets.map((t) => (
                  <th key={t} style={th}>
                    <div style={{fontWeight: 600}}>{displayName(t)}</div>
                    <div style={{fontFamily: "ui-monospace, monospace", color: FG.mutedColor, fontSize: 10, fontWeight: 400}}>{t}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {targets.map((src) => (
                <tr key={src}>
                  <td style={thRow}>
                    <div style={{fontWeight: 600}}>{displayName(src)}</div>
                    <div style={{fontFamily: "ui-monospace, monospace", color: FG.mutedColor, fontSize: 10, fontWeight: 400}}>{src}</div>
                  </td>
                  {targets.map((tgt) => {
                    if (src === tgt) {
                      return <td key={tgt} style={{...cell, background: "rgba(255,255,255,0.03)"}}>—</td>;
                    }
                    const d = matrix[src]?.[tgt] ?? {};
                    return <MatrixCell key={tgt} data={d} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {broken.length > 0 && (
        <Section title={`Broken pairs (${broken.length})`}>
          <div style={{
            background: "rgba(239,68,68,0.08)",
            border: `1px solid ${FG.errorBorder}`,
            borderRadius: 8,
            padding: 10,
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            color: FG.errorRed,
          }}>
            {broken.map((p, i) => (
              <div key={i}>
                {displayName(p.source)} → {displayName(p.target)}
                {p.loss_pct != null && ` (${p.loss_pct}% loss)`}
                {p.error && ` — ${p.error.slice(0, 120)}`}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div style={{marginTop: 4}}><Badge>transport: parallel ssh ping</Badge></div>
    </div>
  );
}

function MatrixCell({data}: {data: CellData}) {
  const reachable = !!data.reachable;
  const loss = data.loss_pct ?? null;
  const rtt = data.rtt_avg_ms ?? null;

  const tone =
    !reachable ? "bad" :
    loss != null && loss > 0 ? "warn" :
    "good";

  const bg =
    tone === "good" ? "rgba(34,197,94,0.15)" :
    tone === "warn" ? "rgba(234,179,8,0.15)" :
    "rgba(239,68,68,0.15)";
  const fg =
    tone === "good" ? FG.successGreen :
    tone === "warn" ? FG.warningYellow :
    FG.errorRed;

  return (
    <td style={{
      ...cell,
      background: bg,
      color: fg,
    }}>
      <div style={{fontWeight: 700, fontFamily: "ui-monospace, monospace"}}>
        {reachable ? (rtt != null ? `${rtt} ms` : "ok") : "×"}
      </div>
      {reachable && loss != null && loss > 0 && (
        <div style={{fontSize: 10}}>{loss}% loss</div>
      )}
      {!reachable && data.error && (
        <div style={{fontSize: 10, opacity: 0.7, maxWidth: 120, whiteSpace: "normal"}}>
          {data.error.slice(0, 40)}
        </div>
      )}
    </td>
  );
}

const th: React.CSSProperties = {
  background: FG.containerBg,
  color: FG.mutedColor,
  textAlign: "center",
  padding: "8px 10px",
  borderBottom: `1px solid ${FG.divider}`,
  fontSize: 11,
  minWidth: 110,
  whiteSpace: "nowrap",
};
const thSticky: React.CSSProperties = {
  ...th,
  position: "sticky",
  left: 0,
  zIndex: 2,
  textAlign: "right",
};
const thRow: React.CSSProperties = {
  ...th,
  textAlign: "right",
  position: "sticky",
  left: 0,
  zIndex: 1,
};
const cell: React.CSSProperties = {
  textAlign: "center",
  padding: "8px 10px",
  borderTop: `1px solid ${FG.divider}`,
  borderLeft: `1px solid ${FG.divider}`,
  fontSize: 12,
  minWidth: 100,
};
