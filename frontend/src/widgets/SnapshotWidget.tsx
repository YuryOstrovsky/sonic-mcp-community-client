/**
 * Shared widget for save_fabric_snapshot + restore_fabric_snapshot.
 * Both payloads have a similar {summary, by_switch} shape; we
 * render per-switch cards with status + size/details.
 */

import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {Section, SummaryStrip} from "./common";

export function SnapshotWidget({payload, mode}: {payload: any; mode: "save" | "restore"}) {
  const s = payload?.summary ?? {};
  const by_switch: Record<string, any> = payload?.by_switch ?? {};
  const ok = s.error_count === 0 && s.ok_count > 0;

  return (
    <div>
      <div style={{
        background: ok ? FG.successBg : FG.warningBg,
        border: `1px solid ${ok ? FG.successBorder : FG.warningBorder}`,
        borderRadius: 10, padding: "12px 16px", marginBottom: 14,
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        <StatusPill tone={ok ? "good" : "warn"}>
          {mode === "save" ? "snapshot saved" : (s.skip_reload ? "uploaded (no reload)" : "snapshot restored")}
        </StatusPill>
        <span style={{fontFamily: "ui-monospace, monospace", fontSize: 13}}>{s.name}</span>
        <span style={{color: FG.mutedColor, fontSize: 12}}>{s.path}</span>
      </div>

      <SummaryStrip items={[
        {label: "Switches",    value: s.switch_count ?? 0},
        {label: "OK",          value: s.ok_count ?? 0, tone: (s.ok_count ?? 0) > 0 ? "good" : "neutral"},
        {label: "Errors",      value: s.error_count ?? 0, tone: (s.error_count ?? 0) > 0 ? "bad" : "good"},
      ]} />

      <Section title="Per switch">
        <div style={{display: "flex", flexDirection: "column", gap: 8}}>
          {Object.entries(by_switch).map(([ip, entry]: [string, any]) => {
            const tone =
              entry.status === "ok" || entry.status === "reloaded" || entry.status === "uploaded" ? "good" :
              entry.status === "reload_disconnected" ? "warn" :
              "bad";
            return (
              <div key={ip} style={{
                background: "var(--bg0)", border: `1px solid ${FG.divider}`,
                borderRadius: 8, padding: "10px 14px",
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              }}>
                <div style={{flex: "1 1 200px"}}>
                  <div style={{fontSize: 14, fontWeight: 600, color: FG.titleColor}}>{displayName(ip)}</div>
                  <div style={{fontSize: 11, color: FG.mutedColor, fontFamily: "ui-monospace, monospace"}}>{ip}</div>
                </div>
                <StatusPill tone={tone}>{entry.status}</StatusPill>
                {entry.size_bytes && (
                  <span style={{fontSize: 11, color: FG.mutedColor, fontFamily: "ui-monospace, monospace"}}>
                    {entry.size_bytes.toLocaleString()} bytes
                  </span>
                )}
                {entry.reload?.elapsed_s != null && (
                  <span style={{fontSize: 11, color: FG.mutedColor}}>reload: {entry.reload.elapsed_s}s</span>
                )}
                {entry.error && (
                  <div style={{
                    flexBasis: "100%",
                    fontSize: 11, color: FG.errorRed, fontFamily: "ui-monospace, monospace",
                  }}>{entry.error}</div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {s.note && (
        <Section title="Note">
          <div style={{fontSize: 13, color: FG.bodyColor, fontStyle: "italic"}}>{s.note}</div>
        </Section>
      )}

      <div style={{marginTop: 4}}>
        <Badge>transport: ssh {mode === "save" ? "read + local write" : "upload + config reload"}</Badge>
      </div>
    </div>
  );
}
