/**
 * Widget for traceroute_between — ordered hop list with RTT per hop.
 */

import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {KvGrid, Section} from "./common";

type Hop = {
  hop: number;
  ips: string[];
  rtt_ms: number[];
  timeout: boolean;
};

export function TracerouteWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const hops: Hop[] = payload?.hops ?? [];
  const reached = !!s.reached;
  const tone: "good" | "warn" | "bad" =
    reached ? "good" :
    hops.length > 0 ? "warn" :
    "bad";
  const verdict =
    reached ? `reached in ${hops.length} hop${hops.length === 1 ? "" : "s"}` :
    hops.length > 0 ? `stopped at hop ${hops.length} (did not reach target)` :
    "no hops returned";

  return (
    <div>
      <div style={{
        background: tone === "good" ? FG.successBg : tone === "warn" ? FG.warningBg : FG.errorBg,
        border: `1px solid ${tone === "good" ? FG.successBorder : tone === "warn" ? FG.warningBorder : FG.errorBorder}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <StatusPill tone={tone}>{verdict}</StatusPill>
        <div style={{fontSize: 12, color: FG.mutedColor, fontFamily: "ui-monospace, monospace"}}>
          {s.from ? displayName(s.from) : "—"} → {s.to ?? "—"}
        </div>
      </div>

      <Section title={`Hops (${hops.length})`}>
        <div style={{
          border: `1px solid ${FG.divider}`,
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--bg0)",
        }}>
          <table style={{width: "100%", borderCollapse: "collapse", fontSize: 12.5, color: FG.bodyColor}}>
            <thead>
              <tr>
                <th style={th}>Hop</th>
                <th style={th}>IPs</th>
                <th style={th}>RTT (ms)</th>
              </tr>
            </thead>
            <tbody>
              {hops.length === 0 ? (
                <tr><td colSpan={3} style={{padding: 12, textAlign: "center", color: FG.mutedColor}}>No hops.</td></tr>
              ) : hops.map((h) => (
                <tr key={h.hop} style={{borderTop: `1px solid ${FG.divider}`}}>
                  <td style={{...td, fontFamily: "ui-monospace, monospace", color: FG.mutedColor, width: 60}}>{h.hop}</td>
                  <td style={td}>
                    {h.timeout ? (
                      <span style={{color: FG.mutedColor, fontFamily: "ui-monospace, monospace"}}>* * *</span>
                    ) : (
                      <span style={{fontFamily: "ui-monospace, monospace"}}>
                        {h.ips.join(", ")}
                      </span>
                    )}
                  </td>
                  <td style={{...td, fontFamily: "ui-monospace, monospace", color: FG.subtitleColor}}>
                    {h.rtt_ms.length > 0 ? h.rtt_ms.map((r) => r.toFixed(2)).join(", ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Details">
        <KvGrid columns={3} rows={[
          {label: "From",     value: s.from,         mono: true},
          {label: "To",       value: s.to,           mono: true},
          {label: "Max hops", value: s.max_hops},
          {label: "Reached",  value: String(s.reached ?? false)},
          {label: "Last hop", value: s.last_hop_ip,  mono: true},
          {label: "Source",   value: s.source,       mono: true},
        ]} />
      </Section>

      <div style={{marginTop: 4}}><Badge>transport: ssh</Badge></div>
    </div>
  );
}

const th: React.CSSProperties = {
  background: FG.containerBg,
  color: FG.mutedColor,
  textAlign: "left",
  padding: "8px 12px",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.8,
};
const td: React.CSSProperties = {padding: "8px 12px"};
