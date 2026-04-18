/**
 * Widget for compare_fabric_snapshots — per-switch block, each with
 * a collapsible per-table diff.
 */

import {useState} from "react";
import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {SummaryStrip} from "./common";

type FieldDiff = {field: string; left: any; right: any};
type KeyDiff = {key: string; fields: FieldDiff[]};
type TableDiff = {
  name: string;
  left_only: string[];
  right_only: string[];
  differing: KeyDiff[];
  left_count: number;
  right_count: number;
};
type SwitchBlock = {
  switch_ip: string;
  tables: TableDiff[];
  total_diffs: number;
  error?: string;
};

export function SnapshotCompareWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const switches: SwitchBlock[] = payload?.per_switch ?? [];
  const clean = (s.switches_differ ?? 0) === 0;

  return (
    <div>
      <div style={{
        background: clean ? FG.successBg : FG.warningBg,
        border: `1px solid ${clean ? FG.successBorder : FG.warningBorder}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <StatusPill tone={clean ? "good" : "warn"}>
          {clean ? "snapshots match" : "snapshots differ"}
        </StatusPill>
        <div style={{fontSize: 13, color: FG.bodyColor}}>
          <code style={{fontFamily: "ui-monospace, monospace"}}>{s.left}</code>
          <span style={{color: FG.mutedColor}}> ↔ </span>
          <code style={{fontFamily: "ui-monospace, monospace"}}>{s.right}</code>
          {` — ${s.switches_differ ?? 0}/${s.switches_compared ?? 0} switch${(s.switches_compared ?? 0) === 1 ? "" : "es"} differ`}
        </div>
      </div>

      <SummaryStrip items={[
        {label: "Switches compared", value: s.switches_compared ?? 0},
        {label: "Switches differ",   value: s.switches_differ   ?? 0, tone: (s.switches_differ ?? 0) > 0 ? "warn" : "good"},
        {label: "Keys differ",       value: s.total_keys_differ ?? 0, tone: (s.total_keys_differ ?? 0) > 0 ? "warn" : "good"},
        {label: "Tables checked",    value: s.tables_checked    ?? 0},
      ]} />

      {s.left_timestamp && (
        <div style={{fontSize: 11, color: FG.mutedColor, marginBottom: 10, fontFamily: "ui-monospace, monospace"}}>
          {s.left} captured {s.left_timestamp} · {s.right} captured {s.right_timestamp}
        </div>
      )}

      {switches.map((sw) => (
        <SwitchBlockView key={sw.switch_ip} sw={sw} left={s.left} right={s.right} />
      ))}

      <div style={{marginTop: 4}}><Badge>transport: local fs</Badge></div>
    </div>
  );
}

function SwitchBlockView({sw, left, right}: {sw: SwitchBlock; left: string; right: string}) {
  const [open, setOpen] = useState(sw.total_diffs > 0);

  if (sw.error) {
    return (
      <div style={{
        background: "var(--bg0)",
        border: `1px solid ${FG.errorBorder}`,
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 10,
        color: FG.errorRed,
        fontFamily: "ui-monospace, monospace",
        fontSize: 12,
      }}>
        {displayName(sw.switch_ip)} ({sw.switch_ip}) — {sw.error}
      </div>
    );
  }

  return (
    <div style={{
      background: FG.containerBg,
      border: `1px solid ${sw.total_diffs > 0 ? FG.warningBorder : FG.rowDefaultBorder}`,
      borderRadius: 10,
      marginBottom: 10,
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          color: FG.bodyColor,
          cursor: "pointer",
          textAlign: "left",
          fontSize: 13,
        }}
      >
        <span style={{display: "flex", alignItems: "center", gap: 10}}>
          <span style={{color: FG.mutedColor, fontFamily: "ui-monospace, monospace"}}>{open ? "▾" : "▸"}</span>
          <span style={{fontWeight: 600, color: FG.titleColor}}>{displayName(sw.switch_ip)}</span>
          <code style={{color: FG.mutedColor, fontSize: 11}}>{sw.switch_ip}</code>
        </span>
        {sw.total_diffs === 0
          ? <StatusPill tone="good">match</StatusPill>
          : <StatusPill tone="warn">{sw.total_diffs} diff{sw.total_diffs === 1 ? "" : "s"}</StatusPill>}
      </button>

      {open && sw.total_diffs > 0 && (
        <div style={{padding: "0 14px 14px 14px", display: "flex", flexDirection: "column", gap: 10}}>
          {sw.tables.filter((t) => (t.left_only.length + t.right_only.length + t.differing.length) > 0).map((t) => (
            <TableBlock key={t.name} t={t} left={left} right={right} />
          ))}
        </div>
      )}
    </div>
  );
}

function TableBlock({t, left, right}: {t: TableDiff; left: string; right: string}) {
  return (
    <div style={{
      background: "var(--bg0)",
      border: `1px solid ${FG.divider}`,
      borderRadius: 8,
      padding: "10px 12px",
    }}>
      <div style={{fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 600, color: FG.subtitleColor, marginBottom: 6}}>
        {t.name}
      </div>
      {t.left_only.length > 0 && (
        <div style={{marginBottom: 6}}>
          <div style={{fontSize: 10, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2}}>
            Only on {left} ({t.left_only.length})
          </div>
          <ul style={{margin: 0, paddingLeft: 20, fontSize: 12, fontFamily: "ui-monospace, monospace", color: FG.errorRed}}>
            {t.left_only.map((k) => <li key={k}>{k}</li>)}
          </ul>
        </div>
      )}
      {t.right_only.length > 0 && (
        <div style={{marginBottom: 6}}>
          <div style={{fontSize: 10, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2}}>
            Only on {right} ({t.right_only.length})
          </div>
          <ul style={{margin: 0, paddingLeft: 20, fontSize: 12, fontFamily: "ui-monospace, monospace", color: FG.successGreen}}>
            {t.right_only.map((k) => <li key={k}>{k}</li>)}
          </ul>
        </div>
      )}
      {t.differing.length > 0 && (
        <div>
          <div style={{fontSize: 10, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2}}>
            Differing ({t.differing.length})
          </div>
          {t.differing.map((kd) => (
            <div key={kd.key} style={{marginBottom: 6, fontFamily: "ui-monospace, monospace", fontSize: 12}}>
              <div style={{color: FG.subtitleColor, fontWeight: 600}}>{kd.key}</div>
              <table style={{borderCollapse: "collapse", marginLeft: 8}}>
                <tbody>
                  {kd.fields.map((f, i) => (
                    <tr key={i}>
                      <td style={{padding: "2px 8px", color: FG.mutedColor}}>{f.field}</td>
                      <td style={{padding: "2px 8px", color: FG.errorRed}}>{fmt(f.left)}</td>
                      <td style={{padding: "2px 8px", color: FG.successGreen}}>{fmt(f.right)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(v: any): string {
  if (v == null) return "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}
