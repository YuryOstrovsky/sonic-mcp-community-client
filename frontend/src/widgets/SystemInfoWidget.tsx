/**
 * Widget for get_system_info — SONiC build/platform/uptime card.
 * Payload: { summary: {switch_ip, source}, system: {sonic_software_version, platform, hwsku, ...} }
 */

import {FG} from "../lib/figmaStyles";
import {Badge} from "../shared";
import {KvGrid, Section} from "./common";

export function SystemInfoWidget({payload}: {payload: any}) {
  const s = payload?.system ?? {};
  const summary = payload?.summary ?? {};

  return (
    <div>
      <div style={{
        background: "var(--bg0)",
        border: `1px solid ${FG.divider}`,
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 14,
        display: "flex",
        gap: 20,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}>
        <div style={{flex: "1 1 220px"}}>
          <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>SONiC</div>
          <div style={{fontSize: 18, fontWeight: 600, color: FG.titleColor, fontFamily: "ui-monospace, monospace", marginTop: 4, wordBreak: "break-all"}}>
            {s.sonic_software_version ?? "—"}
          </div>
          {s.build_date && (
            <div style={{fontSize: 12, color: FG.mutedColor, marginTop: 2}}>
              built {s.build_date}
              {s.build_commit && <span style={{color: FG.dimColor}}> · commit {s.build_commit}</span>}
            </div>
          )}
        </div>
        <div style={{flex: "1 1 180px"}}>
          <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>Platform</div>
          <div style={{fontSize: 15, fontWeight: 600, color: FG.bodyColor, marginTop: 4}}>
            {s.hwsku ?? "—"}
          </div>
          <div style={{fontSize: 12, color: FG.mutedColor, marginTop: 2, fontFamily: "ui-monospace, monospace"}}>
            {s.platform ?? ""}
            {s.asic && <span> · ASIC {s.asic} ×{s.asic_count ?? 1}</span>}
          </div>
        </div>
        <div style={{flex: "1 1 200px"}}>
          <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>Uptime</div>
          <div style={{fontSize: 13, color: FG.bodyColor, marginTop: 4, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap"}}>
            {s.uptime ?? "—"}
          </div>
          {s.date && <div style={{fontSize: 11, color: FG.mutedColor, marginTop: 2}}>as of {s.date}</div>}
        </div>
      </div>

      <Section title="Details">
        <KvGrid columns={3} rows={[
          {label: "OS version",       value: s.sonic_os_version, mono: true},
          {label: "Distribution",     value: s.distribution},
          {label: "Kernel",           value: s.kernel,           mono: true},
          {label: "Serial number",    value: s.serial_number},
          {label: "Model number",     value: s.model_number},
          {label: "Hardware revision", value: s.hardware_revision},
          {label: "Built by",         value: s.built_by,         mono: true},
          {label: "Switch IP",        value: summary.switch_ip,  mono: true},
          {label: "Source",           value: summary.source,     mono: true},
        ]} />
      </Section>

      <div style={{marginTop: 4}}><Badge>transport: ssh</Badge></div>
    </div>
  );
}
