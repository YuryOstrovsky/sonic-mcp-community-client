/**
 * Widget for get_lldp_neighbors.
 * Payload: { summary: {neighbor_count, stats_totals{tx,rx}, neighbor_source, notes[]},
 *            neighbors: [...], local_advertisement: {...}, per_interface_stats: [...] }
 *
 * UX note from CLIENT_CONTRACT §7: if stats_totals.rx === 0, surface the first note
 * prominently — that's the SONiC VS limitation.
 */

import {FG} from "../lib/figmaStyles";
import {Badge} from "../shared";
import {type Column, KvGrid, Section, SummaryStrip, Table, fmtNum} from "./common";

type Neighbor = {
  local_interface: string;
  system_name: string;
  chassis_id: string;
  port_id: string;
  port_description?: string;
  management_address?: string;
  ttl?: any;
  source?: string;
};

type IfStats = {
  interface: string;
  tx: any;
  rx: any;
  rx_discarded: any;
  rx_unrecognized: any;
};

export function LldpWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const totals = summary.stats_totals ?? {};
  const neighbors: Neighbor[] = payload?.neighbors ?? [];
  const local = payload?.local_advertisement ?? {};
  const stats: IfStats[] = payload?.per_interface_stats ?? [];
  const notes: string[] = summary.notes ?? [];

  const rxZero = fmtNum(totals.rx) === "0" || totals.rx === 0;

  const neighborCols: Column<Neighbor>[] = [
    {key: "local", label: "Local iface", mono: true, width: "140px", render: (n) => <span style={{fontWeight: 600}}>{n.local_interface}</span>},
    {key: "sysname", label: "System name", width: "160px", render: (n) => n.system_name},
    {key: "chassis", label: "Chassis ID", mono: true, width: "180px"},
    {key: "port", label: "Remote port", mono: true, width: "160px", render: (n) => `${n.port_id}${n.port_description ? ` (${n.port_description})` : ""}`},
    {key: "mgmt", label: "Mgmt IP", mono: true, width: "130px", render: (n) => n.management_address ?? "—"},
    {key: "ttl", label: "TTL", width: "60px", align: "right", mono: true},
  ];

  const statsCols: Column<IfStats>[] = [
    {key: "interface", label: "Interface", mono: true, width: "140px", render: (s) => <span style={{fontWeight: 600}}>{s.interface}</span>},
    {key: "tx", label: "TX", align: "right", mono: true, render: (s) => fmtNum(s.tx)},
    {key: "rx", label: "RX", align: "right", mono: true, render: (s) => {
      const n = typeof s.rx === "string" ? parseInt(s.rx, 10) : s.rx;
      const isZero = n === 0;
      return <span style={{color: isZero ? FG.warningYellow : FG.bodyColor}}>{fmtNum(s.rx)}</span>;
    }},
    {key: "rx_disc", label: "RX discarded", align: "right", mono: true, render: (s) => fmtNum(s.rx_discarded)},
    {key: "rx_unrec", label: "RX unrecognized", align: "right", mono: true, render: (s) => fmtNum(s.rx_unrecognized)},
  ];

  return (
    <div>
      {/* Diagnostic banner — the headline callout */}
      {rxZero && notes.length > 0 && (
        <div style={{
          background: FG.warningBg,
          border: `1px solid ${FG.warningBorder}`,
          borderRadius: 10,
          padding: "10px 14px",
          marginBottom: 12,
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}>
          <span style={{fontSize: 18, lineHeight: "18px", color: FG.warningYellow}}>⚠</span>
          <div>
            <div style={{color: FG.warningYellow, fontWeight: 600, fontSize: 13, marginBottom: 2}}>
              LLDP reception issue detected
            </div>
            <div style={{color: FG.bodyColor, fontSize: 12, lineHeight: 1.5}}>{notes[0]}</div>
          </div>
        </div>
      )}

      <SummaryStrip
        items={[
          {label: "Neighbors", value: summary.neighbor_count ?? neighbors.length, tone: (summary.neighbor_count ?? 0) > 0 ? "good" : "warn"},
          {label: "TX total", value: fmtNum(totals.tx), tone: "info"},
          {label: "RX total", value: fmtNum(totals.rx), tone: rxZero ? "warn" : "good"},
          {label: "Source", value: summary.neighbor_source ?? "—", tone: "neutral"},
        ]}
      />

      {neighbors.length > 0 && (
        <Section title="Neighbors">
          <Table
            columns={neighborCols}
            rows={neighbors}
            getKey={(n, i) => `${n.local_interface}-${i}`}
            filterText={(n) => `${n.local_interface} ${n.system_name} ${n.chassis_id} ${n.port_id}`}
            filterPlaceholder="filter by local interface, system, chassis…"
          />
        </Section>
      )}

      {local && Object.keys(local).length > 0 && (
        <Section title="Local advertisement (what this switch sends)">
          <KvGrid columns={2} rows={[
            {label: "System name",  value: local.system_name,  mono: true},
            {label: "Chassis ID",   value: local.chassis_id,   mono: true},
            {label: "Mgmt address", value: local.management_address, mono: true},
            {label: "Capabilities", value: (local.capabilities || []).filter((c: any) => c?.enabled).map((c: any) => c.type).join(", ") || "—"},
            {label: "Chassis type", value: local.chassis_id_type},
            {label: "System description", value: local.system_description},
          ]} />
        </Section>
      )}

      {stats.length > 0 && (
        <Section title="Per-interface TX/RX">
          <Table
            columns={statsCols}
            rows={stats}
            getKey={(s) => s.interface}
            filterText={(s) => s.interface}
            filterPlaceholder="filter by interface…"
            maxHeight={360}
          />
        </Section>
      )}

      {notes.length > 1 && (
        <Section title="Notes">
          <ul style={{margin: 0, paddingLeft: 18, color: FG.bodyColor, fontSize: 12}}>
            {notes.map((n, i) => <li key={i} style={{marginBottom: 4}}>{n}</li>)}
          </ul>
        </Section>
      )}

      <div style={{marginTop: 4, display: "flex", gap: 6}}>
        <Badge>transport: restconf+ssh</Badge>
        {summary.neighbor_source && <Badge>neighbor source: {summary.neighbor_source}</Badge>}
      </div>
    </div>
  );
}
