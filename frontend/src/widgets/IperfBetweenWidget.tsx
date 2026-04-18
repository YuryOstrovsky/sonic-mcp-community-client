/**
 * Widget for iperf_between — throughput card with install-hint state.
 */

import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {KvGrid, Section} from "./common";

function fmtBps(bps: number | null | undefined): string {
  if (bps == null) return "—";
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(2)} Kbps`;
  return `${bps} bps`;
}

export function IperfBetweenWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const status = s.status;

  if (status === "iperf3_not_installed") {
    const missing: string[] = s.missing_on ?? [];
    return (
      <div>
        <div style={{
          background: FG.warningBg, border: `1px solid ${FG.warningBorder}`,
          borderRadius: 10, padding: "12px 16px", marginBottom: 10,
        }}>
          <StatusPill tone="warn">iperf3 not installed</StatusPill>
          <div style={{marginTop: 8, fontSize: 13, color: FG.bodyColor}}>
            Missing on: {missing.map(displayName).join(", ")} ({missing.join(", ")})
          </div>
        </div>
        <Section title="Install hint">
          <pre style={{
            background: "var(--bg0)", border: `1px solid ${FG.divider}`,
            borderRadius: 8, padding: 12, fontFamily: "ui-monospace, monospace",
            fontSize: 12, color: FG.bodyColor, margin: 0,
          }}>{s.install_hint}</pre>
        </Section>
        <div style={{marginTop: 4}}><Badge>transport: ssh</Badge></div>
      </div>
    );
  }

  if (status !== "ok") {
    return (
      <div>
        <div style={{background: FG.errorBg, border: `1px solid ${FG.errorBorder}`, borderRadius: 10, padding: 12, marginBottom: 10}}>
          <StatusPill tone="bad">{status ?? "failed"}</StatusPill>
          <div style={{marginTop: 8, fontSize: 13, color: FG.bodyColor, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap"}}>
            {s.error ?? "iperf3 test failed — see raw output"}
          </div>
        </div>
      </div>
    );
  }

  const rx = s.bps_received, tx = s.bps_sent;
  return (
    <div>
      <div style={{
        background: "var(--bg0)", border: `1px solid ${FG.divider}`,
        borderRadius: 10, padding: "14px 16px", marginBottom: 14,
        display: "flex", gap: 24, flexWrap: "wrap",
      }}>
        <div style={{flex: "1 1 200px"}}>
          <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>Sent</div>
          <div style={{fontSize: 22, fontWeight: 700, color: FG.headingColor, marginTop: 4, fontFamily: "ui-monospace, monospace"}}>
            {fmtBps(tx)}
          </div>
          <div style={{fontSize: 11, color: FG.mutedColor}}>retransmits: {s.retransmits ?? "—"}</div>
        </div>
        <div style={{flex: "1 1 200px"}}>
          <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>Received</div>
          <div style={{fontSize: 22, fontWeight: 700, color: FG.headingColor, marginTop: 4, fontFamily: "ui-monospace, monospace"}}>
            {fmtBps(rx)}
          </div>
          <div style={{fontSize: 11, color: FG.mutedColor}}>
            {s.from ? displayName(s.from) : "—"} → {s.to ?? "—"}
          </div>
        </div>
        <div style={{flex: "1 1 140px"}}>
          <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>Streams</div>
          <div style={{fontSize: 22, fontWeight: 700, color: FG.headingColor, marginTop: 4}}>{s.stream_count ?? s.parallel ?? 1}</div>
          <div style={{fontSize: 11, color: FG.mutedColor}}>{s.duration_s}s test</div>
        </div>
      </div>

      <Section title="Details">
        <KvGrid columns={3} rows={[
          {label: "From", value: s.from, mono: true},
          {label: "To", value: s.to, mono: true},
          {label: "Port", value: s.port},
          {label: "Parallel streams", value: s.parallel},
          {label: "Reverse mode", value: String(s.reverse ?? false)},
          {label: "Bytes sent", value: s.bytes_sent},
          {label: "Bytes received", value: s.bytes_received},
          {label: "CPU (source)", value: s.cpu_source_pct != null ? `${s.cpu_source_pct.toFixed(1)}%` : "—"},
          {label: "CPU (target)", value: s.cpu_target_pct != null ? `${s.cpu_target_pct.toFixed(1)}%` : "—"},
        ]} />
      </Section>

      <div style={{marginTop: 4}}><Badge>transport: ssh</Badge></div>
    </div>
  );
}
