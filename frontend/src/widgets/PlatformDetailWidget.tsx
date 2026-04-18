/**
 * Widget for get_platform_detail — combined hardware health view.
 * Payload: { summary: {platform, hwsku, asic, asic_count, serial_number, model_number,
 *                      hardware_revision, virtual_platform, source},
 *            fans: {count, note, items}, temperatures: {count, note, items}, psus: {count, note, items} }
 */

import {FG} from "../lib/figmaStyles";
import {Badge, StatusPill} from "../shared";
import {KvGrid, Section, SummaryStrip} from "./common";

function SensorSection({title, block}: {title: string; block: {count: number; note?: string | null; items: any[]}}) {
  if (block.note) {
    return (
      <Section title={title}>
        <div style={{
          background: FG.subtleBg,
          border: `1px dashed ${FG.subtleBorder}`,
          borderRadius: 8,
          padding: "10px 14px",
          color: FG.mutedColor,
          fontSize: 13,
          fontStyle: "italic",
        }}>
          {block.note}
        </div>
      </Section>
    );
  }
  if (!block.items || block.items.length === 0) {
    return (
      <Section title={title}>
        <div style={{color: FG.dimColor, fontSize: 13, padding: "8px 0"}}>
          No {title.toLowerCase()} reported.
        </div>
      </Section>
    );
  }
  // Generic tabulate rendering: show whatever fields exist on each item.
  const keys = Array.from(
    new Set(block.items.flatMap((it) => Object.keys(it)))
  );
  return (
    <Section title={title}>
      <div style={{
        overflow: "auto",
        border: `1px solid ${FG.divider}`,
        borderRadius: 8,
      }}>
        <table style={{width: "100%", borderCollapse: "collapse", fontSize: 12}}>
          <thead>
            <tr>
              {keys.map((k) => (
                <th key={k} style={{
                  textAlign: "left",
                  padding: "6px 10px",
                  borderBottom: `1px solid ${FG.containerBorder}`,
                  color: FG.mutedColor,
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  background: FG.containerBg,
                }}>{k.replace(/_/g, " ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.items.map((it, i) => (
              <tr key={i} style={{background: i % 2 ? "transparent" : FG.subtleBg}}>
                {keys.map((k) => (
                  <td key={k} style={{
                    padding: "6px 10px",
                    borderBottom: `1px solid ${FG.divider}`,
                    color: FG.bodyColor,
                    fontFamily: "ui-monospace, monospace",
                  }}>{it[k] ?? "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function PlatformDetailWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const fans = payload?.fans ?? {count: 0, note: null, items: []};
  const temps = payload?.temperatures ?? {count: 0, note: null, items: []};
  const psus = payload?.psus ?? {count: 0, note: null, items: []};

  return (
    <div>
      {s.virtual_platform && (
        <div style={{
          background: FG.infoBg,
          border: `1px solid ${FG.infoBorder}`,
          borderRadius: 10,
          padding: "10px 14px",
          marginBottom: 12,
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}>
          <span style={{color: FG.infoBlue, fontSize: 16}}>ⓘ</span>
          <div style={{color: FG.bodyColor, fontSize: 13}}>
            Virtual platform — hardware sensors (fans, temperatures, PSUs) are not present.
            These blocks will populate on real hardware.
          </div>
        </div>
      )}

      <SummaryStrip
        items={[
          {label: "HW SKU",  value: s.hwsku ?? "—",         tone: "info"},
          {label: "Platform", value: s.platform ?? "—",     tone: "neutral"},
          {label: "ASIC",    value: `${s.asic ?? "?"}×${s.asic_count ?? 1}`, tone: "neutral"},
          {label: "Fans",    value: fans.count,  tone: fans.note ? "neutral" : (fans.count > 0 ? "good" : "neutral")},
          {label: "Temps",   value: temps.count, tone: temps.note ? "neutral" : (temps.count > 0 ? "good" : "neutral")},
          {label: "PSUs",    value: psus.count,  tone: psus.note ? "neutral" : (psus.count > 0 ? "good" : "neutral")},
        ]}
      />

      <Section title="Identity">
        <KvGrid columns={3} rows={[
          {label: "Serial",   value: s.serial_number ?? "—"},
          {label: "Model",    value: s.model_number ?? "—"},
          {label: "Revision", value: s.hardware_revision ?? "—"},
        ]} />
      </Section>

      <SensorSection title="Fans"         block={fans} />
      <SensorSection title="Temperatures" block={temps} />
      <SensorSection title="PSUs"         block={psus} />

      <div style={{marginTop: 4, display: "flex", gap: 6}}>
        <StatusPill tone="info">transport: ssh</StatusPill>
        <Badge>{s.source}</Badge>
      </div>
    </div>
  );
}
