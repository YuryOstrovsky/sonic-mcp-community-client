/**
 * Widget for get_fabric_bandwidth — per-interface bps + utilization bar.
 */

import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge} from "../shared";
import {type Column, Section, SummaryStrip, Table} from "./common";

type Row = {
  switch_ip: string;
  interface: string;
  rx_bps: number;
  tx_bps: number;
  speed_bps: number | null;
  rx_pct: number | null;
  tx_pct: number | null;
};

function fmtBps(bps: number | null | undefined): string {
  if (bps == null) return "—";
  const abs = Math.abs(bps);
  if (abs >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (abs >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`;
  if (abs >= 1e3) return `${(bps / 1e3).toFixed(2)} Kbps`;
  return `${bps} bps`;
}

function UtilBar({pct}: {pct: number | null | undefined}) {
  if (pct == null) return <span style={{color: FG.mutedColor, fontSize: 11}}>—</span>;
  const clamped = Math.max(0, Math.min(100, pct));
  const color =
    clamped >= 80 ? FG.errorRed :
    clamped >= 50 ? FG.warningYellow :
    clamped > 0   ? FG.successGreen :
    FG.dimColor;
  return (
    <div style={{display: "flex", alignItems: "center", gap: 6}}>
      <div style={{width: 60, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden"}}>
        <div style={{width: `${clamped}%`, height: "100%", background: color}} />
      </div>
      <span style={{fontSize: 11, color, fontFamily: "ui-monospace, monospace", minWidth: 42}}>
        {clamped.toFixed(1)}%
      </span>
    </div>
  );
}

export function FabricBandwidthWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const rows: Row[] = payload?.interfaces ?? [];
  const topIn: Row[]  = s.top_in  ?? [];
  const topOut: Row[] = s.top_out ?? [];

  const cols: Column<Row>[] = [
    {key: "switch", label: "Switch", width: "16%", render: (r) => displayName(r.switch_ip)},
    {key: "iface",  label: "Interface", width: "14%", mono: true, render: (r) => r.interface},
    {key: "rx",     label: "RX bps", width: "14%", mono: true, align: "right", render: (r) => fmtBps(r.rx_bps)},
    {key: "rxpct",  label: "RX util", width: "16%", render: (r) => <UtilBar pct={r.rx_pct} />},
    {key: "tx",     label: "TX bps", width: "14%", mono: true, align: "right", render: (r) => fmtBps(r.tx_bps)},
    {key: "txpct",  label: "TX util", width: "16%", render: (r) => <UtilBar pct={r.tx_pct} />},
    {key: "speed",  label: "Port speed", mono: true, render: (r) => fmtBps(r.speed_bps)},
  ];

  return (
    <div>
      <SummaryStrip items={[
        {label: "Switches",    value: s.switch_count    ?? 0},
        {label: "Interfaces",  value: s.interface_count ?? 0},
        {label: "Interval",    value: `${s.interval_s ?? "?"}s`},
        {label: "Elapsed",     value: `${s.elapsed_s ?? "?"}s`},
      ]} />

      {rows.length === 0 ? (
        <Section title="Interfaces">
          <div style={{
            padding: 20,
            textAlign: "center",
            color: FG.mutedColor,
            fontSize: 13,
            border: `1px solid ${FG.divider}`,
            borderRadius: 8,
            background: "var(--bg0)",
          }}>
            No interface activity observed during the polling window. (The VS
            lab is usually idle — try running this during active traffic, or
            lower <code>min_bps</code> in the Tools view.)
          </div>
        </Section>
      ) : (
        <>
          <Section title={`Top RX (${topIn.length})`}>
            <Table columns={cols} rows={topIn} getKey={(r, i) => `in-${r.switch_ip}-${r.interface}-${i}`} />
          </Section>
          <Section title={`Top TX (${topOut.length})`}>
            <Table columns={cols} rows={topOut} getKey={(r, i) => `out-${r.switch_ip}-${r.interface}-${i}`} />
          </Section>
          <Section title={`All interfaces (${rows.length})`}>
            <Table
              columns={cols}
              rows={rows}
              getKey={(r, i) => `all-${r.switch_ip}-${r.interface}-${i}`}
              filterPlaceholder="filter by switch / interface…"
              filterText={(r) => `${r.switch_ip} ${r.interface}`}
            />
          </Section>
        </>
      )}

      <div style={{marginTop: 4}}><Badge>transport: restconf (two-poll delta)</Badge></div>
    </div>
  );
}
