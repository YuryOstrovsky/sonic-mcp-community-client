/**
 * Dashboard view — at-a-glance lab health: device cards from /api/ready,
 * upstream MCP status, and a per-switch operational summary (system /
 * interfaces / BGP / LLDP fanouts).
 */

import {FG} from "./lib/figmaStyles";
import {displayName} from "./lib/state";
import {Panel, StatusPill, Badge, EmptyState, Loading} from "./shared";
import type {ToolSpec} from "./lib/api";
import {PerSwitchSummary} from "./PerSwitchSummary";

function toolsBreakdown(tools: ToolSpec[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) {
    const risk = t.policy?.risk ?? "SAFE_READ";
    counts.set(risk, (counts.get(risk) ?? 0) + 1);
  }
  // Preferred display order: SAFE_READ → MUTATION → DESTRUCTIVE → anything else.
  const order = ["SAFE_READ", "MUTATION", "DESTRUCTIVE"];
  const parts: string[] = [];
  for (const risk of order) {
    const n = counts.get(risk);
    if (n) parts.push(`${n} ${risk.toLowerCase().replace("_", " ")}`);
  }
  for (const [risk, n] of counts) {
    if (!order.includes(risk)) parts.push(`${n} ${risk.toLowerCase()}`);
  }
  return parts.join(" · ");
}

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
  refreshKey?: number;
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
          sub={props.tools ? toolsBreakdown(props.tools) : "loading catalog"}
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
          <EmptyState>
            <div style={{display: "flex", flexDirection: "column", alignItems: "center", gap: 10}}>
              <div>No devices in inventory yet.</div>
              <button
                type="button"
                onClick={() => window.dispatchEvent(
                  new CustomEvent("sonic-mcp:open-view", {detail: "settings"}),
                )}
                style={{
                  padding: "6px 14px",
                  border: `1px solid ${FG.btnPrimaryBorder}`,
                  background: FG.btnPrimaryBg,
                  color: "#0b1220",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Add your first switch →
              </button>
              <div style={{fontSize: 11, color: FG.dimColor}}>
                Settings → Fabric Inventory lets you add switches by
                IP or walk a seed with LLDP discovery.
              </div>
            </div>
          </EmptyState>
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
      <PerSwitchSummary selectedSwitch={props.selectedSwitch} refreshKey={props.refreshKey} />
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
        {(props.tone === "good" || props.tone === "warn" || props.tone === "bad") && (
          <StatusPill tone={props.tone}>{props.tone === "good" ? "ok" : props.tone}</StatusPill>
        )}
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
        {/* Transport tags: neutral by default (they're labels showing what's */}
        {/* supported). Recolor only when a transport is down — that's the   */}
        {/* signal worth looking at.                                          */}
        <StatusPill tone={rc ? "neutral" : "bad"}>RESTCONF</StatusPill>
        <StatusPill tone={ssh ? "neutral" : "bad"}>SSH</StatusPill>
        <StatusPill tone={both ? "good" : rc || ssh ? "warn" : "bad"}>
          {both ? "all good" : rc || ssh ? "partial" : "down"}
        </StatusPill>
      </div>
    </div>
  );
}
