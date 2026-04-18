/**
 * Widget for get_fabric_mtu_consistency — verdict + per-pair MTU audit.
 */

import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {type Column, Section, SummaryStrip, Table} from "./common";

type Pair = {
  source: string;
  source_if: string | null;
  source_mtu: number | null;
  target: string;
  target_if: string | null;
  target_mtu: number | null;
  peer_ip: string;
};

export function FabricMtuWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const matched: Pair[] = payload?.matched ?? [];
  const mismatched: Pair[] = payload?.mismatched ?? [];
  const unknown: Pair[] = payload?.unknown ?? [];

  const overallOk = (s.mismatched ?? 0) === 0 && (s.total_pairs ?? 0) > 0;

  const cols: Column<Pair>[] = [
    {key: "source",     label: "Source",    width: "18%", render: (r) => `${displayName(r.source)} / ${r.source_if ?? "—"}`},
    {key: "source_mtu", label: "Src MTU",   width: "10%", mono: true, align: "right", render: (r) => r.source_mtu != null ? String(r.source_mtu) : "—"},
    {key: "target",     label: "Target",    width: "18%", render: (r) => `${displayName(r.target)} / ${r.target_if ?? "—"}`},
    {key: "target_mtu", label: "Tgt MTU",   width: "10%", mono: true, align: "right", render: (r) => r.target_mtu != null ? String(r.target_mtu) : "—"},
    {key: "peer",       label: "Peer IP",   mono: true,   render: (r) => r.peer_ip},
    {key: "verdict",    label: "Verdict",   width: "14%", render: (r) => {
      if (r.source_mtu == null || r.target_mtu == null) return <span style={{color: FG.mutedColor}}>unknown</span>;
      if (r.source_mtu === r.target_mtu) return <span style={{color: FG.successGreen}}>match ({r.source_mtu})</span>;
      return <span style={{color: FG.errorRed, fontWeight: 600}}>mismatch Δ{Math.abs(r.source_mtu - r.target_mtu)}</span>;
    }},
  ];

  return (
    <div>
      <div style={{
        background: overallOk ? FG.successBg : FG.warningBg,
        border: `1px solid ${overallOk ? FG.successBorder : FG.warningBorder}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <StatusPill tone={overallOk ? "good" : "warn"}>
          {overallOk ? "MTU consistent" : "MTU drift"}
        </StatusPill>
        <div style={{fontSize: 13, color: FG.bodyColor}}>
          {overallOk
            ? `All ${s.matched ?? 0} peered link${(s.matched ?? 0) === 1 ? "" : "s"} match.`
            : `${s.mismatched ?? 0} mismatch${(s.mismatched ?? 0) === 1 ? "" : "es"} · ${s.unknown ?? 0} unknown.`}
        </div>
      </div>

      <SummaryStrip items={[
        {label: "Pairs",      value: s.total_pairs ?? 0},
        {label: "Matched",    value: s.matched     ?? 0},
        {label: "Mismatched", value: s.mismatched  ?? 0},
        {label: "Unknown",    value: s.unknown     ?? 0},
      ]} />

      {mismatched.length > 0 && (
        <Section title={`Mismatches (${mismatched.length})`}>
          <Table columns={cols} rows={mismatched} getKey={(r, i) => `${r.source}|${r.target}|${i}`} />
        </Section>
      )}
      {unknown.length > 0 && (
        <Section title={`Unknown (${unknown.length})`}>
          <Table columns={cols} rows={unknown} getKey={(r, i) => `${r.source}|${r.target}|${i}`} />
        </Section>
      )}
      {matched.length > 0 && (
        <Section title={`Matched (${matched.length})`}>
          <Table columns={cols} rows={matched} getKey={(r, i) => `${r.source}|${r.target}|${i}`} />
        </Section>
      )}

      <div style={{marginTop: 4}}><Badge>transport: restconf + ssh fanout</Badge></div>
    </div>
  );
}
