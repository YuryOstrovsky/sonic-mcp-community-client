/**
 * Widget for get_mutation_history — the mutation audit log.
 *
 * Renders the server-side mutation ledger as an expandable timeline.
 * Used by both the dedicated ActivityView and any ad-hoc invocation
 * from the AI Console or Tools view.
 */

import {useMemo, useState} from "react";
import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {Section, SummaryStrip} from "./common";

type Entry = {
  mutation_id: string;
  timestamp: string;
  tool: string;
  risk: string;
  switch_ip: string | null;
  inputs: Record<string, any>;
  status: string;
  pre_state: any;
  post_state: any;
  error: string | null;
  request_id: string | null;
  correlation_id: string | null;
  session_id: string | null;
  agent: string | null;
};

export function ActivityWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const entries: Entry[] = payload?.entries ?? [];

  const sortedEntries = useMemo(() => {
    // Ledger writes chronologically; show newest first in the UI.
    return [...entries].reverse();
  }, [entries]);

  const byToolEntries = Object.entries(summary.by_tool ?? {}) as [string, number][];
  const byStatus = summary.by_status ?? {ok: 0, failed: 0};

  return (
    <div>
      <SummaryStrip
        items={[
          {label: "Entries", value: summary.count ?? entries.length, tone: "info"},
          {label: "OK", value: byStatus.ok ?? 0, tone: (byStatus.ok ?? 0) > 0 ? "good" : "neutral"},
          {label: "Failed", value: byStatus.failed ?? 0, tone: (byStatus.failed ?? 0) > 0 ? "bad" : "good"},
          {label: "Distinct tools", value: byToolEntries.length, tone: "neutral"},
        ]}
      />

      {byToolEntries.length > 0 && (
        <Section title="By tool">
          <div style={{display: "flex", flexWrap: "wrap", gap: 6}}>
            {byToolEntries
              .sort((a, b) => b[1] - a[1])
              .map(([tool, n]) => (
                <Badge key={tool}>
                  <span style={{fontFamily: "ui-monospace, monospace"}}>{tool}</span>
                  <span style={{marginLeft: 6, color: FG.headingColor}}>{n}</span>
                </Badge>
              ))}
          </div>
        </Section>
      )}

      <Section title="Timeline" right={<Badge>{summary.source}</Badge>}>
        {sortedEntries.length === 0 ? (
          <div style={{
            padding: 20,
            textAlign: "center",
            color: FG.mutedColor,
            fontSize: 13,
          }}>
            No mutations yet. When you invoke a MUTATION tool (e.g.
            set_interface_admin_status or config_save), an entry will appear here.
          </div>
        ) : (
          <div style={{display: "flex", flexDirection: "column", gap: 6}}>
            {sortedEntries.map((e) => <EntryRow key={e.mutation_id} entry={e} />)}
          </div>
        )}
      </Section>
    </div>
  );
}

function EntryRow({entry: e}: {entry: Entry}) {
  const [open, setOpen] = useState(false);
  const ok = e.status === "ok";
  const ts = e.timestamp || "";
  const tsShort = ts.length >= 19 ? ts.replace("T", " ").slice(0, 19) + " UTC" : ts;

  return (
    <section style={{
      background: "var(--bg0)",
      border: `1px solid ${ok ? FG.rowDefaultBorder : FG.errorBorder}`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "auto 130px 1fr auto auto auto",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: FG.bodyColor,
          textAlign: "left",
        }}
        onMouseEnter={(el) => (el.currentTarget.style.background = FG.rowHoverBg)}
        onMouseLeave={(el) => (el.currentTarget.style.background = "transparent")}
      >
        <span style={{color: FG.mutedColor, fontSize: 11, fontFamily: "ui-monospace, monospace"}}>
          {open ? "▾" : "▸"}
        </span>
        <span style={{fontSize: 11, color: FG.mutedColor, fontFamily: "ui-monospace, monospace"}}>
          {tsShort.slice(11, 19) || "—"}
        </span>
        <span style={{
          fontFamily: "ui-monospace, monospace",
          fontWeight: 600,
          color: FG.titleColor,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>{e.tool}</span>
        <Badge title={e.switch_ip ?? ""}>
          {e.switch_ip ? displayName(e.switch_ip) : "—"}
        </Badge>
        <StatusPill tone={e.risk === "DESTRUCTIVE" ? "bad" : "warn"}>{e.risk}</StatusPill>
        <StatusPill tone={ok ? "good" : "bad"}>{e.status}</StatusPill>
      </button>

      {open && (
        <div style={{
          padding: "10px 14px",
          borderTop: `1px solid ${FG.divider}`,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
          <div style={{display: "grid", gridTemplateColumns: "140px 1fr", gap: 6, fontSize: 12}}>
            <Field label="mutation_id" value={<code>{e.mutation_id}</code>} />
            <Field label="timestamp" value={tsShort} />
            <Field label="switch_ip"  value={e.switch_ip ?? "—"} />
            <Field label="request_id" value={e.request_id ?? "—"} />
            <Field label="correlation_id" value={e.correlation_id ?? "—"} />
            {e.session_id && <Field label="session_id" value={e.session_id} />}
          </div>

          <Collapsible title="Inputs" defaultOpen>
            <pre style={preStyle}>{JSON.stringify(e.inputs, null, 2)}</pre>
          </Collapsible>

          {e.pre_state && (
            <Collapsible title="Pre-state">
              <pre style={preStyle}>{JSON.stringify(e.pre_state, null, 2)}</pre>
            </Collapsible>
          )}
          {e.post_state && (
            <Collapsible title="Post-state">
              <pre style={preStyle}>{JSON.stringify(e.post_state, null, 2)}</pre>
            </Collapsible>
          )}
          {e.error && (
            <div style={{
              padding: "8px 12px",
              background: FG.errorBg,
              border: `1px solid ${FG.errorBorder}`,
              color: FG.errorRed,
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "ui-monospace, monospace",
              whiteSpace: "pre-wrap",
            }}>{e.error}</div>
          )}
        </div>
      )}
    </section>
  );
}

function Field({label, value}: {label: string; value: React.ReactNode}) {
  return (
    <>
      <span style={{color: FG.mutedColor, textTransform: "uppercase", fontSize: 10, letterSpacing: 1, alignSelf: "center"}}>{label}</span>
      <span style={{color: FG.bodyColor, fontFamily: "ui-monospace, monospace", wordBreak: "break-all"}}>{value}</span>
    </>
  );
}

function Collapsible({title, children, defaultOpen = false}: {title: string; children: React.ReactNode; defaultOpen?: boolean}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: `1px solid ${FG.rowDefaultBorder}`,
          color: FG.mutedColor,
          borderRadius: 6,
          padding: "3px 10px",
          fontSize: 11,
          cursor: "pointer",
          fontFamily: "ui-monospace, monospace",
          marginBottom: open ? 6 : 0,
        }}
      >{open ? "▾" : "▸"} {title}</button>
      {open && children}
    </div>
  );
}

const preStyle: React.CSSProperties = {
  background: "var(--bg0)",
  color: FG.bodyColor,
  border: `1px solid ${FG.divider}`,
  borderRadius: 8,
  padding: 10,
  fontSize: 11.5,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  margin: 0,
  maxHeight: 240,
  overflow: "auto",
  whiteSpace: "pre-wrap",
};
