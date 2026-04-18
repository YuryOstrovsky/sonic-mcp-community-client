/**
 * Widget for get_mac_table — VLAN/MAC/port/type table.
 */

import {Badge} from "../shared";
import {type Column, SummaryStrip, Table} from "./common";

type Row = {
  vlan: number | string | null;
  mac: string;
  port: string | null;
  type: string | null;
};

export function MacTableWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const rows: Row[] = payload?.entries ?? [];

  const cols: Column<Row>[] = [
    {key: "vlan", label: "VLAN", width: "10%", mono: true, align: "right", render: (r) => r.vlan ?? "—"},
    {key: "mac",  label: "MAC",  width: "26%", mono: true, render: (r) => r.mac},
    {key: "port", label: "Port", width: "20%", mono: true, render: (r) => r.port ?? "—"},
    {key: "type", label: "Type", render: (r) => r.type ?? "—"},
  ];

  return (
    <div>
      <SummaryStrip items={[
        {label: "Entries",   value: s.count ?? rows.length},
        {label: "Switch IP", value: s.switch_ip},
      ]} />
      <Table
        columns={cols}
        rows={rows}
        getKey={(r, i) => `${r.vlan ?? ""}-${r.mac}-${i}`}
        emptyText="No MAC entries (idle lab). Drive traffic to populate the FDB."
        filterPlaceholder="filter by mac / port / vlan…"
        filterText={(r) => `${r.vlan ?? ""} ${r.mac} ${r.port ?? ""} ${r.type ?? ""}`}
      />
      <div style={{marginTop: 4}}><Badge>transport: ssh show mac</Badge></div>
    </div>
  );
}
