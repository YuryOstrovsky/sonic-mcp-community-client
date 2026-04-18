/**
 * Common widget primitives: Table, KvGrid, SummaryStrip, Section.
 * Used by per-tool widgets to stay visually consistent.
 */

import {useMemo, useRef, useState, type CSSProperties, type ReactNode} from "react";
import {useVirtualizer} from "@tanstack/react-virtual";
import {FG} from "../lib/figmaStyles";
import {Badge} from "../shared";

// Threshold above which Table switches from native <table> rendering to
// a virtualized <div>-based list. Picked so 95% of real tool outputs
// keep the semantic <table> (good for copy-paste, ARIA) and only the
// genuinely big payloads pay the list-virtualization cost.
const VIRTUALIZE_ABOVE = 200;
const ROW_HEIGHT = 32;  // matches the padding+line-height of the native row

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
  const virtualize = filtered.length > VIRTUALIZE_ABOVE;

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
            {virtualize && <span style={{marginLeft: 6, color: FG.dimColor}}>(virtualized)</span>}
          </span>
        </div>
      )}

      {virtualize ? (
        <VirtualTable
          columns={columns}
          rows={filtered}
          getKey={getKey}
          maxHeight={maxHeight}
        />
      ) : (

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
      )}
    </div>
  );
}

// ─── Virtualized table body ──────────────────────────────────────
//
// Used automatically by Table when row count exceeds VIRTUALIZE_ABOVE.
// Uses @tanstack/react-virtual so only the rows visible in the scroll
// viewport pay their render cost. Row cells are absolutely positioned
// within a fixed-height track.
function VirtualTable<T>(props: {
  columns: Column<T>[];
  rows: T[];
  getKey?: (row: T, i: number) => string | number;
  maxHeight: number | string;
}) {
  const {columns, rows, getKey, maxHeight} = props;
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Flex basis per column — derived from `width` if specified, else equal share.
  const flexFor = (c: Column<T>) => c.width ? {flex: `0 0 ${c.width}`} : {flex: 1, minWidth: 0};

  return (
    <div
      ref={parentRef}
      style={{
        maxHeight,
        overflow: "auto",
        border: `1px solid ${FG.divider}`,
        borderRadius: 8,
        fontSize: 12.5,
        color: FG.bodyColor,
      }}
    >
      {/* Sticky header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 1,
        display: "flex", background: FG.containerBg,
        borderBottom: `1px solid ${FG.containerBorder}`,
      }}>
        {columns.map((c) => (
          <div
            key={c.key}
            style={{
              ...flexFor(c),
              padding: "8px 10px",
              textAlign: c.align ?? "left",
              color: FG.mutedColor,
              fontWeight: 600,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >{c.label}</div>
        ))}
      </div>

      <div style={{height: virtualizer.getTotalSize(), position: "relative"}}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          const zebra = item.index % 2 === 0 ? FG.subtleBg : "transparent";
          return (
            <div
              key={getKey ? getKey(row, item.index) : item.index}
              style={{
                position: "absolute", top: 0, left: 0, right: 0,
                height: item.size,
                transform: `translateY(${item.start}px)`,
                display: "flex",
                background: zebra,
                borderBottom: `1px solid ${FG.divider}`,
              }}
            >
              {columns.map((c) => {
                const v = c.render ? c.render(row) : (row as any)[c.key];
                return (
                  <div key={c.key} style={{
                    ...flexFor(c),
                    padding: "6px 10px",
                    textAlign: c.align ?? "left",
                    fontFamily: c.mono ? "ui-monospace, SFMono-Regular, monospace" : undefined,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {v ?? <span style={{color: FG.dimColor}}>—</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
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
  // Values render neutral — the label already tells the reader what the
  // number means, and colouring every cell made the UI feel overloaded.
  // Semantic signal moves to the label/sub (e.g. "1 failed") or a badge
  // next to it when actually needed.
  void (FG.successGreen, FG.warningYellow, FG.errorRed, FG.infoBlue);
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
            color: FG.headingColor,
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
