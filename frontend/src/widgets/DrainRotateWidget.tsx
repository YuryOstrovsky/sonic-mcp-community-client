/**
 * Widget for fabric_drain_rotate — ordered timeline of per-switch rotate steps.
 */

import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {Section, SummaryStrip} from "./common";

type Step = {
  op: string;
  status?: string;
  elapsed_s?: number;
  waited_s?: number;
  reached?: boolean;
  peers?: number;
  changed?: number;
  error?: string;
  health?: Record<string, any>;
};
type SwitchReport = {
  switch_ip: string;
  steps: Step[];
  status?: string;
};

export function DrainRotateWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const perSwitch: SwitchReport[] = payload?.per_switch ?? [];
  const ok = !!s.overall_ok;

  return (
    <div>
      <div style={{
        background: ok ? FG.successBg : FG.warningBg,
        border: `1px solid ${ok ? FG.successBorder : FG.warningBorder}`,
        borderRadius: 10, padding: "12px 16px", marginBottom: 14,
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        <StatusPill tone={ok ? "good" : "warn"}>
          {ok ? "rotate complete" : "rotate had issues"}
        </StatusPill>
        <span style={{fontSize: 13, color: FG.bodyColor}}>
          {s.completed}/{s.target_count} switch{s.target_count === 1 ? "" : "es"} processed
        </span>
      </div>

      <SummaryStrip items={[
        {label: "Target switches", value: s.target_count ?? 0},
        {label: "Completed",       value: s.completed    ?? 0},
        {label: "Drain wait",      value: `${s.wait_after_drain_s ?? "?"}s`},
        {label: "Undrain wait",    value: `${s.wait_after_undrain_s ?? "?"}s`},
      ]} />

      {perSwitch.map((sw) => (
        <Section
          key={sw.switch_ip}
          title={`${displayName(sw.switch_ip)} (${sw.switch_ip})`}
          right={<StatusPill tone={sw.status === "ok" ? "good" : sw.status === "converge_timeout" ? "warn" : "bad"}>
            {sw.status}
          </StatusPill>}
        >
          <div style={{display: "flex", flexDirection: "column", gap: 6}}>
            {sw.steps.map((step, i) => (
              <StepRow key={i} step={step} />
            ))}
          </div>
        </Section>
      ))}

      <div style={{marginTop: 4}}><Badge>transport: ssh orchestration</Badge></div>
    </div>
  );
}

function StepRow({step}: {step: Step}) {
  const ok =
    step.status === "ok" ||
    step.op === "wait_for_established" && step.reached === true;
  const icon = step.op === "drain" ? "↓" : step.op === "undrain" ? "↑" : "⏱";
  const color =
    step.op === "drain" ? FG.warningYellow :
    step.op === "undrain" ? FG.successGreen :
    FG.mutedColor;

  return (
    <div style={{
      background: "var(--bg0)", border: `1px solid ${FG.divider}`,
      borderRadius: 8, padding: "8px 12px",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    }}>
      <span style={{color, fontSize: 16, width: 18, textAlign: "center"}}>{icon}</span>
      <span style={{fontWeight: 600, color: FG.bodyColor, minWidth: 140}}>{step.op}</span>
      <StatusPill tone={ok ? "good" : step.status === "converge_timeout" ? "warn" : "bad"}>
        {step.status ?? (step.reached ? "reached" : "timeout")}
      </StatusPill>
      {step.elapsed_s != null && (
        <span style={{fontSize: 11, color: FG.mutedColor, fontFamily: "ui-monospace, monospace"}}>
          {step.elapsed_s}s
        </span>
      )}
      {step.waited_s != null && (
        <span style={{fontSize: 11, color: FG.mutedColor, fontFamily: "ui-monospace, monospace"}}>
          waited {step.waited_s}s
        </span>
      )}
      {step.peers != null && <span style={{fontSize: 11, color: FG.mutedColor}}>peers: {step.peers}</span>}
      {step.changed != null && <span style={{fontSize: 11, color: FG.mutedColor}}>changed: {step.changed}</span>}
      {step.error && (
        <div style={{flexBasis: "100%", fontSize: 11, color: FG.errorRed, fontFamily: "ui-monospace, monospace"}}>
          {step.error}
        </div>
      )}
    </div>
  );
}
