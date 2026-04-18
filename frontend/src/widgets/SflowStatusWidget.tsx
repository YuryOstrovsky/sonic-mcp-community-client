/**
 * Widget for get_sflow_status.
 * Payload: { summary: {enabled, collector_count, interface_count, sample_size, polling_interval, agent_id_ipv4, agent_id_ipv6, source},
 *            config, state, collectors: [{address, port, network_instance}],
 *            interfaces: [{name, enabled, sampling_rate, polling_interval}] }
 */

import {Badge, StatusPill} from "../shared";
import {type Column, KvGrid, Section, SummaryStrip, Table, UpDownPill} from "./common";

type Collector = {address?: string; port?: any; network_instance?: string};
type IfRow = {name?: string; enabled?: any; sampling_rate?: any; polling_interval?: any};

export function SflowStatusWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const collectors: Collector[] = payload?.collectors ?? [];
  const interfaces: IfRow[] = payload?.interfaces ?? [];
  const enabled = !!summary.enabled;

  const collectorCols: Column<Collector>[] = [
    {key: "address", label: "Collector", mono: true, render: (c) => <span style={{fontWeight: 600}}>{c.address ?? "—"}</span>},
    {key: "port", label: "Port", width: "80px", align: "right", mono: true},
    {key: "network_instance", label: "VRF / net-instance", width: "180px"},
  ];

  const ifaceCols: Column<IfRow>[] = [
    {key: "name", label: "Interface", mono: true, width: "140px", render: (r) => <span style={{fontWeight: 600}}>{r.name}</span>},
    {key: "enabled", label: "Sampling", width: "90px", render: (r) => <UpDownPill value={r.enabled ? "UP" : "DOWN"} />},
    {key: "sampling_rate", label: "Rate", width: "100px", align: "right", mono: true, render: (r) => r.sampling_rate ?? "—"},
    {key: "polling_interval", label: "Poll (s)", width: "90px", align: "right", mono: true, render: (r) => r.polling_interval ?? "—"},
  ];

  return (
    <div>
      <SummaryStrip
        items={[
          {label: "sFlow", value: enabled ? "enabled" : "disabled", tone: enabled ? "good" : "neutral"},
          {label: "Collectors", value: summary.collector_count ?? collectors.length, tone: "info"},
          {label: "Interfaces", value: summary.interface_count ?? interfaces.length, tone: "info"},
          {label: "Sample size", value: summary.sample_size ?? "—", tone: "neutral"},
          {label: "Poll (s)", value: summary.polling_interval ?? "—", tone: "neutral"},
        ]}
      />

      <Section title="Agent">
        <KvGrid columns={2} rows={[
          {label: "Agent IPv4", value: summary.agent_id_ipv4, mono: true},
          {label: "Agent IPv6", value: summary.agent_id_ipv6, mono: true},
        ]} />
      </Section>

      <Section title="Collectors" right={<Badge>{collectors.length} configured</Badge>}>
        <Table
          columns={collectorCols}
          rows={collectors}
          getKey={(c, i) => `${c.address ?? ""}-${c.port ?? ""}-${i}`}
          emptyText="No sFlow collectors configured."
          maxHeight={240}
        />
      </Section>

      <Section title="Per-interface sampling" right={<Badge>{interfaces.length} entries</Badge>}>
        <Table
          columns={ifaceCols}
          rows={interfaces}
          getKey={(r) => r.name ?? ""}
          filterText={(r) => r.name ?? ""}
          filterPlaceholder="filter by interface…"
          emptyText="No per-interface sFlow entries."
          maxHeight={320}
        />
      </Section>

      <div style={{marginTop: 4, display: "flex", gap: 6}}>
        <StatusPill tone="info">transport: restconf</StatusPill>
        <Badge>{summary.source}</Badge>
      </div>
    </div>
  );
}
