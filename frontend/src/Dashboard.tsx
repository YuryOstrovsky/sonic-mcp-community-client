/**
 * Dashboard view — at-a-glance lab health.
 *
 * Phase B: device cards from /api/ready, upstream MCP status.
 * Phase C: will add per-tool summary widgets (interfaces up count, BGP
 * established count, LLDP RX diagnostic, etc.) per selected switch.
 */

import {FG} from "./lib/figmaStyles";
import {displayName} from "./lib/state";
import {Panel, StatusPill, Badge, EmptyState, Loading} from "./shared";
import type {ToolSpec} from "./lib/api";
import {PerSwitchSummary} from "./PerSwitchSummary";

type DeviceStatus = {restconf?: boolean; ssh?: boolean};
type ReadyShape = {
  status_code?: number;
  body?: {
    status?: string;
    checks?: {
      registry?: boolean;
      devices?: Record<string, DeviceStatus>;
    };
  };
};
type HealthShape = {
  upstream?: {
    reachable?: boolean;
    base_url?: string;
    body?: {service?: string; version?: string};
  };
};

export function Dashboard(props: {
  ready: ReadyShape | null;
  health: HealthShape | null;
  tools: ToolSpec[] | null;
  selectedSwitch: string | null;
}) {
  const devices = props.ready?.body?.checks?.devices ?? {};
  const deviceIps = Object.keys(devices);
  const overall = props.ready?.body?.status;

  return (
    <div>
      <h1 style={{margin: "0 0 20px 0", color: FG.titleColor, fontSize: 22, fontWeight: 600}}>
        Dashboard
      </h1>

      {/* Top strip: MCP server + registry summary */}
      <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginBottom: 16}}>
        <SummaryCard
          label="MCP server"
          value={props.health?.upstream?.reachable ? "reachable" : "unreachable"}
          tone={props.health?.upstream?.reachable ? "good" : "bad"}
          sub={props.health?.upstream?.base_url ?? "—"}
        />
        <SummaryCard
          label="Overall readiness"
          value={overall ?? "…"}
          tone={overall === "ready" ? "good" : overall ? "bad" : "neutral"}
          sub={`${deviceIps.length} device${deviceIps.length === 1 ? "" : "s"} in inventory`}
        />
        <SummaryCard
          label="Tools"
          value={props.tools ? String(props.tools.length) : "…"}
          tone="info"
          sub={props.tools ? "all SAFE_READ" : "loading catalog"}
        />
        <SummaryCard
          label="Server version"
          value={props.health?.upstream?.body?.version ?? "—"}
          tone="neutral"
          sub={props.health?.upstream?.body?.service ?? ""}
        />
      </div>

      {/* Device cards */}
      <Panel title="Devices">
        {props.ready === null ? (
          <Loading />
        ) : deviceIps.length === 0 ? (
          <EmptyState>No devices in inventory.</EmptyState>
        ) : (
          <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12}}>
            {deviceIps.map((ip) => (
              <DeviceCard
                key={ip}
                ip={ip}
                status={devices[ip]}
                selected={ip === props.selectedSwitch}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* Per-switch operational summary — fans out system/interfaces/bgp/lldp */}
      <PerSwitchSummary selectedSwitch={props.selectedSwitch} />
    </div>
  );
}

function SummaryCard(props: {
  label: string;
  value: string;
  sub?: string;
  tone: "good" | "warn" | "bad" | "info" | "neutral";
}) {
  return (
    <div style={{
      background: FG.containerBg,
      border: `1px solid ${FG.containerBorder}`,
      borderRadius: FG.containerRadius,
      padding: 14,
      boxShadow: FG.containerShadow,
    }}>
      <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1.1}}>
        {props.label}
      </div>
      <div style={{display: "flex", alignItems: "baseline", gap: 10, marginTop: 6}}>
        <div style={{fontSize: 22, fontWeight: 600, color: FG.headingColor}}>
          {props.value}
        </div>
        <StatusPill tone={props.tone}>{props.tone}</StatusPill>
      </div>
      {props.sub && (
        <div style={{fontSize: 12, color: FG.mutedColor, marginTop: 6}}>{props.sub}</div>
      )}
    </div>
  );
}

function DeviceCard(props: {
  ip: string;
  status: DeviceStatus;
  selected: boolean;
}) {
  const rc = !!props.status.restconf;
  const ssh = !!props.status.ssh;
  const both = rc && ssh;
  return (
    <div style={{
      background: "var(--bg0)",
      border: `1px solid ${props.selected ? FG.rowSelectedBorder : FG.containerBorder}`,
      borderRadius: FG.containerRadius,
      padding: 14,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      boxShadow: props.selected ? FG.containerShadow : "none",
    }}>
      <div style={{display: "flex", alignItems: "baseline", justifyContent: "space-between"}}>
        <div>
          <div style={{fontSize: 16, fontWeight: 600, color: FG.titleColor}}>{displayName(props.ip)}</div>
          <div style={{fontSize: 12, color: FG.mutedColor, fontFamily: "ui-monospace, monospace"}}>{props.ip}</div>
        </div>
        {props.selected && <Badge>selected</Badge>}
      </div>
      <div style={{display: "flex", gap: 6, flexWrap: "wrap"}}>
        <StatusPill tone={rc ? "good" : "bad"}>RESTCONF</StatusPill>
        <StatusPill tone={ssh ? "good" : "bad"}>SSH</StatusPill>
        <StatusPill tone={both ? "good" : rc || ssh ? "warn" : "bad"}>
          {both ? "all good" : rc || ssh ? "partial" : "down"}
        </StatusPill>
      </div>
    </div>
  );
}
