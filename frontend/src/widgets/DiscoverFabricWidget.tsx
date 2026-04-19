/**
 * Widget for discover_fabric_from_seed.
 *
 * Renders the three lists the tool produces — proposed additions,
 * already-known neighbors, unreachable candidates — and lets the user
 * add a proposal to inventory in one click (via the /api/inventory
 * proxy, same flow the Settings panel uses).
 */

import {useState} from "react";
import {FG} from "../lib/figmaStyles";
import {addInventorySwitch} from "../lib/api";
import {notify} from "../lib/notify";
import {Badge, StatusPill} from "../shared";
import {Section, SummaryStrip} from "./common";

type Proposal = {
  mgmt_ip: string;
  name: string;
  tags: string[];
  discovered_via: string;
  restconf?: boolean;
  ssh?: boolean;
  lldp_system_description?: string;
};

export function DiscoverFabricWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const proposed: Proposal[] = payload?.proposed_additions ?? [];
  const known: Proposal[]    = payload?.already_known ?? [];
  const unreachable: Proposal[] = payload?.unreachable ?? [];
  const [addingAll, setAddingAll] = useState(false);
  const [addedIps, setAddedIps] = useState<Set<string>>(new Set());

  async function addOne(p: Proposal) {
    try {
      await addInventorySwitch({
        name: p.name, mgmt_ip: p.mgmt_ip,
        tags: p.tags ?? ["discovered"],
      });
      setAddedIps((prev) => new Set(prev).add(p.mgmt_ip));
      notify.ok(`added ${p.name} (${p.mgmt_ip}) to inventory`);
    } catch (e: any) {
      notify.err("add failed", e?.message ?? String(e));
    }
  }

  async function addAll() {
    if (proposed.length === 0) return;
    setAddingAll(true);
    let ok = 0, fail = 0;
    for (const p of proposed) {
      if (addedIps.has(p.mgmt_ip)) continue;
      try {
        await addInventorySwitch({
          name: p.name, mgmt_ip: p.mgmt_ip,
          tags: p.tags ?? ["discovered"],
        });
        ok++;
        setAddedIps((prev) => new Set(prev).add(p.mgmt_ip));
      } catch {
        fail++;
      }
    }
    setAddingAll(false);
    if (fail === 0) notify.ok(`added ${ok} switch${ok === 1 ? "" : "es"}`);
    else notify.warn(`added ${ok}, ${fail} failed`, "Check logs or add individually");
  }

  return (
    <div>
      <div style={{
        background: proposed.length ? FG.warningBg : FG.successBg,
        border: `1px solid ${proposed.length ? FG.warningBorder : FG.successBorder}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <StatusPill tone={proposed.length ? "warn" : "good"}>
          {proposed.length ? `${proposed.length} new switch${proposed.length === 1 ? "" : "es"} found` : "no new switches"}
        </StatusPill>
        <span style={{fontSize: 13, color: FG.bodyColor}}>
          seeded from <code style={{fontFamily: "ui-monospace, monospace"}}>{s.seed}</code> ·
          walked {s.hops_walked ?? "?"} hop{s.hops_walked === 1 ? "" : "s"}
        </span>
        {proposed.length > 0 && (
          <button
            onClick={addAll}
            disabled={addingAll || proposed.every((p) => addedIps.has(p.mgmt_ip))}
            style={{
              marginLeft: "auto",
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 500,
              background: FG.btnPrimaryBg,
              color: "#fff",
              border: `1px solid ${FG.btnPrimaryBorder}`,
              borderRadius: 8,
              cursor: addingAll ? "wait" : "pointer",
            }}
          >{addingAll ? "adding…" : `Add all ${proposed.length}`}</button>
        )}
      </div>

      <SummaryStrip items={[
        {label: "Proposed",     value: s.proposed_additions_count ?? 0, tone: (s.proposed_additions_count ?? 0) > 0 ? "warn" : "good"},
        {label: "Already known", value: s.known_count   ?? 0},
        {label: "Unreachable",   value: s.unreachable_count ?? 0, tone: (s.unreachable_count ?? 0) > 0 ? "warn" : "good"},
        {label: "Hops walked",   value: s.hops_walked ?? 0},
      ]} />

      {/* Empty-state hint that's specific to the SONiC VS reality */}
      {proposed.length === 0 && known.length === 0 && unreachable.length === 0 && (
        <div style={{
          padding: 14,
          border: `1px solid ${FG.divider}`,
          borderRadius: 8,
          background: "var(--bg0)",
          fontSize: 13,
          color: FG.mutedColor,
          lineHeight: 1.5,
        }}>
          No LLDP neighbors reported. SONiC VS has a known LLDP-RX issue —
          on real hardware this would typically find the seed's direct
          peers. The seed switch itself may still be TX'ing LLDP frames;
          check <code>get_lldp_neighbors</code> locally on the seed.
        </div>
      )}

      {proposed.length > 0 && (
        <Section title={`Proposed additions (${proposed.length})`}>
          <ProposalTable rows={proposed} mode="proposed" addedIps={addedIps} onAdd={addOne} />
        </Section>
      )}

      {known.length > 0 && (
        <Section title={`Already in inventory (${known.length})`}>
          <ProposalTable rows={known} mode="known" />
        </Section>
      )}

      {unreachable.length > 0 && (
        <Section title={`Unreachable candidates (${unreachable.length})`}>
          <ProposalTable rows={unreachable} mode="unreachable" />
        </Section>
      )}

      <div style={{marginTop: 4}}><Badge>transport: ssh (lldp walk)</Badge></div>
    </div>
  );
}

function ProposalTable({
  rows, mode, addedIps, onAdd,
}: {
  rows: Proposal[];
  mode: "proposed" | "known" | "unreachable";
  addedIps?: Set<string>;
  onAdd?: (p: Proposal) => void;
}) {
  return (
    <div style={{
      border: `1px solid ${FG.divider}`,
      borderRadius: 8,
      overflow: "hidden",
      background: "var(--bg0)",
    }}>
      <table style={{width: "100%", borderCollapse: "collapse", fontSize: 12.5, color: FG.bodyColor}}>
        <thead>
          <tr>
            <th style={th}>Name</th>
            <th style={th}>Mgmt IP</th>
            <th style={th}>Via</th>
            <th style={th}>RESTCONF</th>
            <th style={th}>SSH</th>
            <th style={th}>{mode === "proposed" ? "Action" : "Info"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mgmt_ip} style={{borderTop: `1px solid ${FG.divider}`}}>
              <td style={{...td, fontWeight: 600, color: FG.titleColor}}>{r.name}</td>
              <td style={{...td, fontFamily: "ui-monospace, monospace"}}>{r.mgmt_ip}</td>
              <td style={{...td, fontFamily: "ui-monospace, monospace", color: FG.mutedColor}}>{r.discovered_via}</td>
              <td style={td}>{r.restconf === undefined ? "—" : r.restconf ? <span style={{color: FG.successGreen}}>✓</span> : <span style={{color: FG.errorRed}}>✗</span>}</td>
              <td style={td}>{r.ssh === undefined ? "—" : r.ssh ? <span style={{color: FG.successGreen}}>✓</span> : <span style={{color: FG.errorRed}}>✗</span>}</td>
              <td style={td}>
                {mode === "proposed" && onAdd && (
                  addedIps?.has(r.mgmt_ip)
                    ? <span style={{color: FG.successGreen, fontSize: 11}}>added ✓</span>
                    : <button
                        onClick={() => onAdd(r)}
                        style={{
                          padding: "3px 10px",
                          fontSize: 11,
                          border: `1px solid ${FG.rowDefaultBorder}`,
                          background: "transparent",
                          color: FG.subtitleColor,
                          borderRadius: 6,
                          cursor: "pointer",
                        }}
                      >+ add</button>
                )}
                {mode === "known" && <span style={{color: FG.mutedColor, fontSize: 11}}>in inventory</span>}
                {mode === "unreachable" && <span style={{color: FG.errorRed, fontSize: 11}}>no transport answered</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = {
  background: FG.containerBg, color: FG.mutedColor, textAlign: "left",
  padding: "8px 12px", fontSize: 11, fontWeight: 600,
  textTransform: "uppercase", letterSpacing: 0.8,
};
const td: React.CSSProperties = {padding: "8px 12px"};
