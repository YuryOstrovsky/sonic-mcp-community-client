/**
 * Widget dispatcher + ToolResultPanel wrapper.
 *
 * Every /invoke result flows through ToolResultPanel. It picks the right
 * widget from the registry based on tool name, renders a compact meta
 * header (status, transport, duration), and offers a toggle to see the
 * raw JSON payload instead. Unknown tools fall back to JSON.
 */

import {useState, type ReactNode} from "react";
import {FG} from "../lib/figmaStyles";
import {copyToClipboard, detectTableArray, downloadFile, toCsv, toMarkdown} from "../lib/export";
import {Badge, JsonView, StatusPill} from "../shared";
import {ActivityWidget} from "./ActivityWidget";
import {ArpTableWidget} from "./ArpTableWidget";
import {BgpSummaryWidget} from "./BgpSummaryWidget";
import {DrainRotateWidget} from "./DrainRotateWidget";
import {FabricBandwidthWidget} from "./FabricBandwidthWidget";
import {FabricConfigDiffWidget} from "./FabricConfigDiffWidget";
import {FabricHealthWidget} from "./FabricHealthWidget";
import {FabricIntentWidget} from "./FabricIntentWidget";
import {FabricMtuWidget} from "./FabricMtuWidget";
import {FabricTopologyWidget} from "./FabricTopologyWidget";
import {HelpWidget} from "./HelpWidget";
import {IperfBetweenWidget} from "./IperfBetweenWidget";
import {InterfacesWidget} from "./InterfacesWidget";
import {IpInterfacesWidget} from "./IpInterfacesWidget";
import {LldpWidget} from "./LldpWidget";
import {MultiDeviceWidget, setMultiInnerRenderer} from "./MultiDeviceWidget";
import {MacTableWidget} from "./MacTableWidget";
import {MutationResultWidget} from "./MutationResultWidget";
import {PingBetweenWidget} from "./PingBetweenWidget";
import {ReachabilityMatrixWidget} from "./ReachabilityMatrixWidget";
import {RoutesByPrefixWidget} from "./RoutesByPrefixWidget";
import {RoutingLoopWidget} from "./RoutingLoopWidget";
import {SnapshotCompareWidget} from "./SnapshotCompareWidget";
import {SnapshotWidget} from "./SnapshotWidget";
import {TracerouteWidget} from "./TracerouteWidget";
import {PlatformDetailWidget} from "./PlatformDetailWidget";
import {PortchannelsWidget} from "./PortchannelsWidget";
import {RoutesWidget} from "./RoutesWidget";
import {SflowStatusWidget} from "./SflowStatusWidget";
import {ShowCommandWidget} from "./ShowCommandWidget";
import {SystemInfoWidget} from "./SystemInfoWidget";
import {VlansWidget} from "./VlansWidget";

type WidgetRender = (p: {tool: string; payload: any}) => ReactNode;

const REGISTRY: Record<string, WidgetRender> = {
  get_interfaces:       (p) => <InterfacesWidget      payload={p.payload} />,
  get_ip_interfaces:    (p) => <IpInterfacesWidget    payload={p.payload} />,
  get_routes:           (p) => <RoutesWidget          payload={p.payload} />,
  get_ipv6_routes:      (p) => <RoutesWidget          payload={p.payload} />,
  get_bgp_summary:      (p) => <BgpSummaryWidget      payload={p.payload} />,
  get_lldp_neighbors:   (p) => <LldpWidget            payload={p.payload} />,
  get_system_info:      (p) => <SystemInfoWidget      payload={p.payload} />,
  run_show_command:     (p) => <ShowCommandWidget     payload={p.payload} />,
  get_vlans:            (p) => <VlansWidget           payload={p.payload} />,
  get_arp_table:        (p) => <ArpTableWidget        payload={p.payload} />,
  get_portchannels:     (p) => <PortchannelsWidget    payload={p.payload} />,
  get_platform_detail:  (p) => <PlatformDetailWidget  payload={p.payload} />,
  get_sflow_status:     (p) => <SflowStatusWidget     payload={p.payload} />,
  get_system_info_all:  (p) => <MultiDeviceWidget     tool={p.tool} payload={p.payload} />,
  get_interfaces_all:   (p) => <MultiDeviceWidget     tool={p.tool} payload={p.payload} />,
  get_bgp_summary_all:  (p) => <MultiDeviceWidget     tool={p.tool} payload={p.payload} />,
  get_routes_all:       (p) => <MultiDeviceWidget     tool={p.tool} payload={p.payload} />,
  get_lldp_neighbors_all: (p) => <MultiDeviceWidget   tool={p.tool} payload={p.payload} />,
  get_vlans_all:        (p) => <MultiDeviceWidget     tool={p.tool} payload={p.payload} />,
  help:                 (p) => <HelpWidget            payload={p.payload} />,
  // Fabric
  get_fabric_topology:  (p) => <FabricTopologyWidget  payload={p.payload} />,
  get_fabric_health:    (p) => <FabricHealthWidget    payload={p.payload} />,
  ping_between:         (p) => <PingBetweenWidget     payload={p.payload} />,
  traceroute_between:   (p) => <TracerouteWidget      payload={p.payload} />,
  get_fabric_reachability_matrix: (p) => <ReachabilityMatrixWidget payload={p.payload} />,
  get_fabric_mtu_consistency:     (p) => <FabricMtuWidget          payload={p.payload} />,
  get_fabric_bandwidth:           (p) => <FabricBandwidthWidget    payload={p.payload} />,
  get_fabric_config_diff:         (p) => <FabricConfigDiffWidget   payload={p.payload} />,
  validate_fabric_vs_intent:      (p) => <FabricIntentWidget       payload={p.payload} />,
  iperf_between:                  (p) => <IperfBetweenWidget       payload={p.payload} />,
  get_routes_by_prefix:           (p) => <RoutesByPrefixWidget     payload={p.payload} />,
  save_fabric_snapshot:           (p) => <SnapshotWidget           payload={p.payload} mode="save" />,
  restore_fabric_snapshot:        (p) => <SnapshotWidget           payload={p.payload} mode="restore" />,
  compare_fabric_snapshots:       (p) => <SnapshotCompareWidget    payload={p.payload} />,
  fabric_drain_rotate:            (p) => <DrainRotateWidget        payload={p.payload} />,
  detect_routing_loop:            (p) => <RoutingLoopWidget        payload={p.payload} />,
  get_mac_table:                  (p) => <MacTableWidget           payload={p.payload} />,
  get_mac_table_all:              (p) => <MultiDeviceWidget        tool={p.tool} payload={p.payload} />,
  get_arp_table_all:              (p) => <MultiDeviceWidget        tool={p.tool} payload={p.payload} />,
  rollback_mutation:              (p) => <MutationResultWidget     payload={p.payload} />,
  // Mutation result widgets — pre/post diff + mutation_id link
  set_interface_admin_status: (p) => <MutationResultWidget payload={p.payload} />,
  set_interface_mtu:         (p) => <MutationResultWidget payload={p.payload} />,
  set_interface_description: (p) => <MutationResultWidget payload={p.payload} />,
  set_ip_interface:          (p) => <MutationResultWidget payload={p.payload} />,
  clear_interface_counters:  (p) => <MutationResultWidget payload={p.payload} />,
  add_vlan:                  (p) => <MutationResultWidget payload={p.payload} />,
  remove_vlan:               (p) => <MutationResultWidget payload={p.payload} />,
  set_portchannel_member:    (p) => <MutationResultWidget payload={p.payload} />,
  add_static_route:          (p) => <MutationResultWidget payload={p.payload} />,
  remove_static_route:       (p) => <MutationResultWidget payload={p.payload} />,
  set_bgp_neighbor_admin:    (p) => <MutationResultWidget payload={p.payload} />,
  drain_switch:              (p) => <MutationResultWidget payload={p.payload} />,
  undrain_switch:            (p) => <MutationResultWidget payload={p.payload} />,
  config_save:          (p) => <MutationResultWidget  payload={p.payload} />,
  // Audit log — the Activity view also uses this widget
  get_mutation_history: (p) => <ActivityWidget        payload={p.payload} />,
};

// Break the circular import: MultiDeviceWidget needs to recursively render
// any tool's widget, but it can't import REGISTRY directly without a cycle.
// We inject a lookup here at module init.
setMultiInnerRenderer((tool, payload) => {
  const fn = REGISTRY[tool];
  return fn ? fn({tool, payload}) : <JsonView data={payload} />;
});

export function hasWidget(tool: string): boolean {
  return tool in REGISTRY;
}

export function ToolWidget(props: {tool: string; payload: any}) {
  const fn = REGISTRY[props.tool];
  if (fn) return <>{fn({tool: props.tool, payload: props.payload})}</>;
  return <JsonView data={props.payload} />;
}

export function ToolResultPanel(props: {
  tool: string;
  payload: any;
  meta?: {status?: number; transport?: string; duration_ms?: number};
  title?: ReactNode;
  defaultRaw?: boolean;
}) {
  const [raw, setRaw] = useState(!!props.defaultRaw);
  const known = hasWidget(props.tool);
  const m = props.meta ?? {};

  return (
    <div>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginBottom: 10,
        flexWrap: "wrap",
      }}>
        <div style={{display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap"}}>
          {props.title ?? (
            <span style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 600,
              color: FG.headingColor,
              fontSize: 13,
            }}>{props.tool}</span>
          )}
          {m.status !== undefined && (
            <StatusPill tone={m.status === 200 ? "good" : "bad"}>{m.status}</StatusPill>
          )}
          {m.transport && <Badge>{m.transport}</Badge>}
          {m.duration_ms !== undefined && <Badge>{m.duration_ms}ms</Badge>}
          {!known && <Badge title="no dedicated widget — rendered as JSON">generic</Badge>}
        </div>

        <div style={{display: "flex", gap: 4, alignItems: "center"}}>
          <ExportMenu tool={props.tool} payload={props.payload} />
          {known && (
            <>
              <ToggleButton active={!raw} onClick={() => setRaw(false)}>widget</ToggleButton>
              <ToggleButton active={raw}  onClick={() => setRaw(true)}>{"{ } raw"}</ToggleButton>
            </>
          )}
        </div>
      </div>

      {raw || !known
        ? <JsonView data={props.payload} height={500} />
        : <ToolWidget tool={props.tool} payload={props.payload} />}
    </div>
  );
}

function ToggleButton(props: {active: boolean; onClick: () => void; children: ReactNode}) {
  return (
    <button
      onClick={props.onClick}
      style={{
        padding: "3px 10px",
        fontSize: 11,
        border: `1px solid ${props.active ? FG.rowSelectedBorder : FG.rowDefaultBorder}`,
        background: props.active ? FG.rowSelectedBg : "transparent",
        color: props.active ? FG.titleColor : FG.mutedColor,
        borderRadius: 6,
        cursor: "pointer",
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
      }}
    >{props.children}</button>
  );
}

/**
 * Export menu — appears on every ToolResultPanel. Copy as JSON/Markdown,
 * download as JSON/Markdown/CSV. CSV is only offered when the payload
 * has a detectable array-of-objects (most of our read tools do).
 */
function ExportMenu({tool, payload}: {tool: string; payload: any}) {
  const [open, setOpen] = useState(false);
  const hasTable = !!detectTableArray(payload);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  function wrap(fn: () => void): () => void {
    return () => { fn(); setOpen(false); };
  }

  const jsonText = JSON.stringify(payload, null, 2);
  const mdText = toMarkdown(tool, payload);
  const csvText = hasTable ? toCsv(payload) : null;

  return (
    <div style={{position: "relative"}}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Copy or download this result"
        style={{
          padding: "3px 10px",
          fontSize: 11,
          border: `1px solid ${FG.rowDefaultBorder}`,
          background: open ? FG.rowSelectedBg : "transparent",
          color: FG.mutedColor,
          borderRadius: 6,
          cursor: "pointer",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
        }}
      >↗ export</button>
      {open && (
        <>
          {/* click-outside catcher */}
          <div
            onClick={() => setOpen(false)}
            style={{position: "fixed", inset: 0, zIndex: 40}}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              zIndex: 41,
              minWidth: 200,
              background: FG.containerBg,
              border: `1px solid ${FG.containerBorder}`,
              borderRadius: 8,
              boxShadow: FG.containerShadow,
              padding: 4,
            }}
          >
            <ExportItem onClick={wrap(() => copyToClipboard(jsonText, "JSON copied"))}>Copy as JSON</ExportItem>
            <ExportItem onClick={wrap(() => copyToClipboard(mdText, "Markdown copied"))}>Copy as Markdown</ExportItem>
            <div style={{height: 1, background: FG.divider, margin: "4px 2px"}} />
            <ExportItem onClick={wrap(() => downloadFile(jsonText, `${tool}-${stamp}.json`, "application/json"))}>Download .json</ExportItem>
            <ExportItem onClick={wrap(() => downloadFile(mdText, `${tool}-${stamp}.md`, "text/markdown"))}>Download .md</ExportItem>
            {csvText && (
              <ExportItem onClick={wrap(() => downloadFile(csvText, `${tool}-${stamp}.csv`, "text/csv"))}>Download .csv</ExportItem>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ExportItem({onClick, children}: {onClick: () => void; children: ReactNode}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "6px 10px",
        fontSize: 12,
        color: FG.bodyColor,
        background: "transparent",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
        transition: FG.transition,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = FG.rowHoverBg)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >{children}</button>
  );
}
