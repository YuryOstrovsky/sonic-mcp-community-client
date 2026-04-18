/**
 * Widget for get_arp_table.
 * Payload: { summary: {count, source}, entries: [{ip, mac, interface, vlan}] }
 */

import {Badge} from "../shared";
import {type Column, Section, SummaryStrip, Table} from "./common";

type Row = {
  ip: string;
  mac?: string | null;
  interface?: string | null;
  vlan?: string | null;
};

export function ArpTableWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const rows: Row[] = payload?.entries ?? [];

  const uniqInterfaces = new Set(rows.map((r) => r.interface).filter(Boolean)).size;
  const uniqVlans = new Set(rows.map((r) => r.vlan).filter(Boolean)).size;

  const columns: Column<Row>[] = [
    {key: "ip", label: "IP", mono: true, width: "160px", render: (r) => <span style={{fontWeight: 600}}>{r.ip}</span>},
    {key: "mac", label: "MAC", mono: true, width: "180px"},
    {key: "interface", label: "Interface", mono: true, width: "140px"},
    {key: "vlan", label: "VLAN", width: "80px", render: (r) => r.vlan || "—"},
  ];

  return (
    <div>
      <SummaryStrip
        items={[
          {label: "Entries", value: summary.count ?? rows.length, tone: "info"},
          {label: "Interfaces", value: uniqInterfaces, tone: "neutral"},
          {label: "VLANs", value: uniqVlans, tone: "neutral"},
        ]}
      />
      <Section title="ARP entries" right={<Badge>{summary.source}</Badge>}>
        <Table
          columns={columns}
          rows={rows}
          getKey={(r, i) => `${r.ip}-${i}`}
          filterText={(r) => `${r.ip} ${r.mac ?? ""} ${r.interface ?? ""}`}
          filterPlaceholder="filter by ip, mac, or interface…"
          emptyText="ARP table is empty."
        />
      </Section>
    </div>
  );
}
