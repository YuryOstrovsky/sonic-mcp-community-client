/**
 * Widget for detect_routing_loop — summary + detail per probed pair.
 */

import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {type Column, Section, SummaryStrip, Table} from "./common";

type Probe = {
  source: string;
  target: string;
  status: string;
  reached?: boolean;
  hop_count?: number;
  looping_ip?: string | null;
  has_loop?: boolean;
  error?: string;
  hops?: Array<{hop: number; ips: string[]; rtt_ms: number[]; timeout: boolean}>;
};

export function RoutingLoopWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const loops: Probe[]    = payload?.loops     ?? [];
  const unreached: Probe[] = payload?.unreached ?? [];
  const errors: Probe[]    = payload?.errors    ?? [];
  const allProbes: Probe[] = payload?.all_probes ?? [];

  const clean = (s.loops_found ?? 0) === 0 && (s.unreached ?? 0) === 0 && (s.errors ?? 0) === 0;

  const cols: Column<Probe>[] = [
    {key: "src", label: "Source",  width: "22%", render: (r) => `${displayName(r.source)} (${r.source})`},
    {key: "tgt", label: "Target",  width: "22%", render: (r) => `${displayName(r.target)} (${r.target})`},
    {key: "st",  label: "Status",  width: "16%", render: (r) =>
      r.status === "error"        ? <StatusPill tone="bad">error</StatusPill>
      : r.has_loop                 ? <StatusPill tone="bad">loop at {r.looping_ip}</StatusPill>
      : !r.reached                 ? <StatusPill tone="warn">unreached</StatusPill>
      : <StatusPill tone="good">clean ({r.hop_count} hops)</StatusPill>
    },
    {key: "hops", label: "Hops",   mono: true, render: (r) => (
      r.hops?.map((h) => h.timeout ? "*" : h.ips.join("|")).join(" → ") || "—"
    )},
  ];

  return (
    <div>
      <div style={{
        background: clean ? FG.successBg : FG.warningBg,
        border: `1px solid ${clean ? FG.successBorder : FG.warningBorder}`,
        borderRadius: 10, padding: "12px 16px", marginBottom: 14,
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        <StatusPill tone={clean ? "good" : "warn"}>
          {clean ? "no loops detected" : `${s.loops_found ?? 0} loop${s.loops_found === 1 ? "" : "s"} / ${s.unreached ?? 0} unreached`}
        </StatusPill>
        <span style={{fontSize: 13, color: FG.bodyColor}}>
          {s.pairs_probed} pair{s.pairs_probed === 1 ? "" : "s"} probed, max_hops={s.max_hops}
        </span>
      </div>

      <SummaryStrip items={[
        {label: "Probed",    value: s.pairs_probed ?? 0},
        {label: "Loops",     value: s.loops_found  ?? 0, tone: (s.loops_found ?? 0) > 0 ? "bad" : "good"},
        {label: "Unreached", value: s.unreached    ?? 0, tone: (s.unreached ?? 0) > 0 ? "warn" : "good"},
        {label: "Errors",    value: s.errors       ?? 0, tone: (s.errors ?? 0) > 0 ? "bad" : "good"},
      ]} />

      {loops.length > 0 && (
        <Section title={`Loops (${loops.length})`}>
          <Table columns={cols} rows={loops} getKey={(r, i) => `loop-${r.source}-${r.target}-${i}`} />
        </Section>
      )}
      {unreached.length > 0 && (
        <Section title={`Unreached (${unreached.length})`}>
          <Table columns={cols} rows={unreached} getKey={(r, i) => `unr-${r.source}-${r.target}-${i}`} />
        </Section>
      )}
      {errors.length > 0 && (
        <Section title={`Errors (${errors.length})`}>
          <Table columns={cols} rows={errors} getKey={(r, i) => `err-${r.source}-${r.target}-${i}`} />
        </Section>
      )}

      <Section title={`All probes (${allProbes.length})`}>
        <Table
          columns={cols}
          rows={allProbes}
          getKey={(r, i) => `all-${r.source}-${r.target}-${i}`}
          filterPlaceholder="filter by src / target…"
          filterText={(r) => `${r.source} ${r.target}`}
        />
      </Section>

      <div style={{marginTop: 4}}><Badge>transport: traceroute fanout</Badge></div>
    </div>
  );
}
