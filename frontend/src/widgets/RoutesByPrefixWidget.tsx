/**
 * Widget for get_routes_by_prefix — one block per switch, with matches.
 */

import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {type Column, Section, SummaryStrip, Table} from "./common";

type Route = {
  destination?: string;
  prefix?: string;
  protocol?: string;
  nexthops?: any[];
  distance?: number;
  metric?: number;
  uptime?: string;
};

export function RoutesByPrefixWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const by_switch: Record<string, any> = payload?.by_switch ?? {};
  const total_matches = Object.values(by_switch).reduce(
    (acc: number, e: any) => acc + (e?.match_count ?? 0), 0,
  );

  const cols: Column<Route>[] = [
    {key: "dest", label: "Destination", width: "24%", mono: true, render: (r) => r.destination ?? r.prefix ?? "—"},
    {key: "proto", label: "Proto", width: "10%", render: (r) => r.protocol ?? "—"},
    {key: "ad", label: "AD/Metric", width: "14%", mono: true, render: (r) => `${r.distance ?? "-"}/${r.metric ?? "-"}`},
    {key: "nh", label: "Next-hops", mono: true, render: (r) => {
      const nhs = r.nexthops ?? [];
      if (!nhs.length) return "—";
      return nhs.map((n: any) => n.ip ?? n.gateway ?? JSON.stringify(n)).join(", ");
    }},
    {key: "uptime", label: "Uptime", width: "14%", render: (r) => r.uptime ?? "—"},
  ];

  return (
    <div>
      <div style={{
        background: "var(--bg0)", border: `1px solid ${FG.divider}`,
        borderRadius: 10, padding: "12px 16px", marginBottom: 14,
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        <span style={{fontFamily: "ui-monospace, monospace", fontSize: 14, fontWeight: 700, color: FG.titleColor}}>
          {s.prefix}
        </span>
        <Badge>mode: {s.match_mode}</Badge>
        <StatusPill tone={(s.installed_on_count ?? 0) > 0 ? "good" : "neutral"}>
          installed on {s.installed_on_count ?? 0}/{s.switch_count ?? 0}
        </StatusPill>
      </div>

      <SummaryStrip items={[
        {label: "Switches",     value: s.switch_count ?? 0},
        {label: "Installed on", value: s.installed_on_count ?? 0},
        {label: "Absent on",    value: s.absent_on?.length ?? 0},
        {label: "Total matches", value: total_matches},
      ]} />

      {Object.entries(by_switch).map(([ip, entry]: [string, any]) => (
        <Section
          key={ip}
          title={`${displayName(ip)} (${ip})`}
          right={entry.status === "ok"
            ? <StatusPill tone={entry.match_count > 0 ? "good" : "neutral"}>{entry.match_count ?? 0} match{entry.match_count === 1 ? "" : "es"}</StatusPill>
            : <StatusPill tone="bad">error</StatusPill>}
        >
          {entry.status === "error"
            ? <div style={{color: FG.errorRed, fontFamily: "ui-monospace, monospace", fontSize: 12}}>{entry.error}</div>
            : (entry.matches?.length ?? 0) === 0
              ? <div style={{color: FG.mutedColor, fontSize: 12}}>No matching routes.</div>
              : <Table columns={cols} rows={entry.matches} getKey={(r, i) => `${ip}-${r.destination ?? r.prefix ?? i}`} />}
        </Section>
      ))}

      <div style={{marginTop: 4}}><Badge>transport: ssh fanout + filter</Badge></div>
    </div>
  );
}
