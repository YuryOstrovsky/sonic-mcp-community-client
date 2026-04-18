/**
 * Widget for get_routes and get_ipv6_routes — same payload shape.
 * Shows protocol breakdown strip + flat route table with nexthops.
 * Payload: { summary: {prefix_count, entry_count, by_protocol, vrf}, routes: [...] }
 */

import {FG} from "../lib/figmaStyles";
import {Badge, StatusPill} from "../shared";
import {type Column, Section, SummaryStrip, Table} from "./common";

type Nexthop = {
  ip?: string;
  interface?: string;
  directly_connected?: boolean;
  active?: boolean;
  fib?: boolean;
};
type Row = {
  prefix: string;
  protocol: string;
  selected: boolean;
  installed: boolean;
  distance: any;
  metric: any;
  uptime?: string;
  vrf?: string;
  nexthops: Nexthop[];
};

const PROTO_COLORS: Record<string, string> = {
  connected: "#22c55e",
  bgp: "#8b8fd8",
  kernel: "#94a3b8",
  static: "#eab308",
  ospf: "#3b82f6",
};

export function RoutesWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const rows: Row[] = payload?.routes ?? [];
  const byProto: Record<string, number> = summary.by_protocol ?? {};

  const columns: Column<Row>[] = [
    {key: "prefix", label: "Prefix", mono: true, width: "210px", render: (r) => <span style={{fontWeight: 600}}>{r.prefix}</span>},
    {key: "proto", label: "Proto", width: "90px", render: (r) => (
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: 6,
        color: PROTO_COLORS[r.protocol] ?? FG.bodyColor,
        border: `1px solid ${(PROTO_COLORS[r.protocol] ?? FG.rowDefaultBorder)}40`,
        background: `${(PROTO_COLORS[r.protocol] ?? "#64748b")}15`,
      }}>{r.protocol}</span>
    )},
    {key: "flags", label: "Flags", width: "100px", render: (r) => (
      <div style={{display: "flex", gap: 3}}>
        {r.selected && <Badge title="selected">sel</Badge>}
        {r.installed && <Badge title="installed in FIB">fib</Badge>}
      </div>
    )},
    {key: "ad", label: "AD/Met", width: "70px", mono: true, align: "right", render: (r) => `${r.distance ?? "-"}/${r.metric ?? "-"}`},
    {key: "uptime", label: "Uptime", width: "90px", mono: true, render: (r) => r.uptime ?? "—"},
    {key: "nexthops", label: "Nexthops", render: (r) => (
      <div style={{display: "flex", flexDirection: "column", gap: 2}}>
        {r.nexthops.length === 0 && <span style={{color: FG.dimColor}}>—</span>}
        {r.nexthops.map((nh, i) => (
          <div key={i} style={{fontFamily: "ui-monospace, monospace", fontSize: 12}}>
            {nh.directly_connected ? (
              <span style={{color: FG.successGreen}}>→ directly connected</span>
            ) : (
              <span>{nh.ip ?? "?"}</span>
            )}
            {nh.interface && <span style={{color: FG.mutedColor}}> · {nh.interface}</span>}
            {nh.fib && <span style={{color: FG.successGreen, fontSize: 10, marginLeft: 6}}>●fib</span>}
          </div>
        ))}
      </div>
    )},
  ];

  return (
    <div>
      <SummaryStrip
        items={[
          {label: "Prefixes", value: summary.prefix_count ?? "—", tone: "info"},
          {label: "Entries", value: summary.entry_count ?? rows.length, tone: "info"},
          {label: "VRF", value: summary.vrf ?? "default", tone: "neutral"},
        ]}
      />

      {Object.keys(byProto).length > 0 && (
        <Section title="By protocol">
          <div style={{display: "flex", flexWrap: "wrap", gap: 6}}>
            {Object.entries(byProto).map(([p, n]) => (
              <StatusPill key={p} tone="info">
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: PROTO_COLORS[p] ?? "#64748b",
                  display: "inline-block",
                  marginRight: 2,
                }} />
                {p}: {n}
              </StatusPill>
            ))}
          </div>
        </Section>
      )}

      <Section title="Routes" right={<Badge>{summary.source}</Badge>}>
        <Table
          columns={columns}
          rows={rows}
          getKey={(r, i) => `${r.prefix}-${r.protocol}-${i}`}
          filterText={(r) => `${r.prefix} ${r.protocol} ${r.nexthops.map(n => `${n.ip ?? ""} ${n.interface ?? ""}`).join(" ")}`}
          filterPlaceholder="filter by prefix, proto, interface…"
          emptyText="No routes returned."
          maxHeight={520}
        />
      </Section>
    </div>
  );
}
