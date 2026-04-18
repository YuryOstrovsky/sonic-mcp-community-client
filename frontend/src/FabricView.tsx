/**
 * Fabric view — renders get_fabric_topology as a reactflow graph.
 *
 * One node per inventory switch, one edge per discovered BGP adjacency
 * (and optionally LLDP). Edge colour reflects link health:
 *   established   → green
 *   broken        → red
 *   (LLDP, info)  → blue
 *
 * Click a node → side panel shows its system info, ASN, router-id,
 * list of outgoing BGP edges with state.
 */

import {useCallback, useEffect, useMemo, useState} from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "reactflow";
import "reactflow/dist/style.css";
import {AlertTriangle, Loader2, RefreshCw} from "lucide-react";
import {ErrorBanner} from "./shared";
import {ApiError, invoke} from "./lib/api";

type TopologyNode = {
  id: string;
  mgmt_ip: string;
  display_name: string;
  reachable: boolean;
  version?: string | null;
  platform?: string | null;
  hwsku?: string | null;
  asn?: number | string | null;
  router_id?: string | null;
};

type TopologyEdge = {
  source: string;
  target: string | null;
  target_local_if?: string | null;
  kind: "bgp" | "lldp";
  source_peer_ip?: string;
  source_local_asn?: number | string | null;
  target_remote_asn?: number | string | null;
  established?: boolean | null;
  state?: string;
  source_local_if?: string | null;
  neighbor_system_name?: string | null;
};

type Topology = {
  summary: Record<string, number | string>;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  unmatched_peers: TopologyEdge[];
};

// ─── Layout helpers ────────────────────────────────────────────

/**
 * Circular layout with decent spacing. For ≤2 nodes we fall back to a
 * horizontal line, which is prettier for the default 2-switch lab.
 */
function positionNodes(nodes: TopologyNode[]): Record<string, {x: number; y: number}> {
  const positions: Record<string, {x: number; y: number}> = {};
  const n = nodes.length;
  if (n === 0) return positions;
  if (n <= 2) {
    nodes.forEach((node, i) => {
      positions[node.id] = {x: 80 + i * 360, y: 160};
    });
    return positions;
  }
  const r = Math.max(220, 60 * n);
  nodes.forEach((node, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    positions[node.id] = {
      x: 400 + r * Math.cos(angle),
      y: 240 + r * Math.sin(angle),
    };
  });
  return positions;
}

// ─── Component ─────────────────────────────────────────────────

export function FabricView(props: {refreshKey?: number}) {
  const [topo, setTopo] = useState<Topology | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [includeLldp, setIncludeLldp] = useState(true);
  const [selected, setSelected] = useState<TopologyNode | null>(null);

  async function fetchTopology() {
    setLoading(true);
    setErr(null);
    try {
      const res = await invoke("get_fabric_topology", {include_lldp: includeLldp});
      setTopo((res?.result?.payload as Topology) ?? null);
    } catch (e: any) {
      setErr(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTopology();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeLldp, props.refreshKey]);

  const {rfNodes, rfEdges} = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    if (!topo) return {rfNodes: nodes, rfEdges: edges};

    const positions = positionNodes(topo.nodes);
    for (const n of topo.nodes) {
      nodes.push({
        id: n.id,
        type: "default",
        position: positions[n.id] ?? {x: 0, y: 0},
        data: {
          label: (
            <div style={{textAlign: "center", padding: 6}}>
              <div style={{fontSize: 14, fontWeight: 700, color: "#f3f4f6"}}>{n.display_name}</div>
              <div style={{fontSize: 10, color: "#9ca3af", fontFamily: "ui-monospace, monospace"}}>
                {n.mgmt_ip}
              </div>
              {n.asn != null && (
                <div style={{fontSize: 10, color: "#93c5fd", marginTop: 4}}>
                  AS {n.asn}
                </div>
              )}
            </div>
          ),
        },
        style: {
          width: 160,
          padding: 6,
          background: n.reachable ? "#1a2332" : "#3f1820",
          border: `1px solid ${n.reachable ? "rgba(255,255,255,0.14)" : "rgba(239,68,68,0.4)"}`,
          borderRadius: 10,
          color: "#e5e7eb",
        },
      });
    }

    // Dedupe edges: if both ends exist in the fabric we'll see the same
    // adjacency from both sides. Collapse to a single edge per unordered
    // pair, preferring the "established" verdict if either side confirms it.
    const seen = new Map<string, Edge>();
    for (const e of topo.edges) {
      if (!e.target) continue;  // orphans handled separately
      const key = [e.source, e.target].sort().join("|") + ":" + e.kind;
      const color = e.kind === "lldp"
        ? "#3b82f6"
        : e.established
        ? "#22c55e"
        : "#ef4444";
      const label =
        e.kind === "bgp"
          ? `BGP ${e.source_local_asn ?? "?"} ↔ ${e.target_remote_asn ?? "?"}`
          : `LLDP`;
      const existing = seen.get(key);
      if (existing) {
        // Prefer "established" if either direction reports it.
        if (e.established && existing.style?.stroke !== "#22c55e") {
          existing.style = {...existing.style, stroke: "#22c55e"};
          existing.markerEnd = {type: MarkerType.ArrowClosed, color: "#22c55e"};
        }
        continue;
      }
      seen.set(key, {
        id: key,
        source: e.source,
        target: e.target,
        label,
        labelStyle: {fill: "#d1d5db", fontSize: 11, fontFamily: "ui-monospace, monospace"},
        labelBgStyle: {fill: "#0d1220", fillOpacity: 0.9},
        labelBgPadding: [4, 6],
        labelBgBorderRadius: 4,
        style: {stroke: color, strokeWidth: 2},
        markerEnd: {type: MarkerType.ArrowClosed, color},
        animated: e.kind === "bgp" && !e.established,
      });
    }
    return {rfNodes: nodes, rfEdges: Array.from(seen.values())};
  }, [topo]);

  const onNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    const full = topo?.nodes.find((n) => n.id === node.id) ?? null;
    setSelected(full);
  }, [topo]);

  const summary = topo?.summary ?? {};

  return (
    <div className="flex h-[calc(100vh-112px)] min-h-[500px] flex-col">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Fabric</h1>
          <p className="mt-2 text-sm text-gray-400">
            Topology built from BGP peers + interface IPs across the whole inventory.
            Green edges = established, red = down, blue = LLDP.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={includeLldp}
              onChange={(e) => setIncludeLldp(e.target.checked)}
              className="h-4 w-4 accent-blue-500"
            />
            include LLDP
          </label>
          <button
            onClick={fetchTopology}
            disabled={loading}
            title="Re-run get_fabric_topology"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-gray-300 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <MetricChip label="nodes" value={summary.node_count} />
        <MetricChip label="bgp edges" value={summary.bgp_edge_count} />
        <MetricChip label="lldp edges" value={summary.lldp_edge_count} />
        {Number(summary.orphan_peer_count || 0) > 0 && (
          <MetricChip label="orphan peers" value={summary.orphan_peer_count} tone="warn" />
        )}
      </div>

      {err && <div className="mb-3"><ErrorBanner>{err}</ErrorBanner></div>}

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Graph canvas */}
        <div className="relative flex-1 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d1220]">
          {loading && !topo && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d1220]/80 text-gray-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              fanning out to the fabric…
            </div>
          )}
          {topo && topo.nodes.length === 0 && !loading ? (
            <div className="flex h-full items-center justify-center text-gray-500">
              No switches in inventory.
            </div>
          ) : (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              onNodeClick={onNodeClick}
              fitView
              minZoom={0.2}
              maxZoom={2}
              proOptions={{hideAttribution: true}}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
              panOnDrag
            >
              <Background color="#1f2937" gap={22} />
              <Controls
                showInteractive={false}
                style={{background: "#1a2332", border: "1px solid rgba(255,255,255,0.08)"}}
              />
            </ReactFlow>
          )}
        </div>

        {/* Detail panel */}
        <aside className="flex w-80 flex-shrink-0 flex-col gap-3 overflow-y-auto">
          {selected ? (
            <NodeDetail node={selected} topology={topo} />
          ) : (
            <div className="rounded-lg border border-white/[0.08] bg-[#1a2332] p-4 text-sm text-gray-400">
              Click a switch node to see its system info and outgoing adjacencies.
            </div>
          )}

          {topo && topo.unmatched_peers.length > 0 && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-yellow-200">
                <AlertTriangle className="h-4 w-4" />
                Orphan peers ({topo.unmatched_peers.length})
              </div>
              <p className="mb-2 text-xs text-yellow-200/70">
                Configured BGP neighbours whose IP doesn't belong to any inventory switch.
              </p>
              <div className="space-y-1 font-mono text-xs">
                {topo.unmatched_peers.slice(0, 10).map((o, i) => (
                  <div key={i} className="text-yellow-100/80">
                    {o.source} → {o.source_peer_ip}
                    {o.target_remote_asn != null && (
                      <span className="text-yellow-200/60"> (AS {o.target_remote_asn})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────

function MetricChip({label, value, tone = "neutral"}: {
  label: string;
  value: number | string | undefined;
  tone?: "neutral" | "warn";
}) {
  const cls = tone === "warn"
    ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-200"
    : "border-white/10 bg-white/[0.04] text-gray-300";
  return (
    <span className={`rounded border px-2 py-1 ${cls}`}>
      <span className="uppercase tracking-wider text-[10px] opacity-60 mr-1">{label}</span>
      <span className="font-mono">{value ?? "—"}</span>
    </span>
  );
}

function NodeDetail({node, topology}: {node: TopologyNode; topology: Topology | null}) {
  const outgoing = (topology?.edges ?? []).filter((e) => e.source === node.id);
  return (
    <div className="rounded-lg border border-white/[0.08] bg-[#1a2332] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-gray-100">{node.display_name}</h3>
        <span className={`rounded px-2 py-0.5 text-xs ${node.reachable ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>
          {node.reachable ? "reachable" : "unreachable"}
        </span>
      </div>
      <div className="space-y-1 text-xs text-gray-300">
        <DetailRow label="MGMT IP" value={node.mgmt_ip} mono />
        {node.asn != null && <DetailRow label="ASN" value={String(node.asn)} />}
        {node.router_id && <DetailRow label="ROUTER ID" value={node.router_id} mono />}
        {node.hwsku && <DetailRow label="HWSKU" value={node.hwsku} />}
        {node.platform && <DetailRow label="PLATFORM" value={node.platform} />}
        {node.version && <DetailRow label="VERSION" value={node.version} mono />}
      </div>

      {outgoing.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-wider text-gray-500">
            Adjacencies ({outgoing.length})
          </div>
          <div className="space-y-2 text-xs">
            {outgoing.map((e, i) => (
              <div key={i} className="rounded border border-white/[0.06] bg-[#0d1220] p-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono">
                    {e.kind === "bgp" ? e.source_peer_ip : e.source_local_if}
                  </span>
                  {e.kind === "bgp" && (
                    <span className={`rounded px-1.5 text-[10px] ${e.established ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>
                      {e.state ?? (e.established ? "ESTABLISHED" : "DOWN")}
                    </span>
                  )}
                  {e.kind === "lldp" && (
                    <span className="rounded bg-blue-500/10 px-1.5 text-[10px] text-blue-300">LLDP</span>
                  )}
                </div>
                <div className="mt-1 text-[10px] text-gray-500">
                  → {e.target ?? "(orphan)"}
                  {e.target_local_if && ` on ${e.target_local_if}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({label, value, mono}: {label: string; value: string; mono?: boolean}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="min-w-[80px] text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      <span className={mono ? "font-mono text-gray-200" : "text-gray-200"}>{value}</span>
    </div>
  );
}
