/**
 * Widget for validate_fabric_vs_intent — drift report per switch.
 */

import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {Section, SummaryStrip} from "./common";

type DriftItem = {
  kind: string;
  expected: string;
  observed: string;
  detail: string;
};
type SwitchReport = {
  switch_ip: string;
  intent_hostname?: string | null;
  reachable: boolean;
  drift_count: number;
  drift: DriftItem[];
};

export function FabricIntentWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const switches: SwitchReport[] = payload?.switches ?? [];
  const example = payload?.example_intent;

  // Intent file missing — show a friendly onboarding panel.
  if (!s.intent_loaded) {
    return (
      <div>
        <div style={{
          background: FG.warningBg,
          border: `1px solid ${FG.warningBorder}`,
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 14,
        }}>
          <StatusPill tone="warn">no intent file</StatusPill>
          <div style={{marginTop: 8, fontSize: 13, color: FG.bodyColor}}>
            {s.note}
          </div>
          <div style={{marginTop: 6, fontSize: 12, color: FG.mutedColor, fontFamily: "ui-monospace, monospace"}}>
            expected path: {s.intent_path}
          </div>
        </div>
        {example && (
          <Section title="Example intent file">
            <pre style={{
              background: "var(--bg0)",
              border: `1px solid ${FG.divider}`,
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              fontFamily: "ui-monospace, monospace",
              color: FG.bodyColor,
              margin: 0,
              overflow: "auto",
            }}>{JSON.stringify(example, null, 2)}</pre>
          </Section>
        )}
        <div style={{marginTop: 4}}><Badge>transport: fanout read</Badge></div>
      </div>
    );
  }

  const compliant = !!s.compliant;
  return (
    <div>
      <div style={{
        background: compliant ? FG.successBg : FG.warningBg,
        border: `1px solid ${compliant ? FG.successBorder : FG.warningBorder}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <StatusPill tone={compliant ? "good" : "warn"}>
          {compliant ? "fabric matches intent" : "drift detected"}
        </StatusPill>
        <div style={{fontSize: 13, color: FG.bodyColor}}>
          {compliant
            ? `All ${s.switch_count} switch${s.switch_count === 1 ? "" : "es"} comply with intent.`
            : `${s.drift_count} drift item${s.drift_count === 1 ? "" : "s"} across ${s.switch_count} switch${s.switch_count === 1 ? "" : "es"}.`}
        </div>
        <div style={{fontSize: 11, color: FG.mutedColor, fontFamily: "ui-monospace, monospace", marginLeft: "auto"}}>
          {s.intent_path}
        </div>
      </div>

      <SummaryStrip items={[
        {label: "Switches", value: s.switch_count ?? 0},
        {label: "Drift",    value: s.drift_count  ?? 0, tone: (s.drift_count ?? 0) > 0 ? "warn" : "good"},
      ]} />

      {switches.map((sw) => (
        <Section
          key={sw.switch_ip}
          title={`${displayName(sw.switch_ip)} (${sw.switch_ip})`}
          right={sw.drift_count === 0 ? <StatusPill tone="good">compliant</StatusPill> : <StatusPill tone="warn">{sw.drift_count} drift</StatusPill>}
        >
          {sw.drift.length === 0 ? (
            <div style={{fontSize: 12, color: FG.mutedColor}}>No drift.</div>
          ) : (
            <div style={{
              border: `1px solid ${FG.divider}`,
              borderRadius: 8,
              overflow: "hidden",
              background: "var(--bg0)",
            }}>
              <table style={{width: "100%", borderCollapse: "collapse", fontSize: 12.5, color: FG.bodyColor}}>
                <thead>
                  <tr>
                    <th style={th}>Kind</th>
                    <th style={th}>Expected</th>
                    <th style={th}>Observed</th>
                    <th style={th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {sw.drift.map((d, i) => (
                    <tr key={i} style={{borderTop: `1px solid ${FG.divider}`}}>
                      <td style={{...td, color: FG.warningYellow}}>{d.kind}</td>
                      <td style={{...td, fontFamily: "ui-monospace, monospace"}}>{d.expected}</td>
                      <td style={{...td, fontFamily: "ui-monospace, monospace"}}>{d.observed}</td>
                      <td style={{...td, color: FG.mutedColor, fontSize: 11}}>{d.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ))}

      <div style={{marginTop: 4}}><Badge>transport: fanout read</Badge></div>
    </div>
  );
}

const th: React.CSSProperties = {
  background: FG.containerBg, color: FG.mutedColor, textAlign: "left",
  padding: "8px 12px", fontSize: 11, fontWeight: 600,
  textTransform: "uppercase", letterSpacing: 0.8,
};
const td: React.CSSProperties = {padding: "8px 12px"};
