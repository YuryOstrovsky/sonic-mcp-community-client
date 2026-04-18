/**
 * Widget for get_fabric_config_diff — per-table diff between two switches.
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

export function FabricConfigDiffWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const tables: TableDiff[] = payload?.tables ?? [];

  const clean = (s.tables_differ ?? 0) === 0;

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
          {clean ? "configs match" : "configs differ"}
        </StatusPill>
        <div style={{fontSize: 13, color: FG.bodyColor}}>
          {displayName(s.left)} <span style={{color: FG.mutedColor}}>↔</span> {displayName(s.right)}
          {` — ${s.tables_differ ?? 0}/${s.tables_checked ?? 0} table${(s.tables_checked ?? 0) === 1 ? "" : "s"} differ`}
        </div>
      </div>

      <SummaryStrip items={[
        {label: "Tables checked", value: s.tables_checked     ?? 0},
        {label: "Tables differ",  value: s.tables_differ      ?? 0, tone: (s.tables_differ ?? 0) > 0 ? "warn" : "good"},
        {label: "Keys differ",    value: s.total_keys_differ  ?? 0, tone: (s.total_keys_differ ?? 0) > 0 ? "warn" : "good"},
      ]} />

      {tables.map((t) => (
        <TableBlock key={t.name} table={t} left={s.left} right={s.right} />
      ))}

      <div style={{marginTop: 4}}><Badge>transport: sonic-db-cli CONFIG_DB</Badge></div>
    </div>
  );
}

function TableBlock({table, left, right}: {table: TableDiff; left: string; right: string}) {
  const total = table.left_only.length + table.right_only.length + table.differing.length;
  const noDiff = total === 0;
  const [open, setOpen] = useState(!noDiff);

  return (
    <div style={{
      background: FG.containerBg,
      border: `1px solid ${noDiff ? FG.rowDefaultBorder : FG.warningBorder}`,
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
          <span style={{fontFamily: "ui-monospace, monospace", fontWeight: 600}}>{table.name}</span>
          <span style={{fontSize: 11, color: FG.mutedColor}}>
            {table.left_count}↔{table.right_count} rows
          </span>
        </span>
        {noDiff
          ? <StatusPill tone="good">match</StatusPill>
          : <StatusPill tone="warn">{total} diff{total === 1 ? "" : "s"}</StatusPill>}
      </button>

      {open && !noDiff && (
        <div style={{padding: "0 14px 14px 14px"}}>
          {table.left_only.length > 0 && (
            <div style={{marginTop: 8}}>
              <div style={sectionLabel}>Only on {displayName(left)} ({table.left_only.length})</div>
              <ul style={ul}>{table.left_only.map((k) => <li key={k} style={mono}>{k}</li>)}</ul>
            </div>
          )}
          {table.right_only.length > 0 && (
            <div style={{marginTop: 8}}>
              <div style={sectionLabel}>Only on {displayName(right)} ({table.right_only.length})</div>
              <ul style={ul}>{table.right_only.map((k) => <li key={k} style={mono}>{k}</li>)}</ul>
            </div>
          )}
          {table.differing.length > 0 && (
            <div style={{marginTop: 8}}>
              <div style={sectionLabel}>Differing ({table.differing.length})</div>
              {table.differing.map((kd) => (
                <div key={kd.key} style={{marginBottom: 8}}>
                  <div style={{...mono, color: FG.subtitleColor, fontWeight: 600, marginBottom: 4}}>{kd.key}</div>
                  <table style={{borderCollapse: "collapse", fontSize: 12, fontFamily: "ui-monospace, monospace"}}>
                    <thead>
                      <tr>
                        <th style={diffTh}>field</th>
                        <th style={diffTh}>{displayName(left)}</th>
                        <th style={diffTh}>{displayName(right)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kd.fields.map((f, i) => (
                        <tr key={i}>
                          <td style={diffTd}>{f.field}</td>
                          <td style={{...diffTd, color: FG.errorRed}}>{_str(f.left)}</td>
                          <td style={{...diffTd, color: FG.successGreen}}>{_str(f.right)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function _str(v: any): string {
  if (v === null || v === undefined) return "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  color: FG.mutedColor,
  textTransform: "uppercase",
  letterSpacing: 1,
  marginBottom: 4,
};
const ul: React.CSSProperties = {
  margin: 0, padding: "4px 0 4px 20px", listStyle: "disc",
  color: FG.bodyColor, fontSize: 12,
};
const mono: React.CSSProperties = {fontFamily: "ui-monospace, monospace"};
const diffTh: React.CSSProperties = {
  padding: "4px 10px",
  textAlign: "left",
  fontSize: 10,
  textTransform: "uppercase",
  color: FG.mutedColor,
  borderBottom: `1px solid ${FG.divider}`,
};
const diffTd: React.CSSProperties = {padding: "4px 10px", fontSize: 12};
