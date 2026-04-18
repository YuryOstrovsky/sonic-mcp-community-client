/**
 * Widget for get_interfaces — interface status + counters table.
 * Payload shape: { summary: {count, oper_up, filter, source}, interfaces: [...] }
 */

import {displayName} from "../lib/state";
import {Badge} from "../shared";
import {type Column, Section, SummaryStrip, Table, UpDownPill, fmtNum} from "./common";
import {RowActionsMenu, type RowAction} from "./RowActions";

type Row = {
  name: string;
  admin_status: any;
  oper_status: any;
  mtu: any;
  description: any;
  port_speed: any;
  in_pkts: any; out_pkts: any;
  in_errors: any; out_errors: any;
  in_discards: any; out_discards: any;
};

function cleanSpeed(v: any): string {
  if (!v) return "";
  const s = String(v);
  // "openconfig-if-ethernet:SPEED_40GB" -> "40GB"
  const m = s.match(/SPEED_([A-Z0-9]+)/);
  return m ? m[1] : s;
}

export function InterfacesWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const rows: Row[] = payload?.interfaces ?? [];
  const switchIp: string | undefined = summary.switch_ip;
  const switchAlias = switchIp ? displayName(switchIp) : "<switch>";

  function actionsFor(r: Row): RowAction[] {
    const isEth = /^Ethernet\d+$/.test(r.name);
    return [
      {
        label: "Bring down (admin)",
        tone: "warn",
        prompt: () => isEth ? `shutdown ${r.name} on ${switchAlias}` : null,
      },
      {
        label: "Bring up (admin)",
        prompt: () => isEth ? `set ${r.name} up on ${switchAlias}` : null,
      },
      {
        label: "Change MTU…",
        prompt: () => isEth ? `set mtu of ${r.name} to 9100 on ${switchAlias}` : null,
      },
      {
        label: "Set description…",
        prompt: () => `set description ${r.name} "updated via MCP" on ${switchAlias}`,
      },
      {
        label: "Clear counters",
        prompt: () => `clear counters on ${switchAlias}`,
      },
    ];
  }

  const adminUp = rows.filter((r) => String(r.admin_status ?? "").toUpperCase() === "UP").length;
  const operUp = summary.oper_up ?? rows.filter((r) => String(r.oper_status ?? "").toUpperCase() === "UP").length;

  const totalErrors = rows.reduce((acc, r) => acc + (parseInt(r.in_errors ?? "0") || 0) + (parseInt(r.out_errors ?? "0") || 0), 0);
  const totalDiscards = rows.reduce((acc, r) => acc + (parseInt(r.in_discards ?? "0") || 0) + (parseInt(r.out_discards ?? "0") || 0), 0);

  const columns: Column<Row>[] = [
    {key: "name", label: "Interface", mono: true, width: "140px", render: (r) => <span style={{fontWeight: 600}}>{r.name}</span>},
    {key: "admin", label: "Admin", width: "72px", render: (r) => <UpDownPill value={r.admin_status} />},
    {key: "oper", label: "Oper", width: "72px", render: (r) => <UpDownPill value={r.oper_status} />},
    {key: "speed", label: "Speed", width: "80px", mono: true, render: (r) => cleanSpeed(r.port_speed)},
    {key: "mtu", label: "MTU", width: "64px", align: "right", mono: true, render: (r) => fmtNum(r.mtu)},
    {key: "in_pkts", label: "In pkts", width: "100px", align: "right", mono: true, render: (r) => fmtNum(r.in_pkts)},
    {key: "out_pkts", label: "Out pkts", width: "100px", align: "right", mono: true, render: (r) => fmtNum(r.out_pkts)},
    {key: "errs", label: "Errors", width: "80px", align: "right", mono: true, render: (r) => {
      const e = (parseInt(r.in_errors ?? "0") || 0) + (parseInt(r.out_errors ?? "0") || 0);
      return e > 0 ? <span style={{color: "#ef4444"}}>{e.toLocaleString()}</span> : "0";
    }},
    {key: "disc", label: "Discards", width: "90px", align: "right", mono: true, render: (r) => {
      const d = (parseInt(r.in_discards ?? "0") || 0) + (parseInt(r.out_discards ?? "0") || 0);
      return d > 0 ? <span style={{color: "#eab308"}}>{d.toLocaleString()}</span> : "0";
    }},
    {key: "descr", label: "Description", render: (r) => r.description || <span style={{opacity: 0.5}}>—</span>},
    {key: "actions", label: "", width: "32px", render: (r) => <RowActionsMenu actions={actionsFor(r)} />},
  ];

  return (
    <div>
      <SummaryStrip
        items={[
          {label: "Interfaces", value: rows.length, tone: "info"},
          {label: "Admin UP", value: adminUp, tone: adminUp ? "good" : "neutral", sub: `${rows.length - adminUp} down`},
          {label: "Oper UP", value: operUp ?? "—", tone: operUp ? "good" : "warn", sub: operUp ? undefined : "oper-status not reported"},
          {label: "Total errors", value: fmtNum(totalErrors), tone: totalErrors > 0 ? "bad" : "good"},
          {label: "Total discards", value: fmtNum(totalDiscards), tone: totalDiscards > 0 ? "warn" : "good"},
        ]}
      />
      <Section
        title="Per-interface"
        right={<Badge>{summary.source}</Badge>}
      >
        <Table
          columns={columns}
          rows={rows}
          getKey={(r) => r.name}
          filterText={(r) => `${r.name} ${r.description ?? ""} ${r.port_speed ?? ""}`}
          filterPlaceholder="filter by name or description…"
          emptyText="No interfaces returned."
        />
      </Section>
    </div>
  );
}
