/**
 * Widget for get_vlans.
 * Payload: { summary: {count, source}, vlans: [{vlan_id, ip_address, ports, port_tagging, proxy_arp, dhcp_helper_address}] }
 */

import {FG} from "../lib/figmaStyles";
import {Badge} from "../shared";
import {type Column, Section, SummaryStrip, Table} from "./common";

type Row = {
  vlan_id: string;
  ip_address?: string | null;
  ports: string[];
  port_tagging?: string | null;
  proxy_arp?: string | null;
  dhcp_helper_address?: string | null;
};

export function VlansWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const rows: Row[] = payload?.vlans ?? [];

  const withIp = rows.filter((r) => r.ip_address && r.ip_address.trim()).length;
  const totalPorts = rows.reduce((a, r) => a + (r.ports?.length ?? 0), 0);

  const columns: Column<Row>[] = [
    {key: "vlan_id", label: "VLAN", width: "80px", align: "right", mono: true, render: (r) => (
      <span style={{fontWeight: 600, color: FG.titleColor}}>{r.vlan_id}</span>
    )},
    {key: "ip_address", label: "IP address", mono: true, width: "160px", render: (r) => r.ip_address || <span style={{color: FG.dimColor}}>—</span>},
    {key: "ports", label: "Members", render: (r) => (
      r.ports.length === 0 ? (
        <span style={{color: FG.dimColor}}>no members</span>
      ) : (
        <div style={{display: "flex", flexWrap: "wrap", gap: 4}}>
          {r.ports.map((p) => <Badge key={p}>{p}</Badge>)}
        </div>
      )
    )},
    {key: "tagging", label: "Tagging", width: "100px", render: (r) => r.port_tagging || <span style={{color: FG.dimColor}}>—</span>},
    {key: "proxy", label: "Proxy ARP", width: "100px", render: (r) => r.proxy_arp || "—"},
    {key: "dhcp", label: "DHCP helper", render: (r) => r.dhcp_helper_address || <span style={{color: FG.dimColor}}>—</span>},
  ];

  return (
    <div>
      <SummaryStrip
        items={[
          {label: "VLANs", value: summary.count ?? rows.length, tone: "info"},
          {label: "With IP", value: withIp, tone: withIp ? "good" : "neutral"},
          {label: "Member ports", value: totalPorts, tone: "neutral"},
        ]}
      />
      <Section title="Configured VLANs" right={<Badge>{summary.source}</Badge>}>
        <Table
          columns={columns}
          rows={rows}
          getKey={(r) => r.vlan_id}
          filterText={(r) => `${r.vlan_id} ${r.ip_address ?? ""} ${(r.ports || []).join(" ")}`}
          filterPlaceholder="filter by vlan id, ip, or member…"
          emptyText="No VLANs configured."
        />
      </Section>
    </div>
  );
}
