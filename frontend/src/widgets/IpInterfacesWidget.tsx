/**
 * Widget for get_ip_interfaces — IP address assignments per subinterface.
 * Payload shape: { summary: {count, ipv4_count, ipv6_count, source}, ip_interfaces: [...] }
 */

import {Badge} from "../shared";
import {type Column, Section, SummaryStrip, Table, UpDownPill} from "./common";

type Row = {
  interface: string;
  subif: number;
  family: "ipv4" | "ipv6";
  address: string;
  admin_status: any;
  oper_status: any;
};

export function IpInterfacesWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const rows: Row[] = payload?.ip_interfaces ?? [];

  const columns: Column<Row>[] = [
    {key: "interface", label: "Interface", mono: true, width: "160px", render: (r) => <span style={{fontWeight: 600}}>{r.interface}</span>},
    {key: "subif", label: "Sub", width: "60px", align: "right", mono: true},
    {key: "family", label: "Family", width: "80px", render: (r) => (
      <span style={{
        fontSize: 11,
        padding: "1px 6px",
        borderRadius: 6,
        background: r.family === "ipv4" ? "rgba(59,130,246,0.15)" : "rgba(139,143,216,0.15)",
        color: r.family === "ipv4" ? "#60a5fa" : "#a5b4fc",
        border: `1px solid ${r.family === "ipv4" ? "rgba(59,130,246,0.3)" : "rgba(139,143,216,0.3)"}`,
      }}>{r.family}</span>
    )},
    {key: "address", label: "Address", mono: true, render: (r) => <span style={{fontWeight: 600}}>{r.address}</span>},
    {key: "admin", label: "Admin", width: "80px", render: (r) => <UpDownPill value={r.admin_status} />},
    {key: "oper", label: "Oper", width: "80px", render: (r) => <UpDownPill value={r.oper_status} />},
  ];

  return (
    <div>
      <SummaryStrip
        items={[
          {label: "IP assignments", value: summary.count ?? rows.length, tone: "info"},
          {label: "IPv4", value: summary.ipv4_count ?? rows.filter(r => r.family === "ipv4").length, tone: "info"},
          {label: "IPv6", value: summary.ipv6_count ?? rows.filter(r => r.family === "ipv6").length, tone: "info"},
        ]}
      />
      <Section title="IP interfaces" right={<Badge>{summary.source}</Badge>}>
        <Table
          columns={columns}
          rows={rows}
          getKey={(r) => `${r.interface}.${r.subif}.${r.family}.${r.address}`}
          filterText={(r) => `${r.interface} ${r.address} ${r.family}`}
          filterPlaceholder="filter by interface or address…"
          emptyText="No IP interfaces assigned."
        />
      </Section>
    </div>
  );
}
