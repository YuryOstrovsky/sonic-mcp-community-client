/**
 * Widget for get_portchannels.
 * Payload: { summary: {count, source}, portchannels: [{no, team_dev, protocol, members: [{port, flag}]}] }
 */

import {FG} from "../lib/figmaStyles";
import {Badge} from "../shared";
import {type Column, Section, SummaryStrip, Table} from "./common";

type Member = {port: string; flag?: string | null};
type Row = {
  no?: string;
  team_dev: string;
  protocol?: string | null;
  members: Member[];
};

function MemberChip({m}: {m: Member}) {
  // Flag legend (from 'show interfaces portchannel'):
  //   A=active, I=inactive, Up/Dw, N/A, S=selected, D=deselected, *=not synced
  const up = m.flag?.includes("A") || m.flag?.includes("Up") || m.flag?.includes("S");
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "1px 6px",
      fontSize: 11,
      borderRadius: 6,
      border: `1px solid ${up ? FG.successBorder : FG.subtleBorder}`,
      background: up ? FG.successBg : FG.subtleBg,
      color: up ? FG.successGreen : FG.bodyColor,
      fontFamily: "ui-monospace, monospace",
    }}>
      {m.port}
      {m.flag && <span style={{fontSize: 10, opacity: 0.7}}>({m.flag})</span>}
    </span>
  );
}

export function PortchannelsWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const rows: Row[] = payload?.portchannels ?? [];

  const totalMembers = rows.reduce((a, r) => a + (r.members?.length ?? 0), 0);

  const columns: Column<Row>[] = [
    {key: "team_dev", label: "Team dev", mono: true, width: "140px", render: (r) => <span style={{fontWeight: 600}}>{r.team_dev}</span>},
    {key: "protocol", label: "Protocol", width: "100px"},
    {key: "members", label: "Members", render: (r) => (
      r.members.length === 0 ? (
        <span style={{color: FG.dimColor}}>no members</span>
      ) : (
        <div style={{display: "flex", flexWrap: "wrap", gap: 4}}>
          {r.members.map((m, i) => <MemberChip key={i} m={m} />)}
        </div>
      )
    )},
  ];

  return (
    <div>
      <SummaryStrip
        items={[
          {label: "Port-channels", value: summary.count ?? rows.length, tone: "info"},
          {label: "Member ports", value: totalMembers, tone: "neutral"},
        ]}
      />
      <Section
        title="Port-channels"
        right={<Badge>{summary.source}</Badge>}
      >
        <Table
          columns={columns}
          rows={rows}
          getKey={(r, i) => `${r.team_dev}-${i}`}
          filterText={(r) => `${r.team_dev} ${r.protocol ?? ""} ${r.members.map((m) => m.port).join(" ")}`}
          filterPlaceholder="filter by team or member…"
          emptyText="No port-channels configured."
        />
      </Section>
    </div>
  );
}
