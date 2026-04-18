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
import {Badge, JsonView, StatusPill} from "../shared";
import {ActivityWidget} from "./ActivityWidget";
import {ArpTableWidget} from "./ArpTableWidget";
import {BgpSummaryWidget} from "./BgpSummaryWidget";
import {HelpWidget} from "./HelpWidget";
import {InterfacesWidget} from "./InterfacesWidget";
import {IpInterfacesWidget} from "./IpInterfacesWidget";
import {LldpWidget} from "./LldpWidget";
import {MultiDeviceWidget, setMultiInnerRenderer} from "./MultiDeviceWidget";
import {MutationResultWidget} from "./MutationResultWidget";
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
  // Mutation result widgets — pre/post diff + mutation_id link
  set_interface_admin_status: (p) => <MutationResultWidget payload={p.payload} />,
  set_interface_mtu:         (p) => <MutationResultWidget payload={p.payload} />,
  set_interface_description: (p) => <MutationResultWidget payload={p.payload} />,
  clear_interface_counters:  (p) => <MutationResultWidget payload={p.payload} />,
  add_vlan:                  (p) => <MutationResultWidget payload={p.payload} />,
  remove_vlan:               (p) => <MutationResultWidget payload={p.payload} />,
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

        {known && (
          <div style={{display: "flex", gap: 4}}>
            <ToggleButton active={!raw} onClick={() => setRaw(false)}>widget</ToggleButton>
            <ToggleButton active={raw}  onClick={() => setRaw(true)}>{"{ } raw"}</ToggleButton>
          </div>
        )}
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
