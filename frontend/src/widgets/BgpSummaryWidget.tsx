/**
 * Widget for get_bgp_summary — IPv4/IPv6 peer summary.
 * Payload: { summary: {totals: {ipv4_peers, ipv4_established, ipv6_peers, ipv6_established}},
 *            ipv4: {router_id, as, vrf, peer_count, established_count, peers: [...]},
 *            ipv6: {...same...} }
 */

import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {type Column, KvGrid, Section, SummaryStrip, Table, fmtNum} from "./common";
import {RowActionsMenu, type RowAction} from "./RowActions";

type Peer = {
  peer: string;
  remote_as: any;
  local_as?: any;
  state: string;
  peer_state?: string;
  established: boolean;
  uptime?: string;
  msg_rcvd: any;
  msg_sent: any;
  prefix_rcvd: any;
  prefix_sent: any;
  connections_established: any;
  connections_dropped: any;
  description?: string;
};

function PeerTable({peers, switchAlias}: {peers: Peer[]; switchAlias: string}) {
  function actionsFor(p: Peer): RowAction[] {
    return [
      {
        label: p.established ? "Shut this peer (admin down)" : "Unshut this peer (admin up)",
        tone: p.established ? "warn" : "default",
        prompt: () => p.established
          ? `shutdown bgp peer ${p.peer} on ${switchAlias}`
          : `no shut bgp peer ${p.peer} on ${switchAlias}`,
      },
      {
        label: "Force shut",
        tone: "warn",
        prompt: () => `shutdown bgp peer ${p.peer} on ${switchAlias}`,
      },
      {
        label: "Force unshut",
        prompt: () => `no shut bgp peer ${p.peer} on ${switchAlias}`,
      },
    ];
  }

  const columns: Column<Peer>[] = [
    {key: "peer", label: "Peer", mono: true, width: "150px", render: (p) => <span style={{fontWeight: 600}}>{p.peer}</span>},
    {key: "state", label: "State", width: "110px", render: (p) => (
      <StatusPill tone={p.established ? "good" : p.state === "Active" ? "warn" : "bad"}>
        {p.state}
      </StatusPill>
    )},
    {key: "remote_as", label: "Remote AS", width: "90px", align: "right", mono: true, render: (p) => fmtNum(p.remote_as)},
    {key: "uptime", label: "Uptime", width: "100px", mono: true, render: (p) => p.uptime || "—"},
    {key: "rx", label: "Rx", width: "70px", align: "right", mono: true, render: (p) => fmtNum(p.prefix_rcvd)},
    {key: "tx", label: "Tx", width: "70px", align: "right", mono: true, render: (p) => fmtNum(p.prefix_sent)},
    {key: "msg", label: "Msgs rcvd/sent", width: "130px", align: "right", mono: true, render: (p) => `${fmtNum(p.msg_rcvd)}/${fmtNum(p.msg_sent)}`},
    {key: "flaps", label: "Up/Down", width: "90px", align: "right", mono: true, render: (p) => `${fmtNum(p.connections_established)}/${fmtNum(p.connections_dropped)}`},
    {key: "desc", label: "Description", render: (p) => p.description || "—"},
    {key: "actions", label: "", width: "32px", render: (p) => <RowActionsMenu actions={actionsFor(p)} />},
  ];

  return (
    <Table
      columns={columns}
      rows={peers}
      getKey={(p) => p.peer}
      filterText={(p) => `${p.peer} ${p.description ?? ""} ${p.remote_as ?? ""}`}
      filterPlaceholder="filter by peer, AS, description…"
      emptyText="No BGP peers."
    />
  );
}

function AfiSection({title, afi, switchAlias}: {title: string; afi: any; switchAlias: string}) {
  if (!afi || (!afi.router_id && !afi.peers?.length)) return null;
  const peers: Peer[] = afi.peers ?? [];
  const est = afi.established_count ?? 0;
  const total = afi.peer_count ?? peers.length;
  return (
    <Section
      title={title}
      right={<span style={{display: "flex", gap: 6}}>
        <StatusPill tone={est > 0 ? "good" : total > 0 ? "warn" : "neutral"}>
          {est}/{total} established
        </StatusPill>
      </span>}
    >
      <KvGrid columns={3} rows={[
        {label: "Router ID", value: afi.router_id, mono: true},
        {label: "Local AS",  value: fmtNum(afi.as),  mono: true},
        {label: "VRF",       value: afi.vrf ?? "default"},
      ]} />
      <div style={{height: 10}} />
      <PeerTable peers={peers} switchAlias={switchAlias} />
    </Section>
  );
}

export function BgpSummaryWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const totals = summary.totals ?? {};
  const ipv4 = payload?.ipv4;
  const ipv6 = payload?.ipv6;
  const switchIp: string | undefined = summary.switch_ip;
  const switchAlias = switchIp ? displayName(switchIp) : "<switch>";

  const hasV6 = ipv6 && (ipv6.peer_count > 0 || ipv6.router_id);

  return (
    <div>
      <SummaryStrip
        items={[
          {label: "v4 peers", value: totals.ipv4_peers ?? 0, tone: "info" as const},
          {label: "v4 established", value: totals.ipv4_established ?? 0, tone: ((totals.ipv4_established ?? 0) > 0 ? "good" : "warn") as "good" | "warn"},
          ...(hasV6 ? [
            {label: "v6 peers", value: totals.ipv6_peers ?? 0, tone: "info" as const},
            {label: "v6 established", value: totals.ipv6_established ?? 0, tone: ((totals.ipv6_established ?? 0) > 0 ? "good" : "warn") as "good" | "warn"},
          ] : []),
          {label: "VRF", value: summary.vrf ?? "default", tone: "neutral" as const},
        ]}
      />
      <AfiSection title="IPv4 Unicast" afi={ipv4} switchAlias={switchAlias} />
      {hasV6 && <AfiSection title="IPv6 Unicast" afi={ipv6} switchAlias={switchAlias} />}
      <div style={{marginTop: 4}}><Badge>{summary.source}</Badge></div>
    </div>
  );
}
