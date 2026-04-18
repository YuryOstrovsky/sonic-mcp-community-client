/**
 * Widget for get_fabric_topology — compact summary inside the AI Console.
 *
 * Shows node count, BGP/LLDP edge counts, and the adjacency table. The
 * full graph lives in the Fabric view — we dispatch the same event we use
 * elsewhere to navigate there.
 */

import {FG} from "../lib/figmaStyles";
import {Badge} from "../shared";
import {type Column, Section, SummaryStrip, Table} from "./common";

export const OPEN_FABRIC_VIEW = "sonic-mcp:open-fabric";

type NodeRow = {
  mgmt_ip: string;
  display_name: string;
  reachable: boolean;
  asn?: number | string | null;
  router_id?: string | null;
  hwsku?: string | null;
};

type EdgeRow = {
  source: string;
  target: string | null;
  kind: string;
  source_peer_ip?: string;
  source_local_asn?: number | string | null;
  target_remote_asn?: number | string | null;
  established?: boolean | null;
  state?: string;
  source_local_if?: string | null;
};

export function FabricTopologyWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const nodes: NodeRow[] = payload?.nodes ?? [];
  const edges: EdgeRow[] = payload?.edges ?? [];
  const orphans: EdgeRow[] = payload?.unmatched_peers ?? [];

  const nodeCols: Column<NodeRow>[] = [
    {key: "display_name", label: "Switch",  width: "22%", render: (r) => <span style={{fontWeight: 600}}>{r.display_name}</span>},
    {key: "mgmt_ip",      label: "Mgmt IP", width: "18%", mono: true, render: (r) => r.mgmt_ip},
    {key: "reachable",    label: "State",   width: "12%", render: (r) => r.reachable ? "reachable" : "unreachable"},
    {key: "asn",          label: "AS",      width: "12%", mono: true, render: (r) => r.asn != null ? String(r.asn) : "—"},
    {key: "router_id",    label: "Router ID", mono: true, render: (r) => r.router_id ?? "—"},
    {key: "hwsku",        label: "HwSKU",   render: (r) => r.hwsku ?? "—"},
  ];

  const edgeCols: Column<EdgeRow>[] = [
    {key: "source",   label: "Source", width: "18%", mono: true},
    {key: "kind",     label: "Kind",   width: "8%",  render: (r) => <Badge>{r.kind}</Badge>},
    {key: "detail",   label: "Detail", render: (r) => (
      r.kind === "bgp"
        ? <span style={{fontFamily: "ui-monospace, monospace"}}>AS {r.source_local_asn ?? "?"} → {r.source_peer_ip} (AS {r.target_remote_asn ?? "?"})</span>
        : <span style={{fontFamily: "ui-monospace, monospace"}}>{r.source_local_if ?? "—"}</span>
    )},
    {key: "target",   label: "Target", width: "16%", mono: true, render: (r) => r.target ?? "(orphan)"},
    {key: "state",    label: "State",  width: "14%", render: (r) => (
      r.kind === "lldp"
        ? <span style={{color: FG.infoBlue}}>LLDP</span>
        : r.established
          ? <span style={{color: FG.successGreen}}>established</span>
          : <span style={{color: FG.errorRed}}>{r.state ?? "down"}</span>
    )},
  ];

  function openFabric() {
    window.dispatchEvent(new CustomEvent(OPEN_FABRIC_VIEW));
  }

  return (
    <div>
      <SummaryStrip items={[
        {label: "Nodes",        value: summary.node_count ?? nodes.length},
        {label: "BGP edges",    value: summary.bgp_edge_count ?? 0},
        {label: "LLDP edges",   value: summary.lldp_edge_count ?? 0},
        {label: "Orphan peers", value: summary.orphan_peer_count ?? 0, tone: (summary.orphan_peer_count ?? 0) > 0 ? "warn" : "neutral"},
      ]} />

      <div style={{display: "flex", justifyContent: "flex-end", marginBottom: 8}}>
        <button
          onClick={openFabric}
          style={{
            padding: "5px 12px",
            fontSize: 12,
            background: "transparent",
            color: FG.subtitleColor,
            border: `1px solid ${FG.btnSecondaryBorder}`,
            borderRadius: 6,
            cursor: "pointer",
            transition: FG.transition,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = FG.btnSecondaryHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >↗ Open in Fabric view</button>
      </div>

      <Section title="Switches">
        <Table
          columns={nodeCols}
          rows={nodes}
          getKey={(r) => r.mgmt_ip}
          emptyText="No switches in inventory."
        />
      </Section>

      <Section title={`Adjacencies (${edges.length})`}>
        <Table
          columns={edgeCols}
          rows={edges}
          getKey={(r, i) => `${r.source}|${r.target ?? "x"}|${r.kind}|${i}`}
          emptyText="No adjacencies discovered."
          filterPlaceholder="filter by source / target / peer…"
          filterText={(r) => [r.source, r.target, r.kind, r.source_peer_ip, r.source_local_if].filter(Boolean).join(" ")}
        />
      </Section>

      {orphans.length > 0 && (
        <Section title={`Orphan peers (${orphans.length})`}>
          <div style={{
            background: "rgba(234,179,8,0.08)",
            border: `1px solid ${FG.warningBorder}`,
            borderRadius: 8,
            padding: 10,
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            color: FG.warningYellow,
          }}>
            {orphans.map((o, i) => (
              <div key={i}>
                {o.source} → {o.source_peer_ip}
                {o.target_remote_asn != null && ` (AS ${o.target_remote_asn})`}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div style={{marginTop: 4}}><Badge>transport: mixed (restconf + ssh fanout)</Badge></div>
    </div>
  );
}
