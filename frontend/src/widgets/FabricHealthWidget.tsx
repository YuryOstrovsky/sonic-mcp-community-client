/**
 * Widget for get_fabric_health — pass/fail verdict + broken-link detail.
 *
 * Summary strip shows healthy / broken / orphan / unreachable counts.
 * Broken-link and orphan tables only appear when they're non-empty.
 */

import {FG} from "../lib/figmaStyles";
import {Badge, StatusPill} from "../shared";
import {type Column, Section, SummaryStrip, Table} from "./common";

type Link = {
  source: string;
  target: string | null;
  kind: string;
  source_peer_ip?: string;
  source_local_asn?: number | string | null;
  target_remote_asn?: number | string | null;
  established?: boolean | null;
  state?: string;
};

export function FabricHealthWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const healthy: Link[]  = payload?.healthy_links ?? [];
  const broken: Link[]   = payload?.broken_links  ?? [];
  const orphans: Link[]  = payload?.orphan_peers  ?? [];
  const unreachable: string[] = payload?.unreachable ?? [];

  const overallOk = (s.broken ?? 0) === 0 && (s.orphan ?? 0) === 0 && (s.unreachable ?? 0) === 0;

  const linkCols: Column<Link>[] = [
    {key: "source",   label: "Source",       width: "18%", mono: true},
    {key: "peer",     label: "Peer",         width: "18%", mono: true, render: (r) => r.source_peer_ip ?? "—"},
    {key: "target",   label: "Target",       width: "18%", mono: true, render: (r) => r.target ?? "(orphan)"},
    {key: "asn",      label: "AS local→remote", render: (r) => (
      <span style={{fontFamily: "ui-monospace, monospace"}}>{r.source_local_asn ?? "?"} → {r.target_remote_asn ?? "?"}</span>
    )},
    {key: "state",    label: "State", width: "14%", render: (r) => (
      r.established
        ? <span style={{color: FG.successGreen}}>established</span>
        : <span style={{color: FG.errorRed}}>{r.state ?? "down"}</span>
    )},
  ];

  return (
    <div>
      {/* Big verdict banner */}
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
          {overallOk ? "fabric healthy" : "attention needed"}
        </StatusPill>
        <div style={{fontSize: 13, color: FG.bodyColor}}>
          {overallOk
            ? `All ${s.healthy ?? 0} BGP adjacenc${(s.healthy ?? 0) === 1 ? "y is" : "ies are"} established.`
            : `${s.broken ?? 0} broken · ${s.orphan ?? 0} orphan · ${s.unreachable ?? 0} unreachable switch${(s.unreachable ?? 0) === 1 ? "" : "es"}.`}
        </div>
      </div>

      <SummaryStrip items={[
        {label: "Healthy",     value: s.healthy     ?? 0, tone: (s.healthy ?? 0) > 0 ? "good" : "neutral"},
        {label: "Broken",      value: s.broken      ?? 0, tone: (s.broken ?? 0) > 0 ? "bad" : "good"},
        {label: "Orphan",      value: s.orphan      ?? 0, tone: (s.orphan ?? 0) > 0 ? "warn" : "neutral"},
        {label: "Unreachable", value: s.unreachable ?? 0, tone: (s.unreachable ?? 0) > 0 ? "bad" : "good"},
      ]} />

      {broken.length > 0 && (
        <Section title={`Broken links (${broken.length})`}>
          <Table
            columns={linkCols}
            rows={broken}
            getKey={(r, i) => `${r.source}|${r.source_peer_ip ?? "x"}|${i}`}
          />
        </Section>
      )}

      {orphans.length > 0 && (
        <Section title={`Orphan peers (${orphans.length})`}>
          <Table
            columns={linkCols}
            rows={orphans}
            getKey={(r, i) => `${r.source}|${r.source_peer_ip ?? "x"}|${i}`}
            emptyText="None."
          />
        </Section>
      )}

      {unreachable.length > 0 && (
        <Section title={`Unreachable switches (${unreachable.length})`}>
          <div style={{
            background: "rgba(239,68,68,0.08)",
            border: `1px solid ${FG.errorBorder}`,
            borderRadius: 8,
            padding: 10,
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            color: FG.errorRed,
          }}>
            {unreachable.map((ip) => <div key={ip}>{ip}</div>)}
          </div>
        </Section>
      )}

      {healthy.length > 0 && (
        <Section title={`Healthy links (${healthy.length})`}>
          <Table
            columns={linkCols}
            rows={healthy}
            getKey={(r, i) => `${r.source}|${r.source_peer_ip ?? "x"}|${i}`}
            filterPlaceholder="filter…"
            filterText={(r) => [r.source, r.target, r.source_peer_ip].filter(Boolean).join(" ")}
          />
        </Section>
      )}

      <div style={{marginTop: 4}}><Badge>transport: mixed (restconf + ssh fanout)</Badge></div>
    </div>
  );
}
