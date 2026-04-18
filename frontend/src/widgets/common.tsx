/**
 * Common widget primitives: Table, KvGrid, SummaryStrip, Section.
 * Used by per-tool widgets to stay visually consistent.
 */

import {useMemo, useState, type CSSProperties, type ReactNode} from "react";
import {FG} from "../lib/figmaStyles";
import {Badge} from "../shared";

// ─── Column + Table ──────────────────────────────────────────────
export type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  width?: string;          // e.g., "120px" or "15%"
  align?: "left" | "right" | "center";
  mono?: boolean;
};

export function Table<T>(props: {
  columns: Column<T>[];
  rows: T[];
  getKey?: (row: T, i: number) => string | number;
  maxHeight?: number | string;
  emptyText?: string;
  filterPlaceholder?: string;
  filterText?: (row: T) => string;   // enable filter when provided
}) {
  const {columns, rows, getKey, maxHeight = 460, emptyText = "No data.", filterPlaceholder, filterText} = props;
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filterText || !filter.trim()) return rows;
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => filterText(r).toLowerCase().includes(q));
  }, [rows, filter, filterText]);

  const showFilter = !!filterText;

  return (
    <div>
      {showFilter && (
        <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 8}}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={filterPlaceholder ?? "filter…"}
            style={{
              background: FG.inputBg,
              border: `1px solid ${FG.inputBorder}`,
              color: FG.inputColor,
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 12,
              flex: 1,
              maxWidth: 260,
            }}
          />
          <span style={{fontSize: 11, color: FG.mutedColor}}>
            {filtered.length}/{rows.length} rows
          </span>
        </div>
      )}

      <div style={{
        overflow: "auto",
        maxHeight,
        border: `1px solid ${FG.divider}`,
        borderRadius: 8,
      }}>
        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12.5,
          color: FG.bodyColor,
        }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    background: FG.containerBg,
                    borderBottom: `1px solid ${FG.containerBorder}`,
                    padding: "8px 10px",
                    textAlign: c.align ?? "left",
                    color: FG.mutedColor,
                    fontWeight: 600,
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    width: c.width,
                  }}
                >{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{padding: "18px 10px", textAlign: "center", color: FG.mutedColor}}>
                  {emptyText}
                </td>
              </tr>
            ) : filtered.map((row, i) => (
              <tr
                key={getKey ? getKey(row, i) : i}
                style={{
                  background: i % 2 ? "transparent" : FG.subtleBg,
                }}
              >
                {columns.map((c) => {
                  const v = c.render ? c.render(row) : (row as any)[c.key];
                  return (
                    <td key={c.key} style={{
                      padding: "6px 10px",
                      borderBottom: `1px solid ${FG.divider}`,
                      textAlign: c.align ?? "left",
                      fontFamily: c.mono ? "ui-monospace, SFMono-Regular, monospace" : undefined,
                      verticalAlign: "top",
                    }}>{v ?? <span style={{color: FG.dimColor}}>—</span>}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── KvGrid — label / value pairs ─────────────────────────────────
export function KvGrid(props: {
  rows: Array<{label: string; value: ReactNode; mono?: boolean}>;
  columns?: 1 | 2 | 3;
}) {
  const cols = props.columns ?? 2;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 8,
    }}>
      {props.rows.map((r) => (
        <div key={r.label} style={{display: "flex", flexDirection: "column", gap: 2}}>
          <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>
            {r.label}
          </div>
          <div style={{
            color: FG.bodyColor,
            fontSize: 13,
            fontFamily: r.mono ? "ui-monospace, SFMono-Regular, monospace" : undefined,
            wordBreak: "break-all",
          }}>
            {r.value ?? <span style={{color: FG.dimColor}}>—</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── SummaryStrip — one-line numeric highlights ───────────────────
// Flexbox + wrap rather than grid auto-fit: more predictable fitting when
// cards have variable-length subtitles (one long subtitle was stretching
// the whole row past the viewport in grid-auto-fit mode).
export function SummaryStrip(props: {
  items: Array<{label: string; value: ReactNode; tone?: "good" | "warn" | "bad" | "info" | "neutral"; sub?: ReactNode}>;
}) {
  const tones: Record<string, string> = {
    good: FG.successGreen,
    warn: FG.warningYellow,
    bad: FG.errorRed,
    info: FG.infoBlue,
    neutral: FG.headingColor,
  };
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
      marginBottom: 14,
    }}>
      {props.items.map((it) => (
        <div key={it.label} style={{
          flex: "1 1 140px",
          minWidth: 0,
          overflow: "hidden",
          background: "var(--bg0)",
          border: `1px solid ${FG.divider}`,
          borderRadius: 10,
          padding: "10px 12px",
        }}>
          <div style={{
            fontSize: 10,
            color: FG.mutedColor,
            textTransform: "uppercase",
            letterSpacing: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            {it.label}
          </div>
          <div style={{
            fontSize: 20,
            fontWeight: 600,
            color: tones[it.tone ?? "neutral"],
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>{it.value}</div>
          {it.sub && <div style={{
            fontSize: 11,
            color: FG.mutedColor,
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Section — labeled container inside a widget ──────────────────
export function Section(props: {title: string; right?: ReactNode; children: ReactNode; style?: CSSProperties}) {
  return (
    <div style={{marginBottom: 14, ...props.style}}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1.1,
          color: FG.mutedColor,
          fontWeight: 600,
        }}>{props.title}</div>
        {props.right}
      </div>
      {props.children}
    </div>
  );
}

// ─── UpDownPill — reusable admin/oper state pill ─────────────────
export function UpDownPill(props: {value: any; falseyLabel?: string}) {
  const raw = props.value;
  if (raw === null || raw === undefined) {
    return <Badge title="not reported">—</Badge>;
  }
  const s = String(raw).toUpperCase();
  const up = s === "UP" || s === "TRUE" || s === "1";
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 8px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      background: up ? FG.successBg : FG.errorBg,
      color: up ? FG.successGreen : FG.errorRed,
      border: `1px solid ${up ? FG.successBorder : FG.errorBorder}`,
    }}>{s || props.falseyLabel || "?"}</span>
  );
}

// ─── Number formatting helpers ────────────────────────────────────
export function fmtNum(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? parseInt(v, 10) : v;
  if (Number.isNaN(n) || typeof n !== "number") return String(v);
  return n.toLocaleString();
}
