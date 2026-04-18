/**
 * Widget for any `*_all` multi-device tool (currently get_system_info_all).
 *
 * Payload shape from sonic.tools._fanout.fan_out:
 *   {
 *     summary: {target_count, ok_count, error_count, elapsed_ms, targets: [...]},
 *     by_switch: {
 *       <switch_ip>: {status: "ok", payload: <inner payload>, duration_ms}
 *       | {status: "error", error, error_type, duration_ms}
 *     }
 *   }
 *
 * For each switch, if status=="ok", we recursively render the inner payload
 * with the single-device tool's widget (convention: strip trailing `_all`
 * from the tool name). Error results show the error message in an error
 * banner. Uses <details> elements so the user can expand/collapse per
 * switch — avoids swamping the view when there are many devices.
 */

import {useState, type ReactNode} from "react";
import {FG} from "../lib/figmaStyles";
import {displayName} from "../lib/state";
import {Badge, StatusPill, ErrorBanner} from "../shared";
import {SummaryStrip} from "./common";

// Forward reference — set by widgets/index.tsx to avoid circular-import pain.
type InnerRenderer = (tool: string, payload: any) => ReactNode;
let _innerRenderer: InnerRenderer | null = null;
export function setMultiInnerRenderer(fn: InnerRenderer) {
  _innerRenderer = fn;
}

type PerSwitchOk = {status: "ok"; payload: any; duration_ms?: number};
type PerSwitchErr = {status: "error"; error: string; error_type?: string; duration_ms?: number};
type PerSwitch = PerSwitchOk | PerSwitchErr;

export function MultiDeviceWidget({tool, payload}: {tool: string; payload: any}) {
  const s = payload?.summary ?? {};
  const by = (payload?.by_switch ?? {}) as Record<string, PerSwitch>;
  const innerTool = tool.replace(/_all$/, "");

  const entries = Object.entries(by);
  const anyErrors = entries.some(([, v]) => v.status === "error");

  return (
    <div>
      <SummaryStrip
        items={[
          {label: "Targets",  value: s.target_count ?? entries.length, tone: "info"},
          {label: "OK",       value: s.ok_count ?? 0,    tone: (s.ok_count ?? 0) > 0 ? "good" : "neutral"},
          {label: "Errors",   value: s.error_count ?? 0, tone: (s.error_count ?? 0) > 0 ? "bad" : "good"},
          {label: "Elapsed",  value: `${s.elapsed_ms ?? "?"}ms`, tone: "neutral"},
        ]}
      />

      {anyErrors && (
        <div style={{color: FG.warningYellow, fontSize: 12, marginBottom: 8}}>
          ⚠ Some switches returned errors. Expand each row to see details.
        </div>
      )}

      <div style={{display: "flex", flexDirection: "column", gap: 8}}>
        {entries.map(([ip, res]) => (
          <SwitchRow key={ip} ip={ip} res={res} innerTool={innerTool} />
        ))}
      </div>

      <div style={{marginTop: 10}}>
        <Badge>tool: {tool}</Badge>
      </div>
    </div>
  );
}

function SwitchRow({ip, res, innerTool}: {ip: string; res: PerSwitch; innerTool: string}) {
  const [open, setOpen] = useState(true);
  const ok = res.status === "ok";

  return (
    <section style={{
      background: "var(--bg0)",
      border: `1px solid ${ok ? FG.rowDefaultBorder : FG.errorBorder}`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: FG.bodyColor,
        }}
      >
        <div style={{display: "flex", alignItems: "center", gap: 10}}>
          <span style={{
            color: FG.mutedColor,
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            width: 12,
            display: "inline-block",
            textAlign: "center",
          }}>{open ? "▾" : "▸"}</span>
          <strong style={{color: FG.titleColor}}>{displayName(ip)}</strong>
          <code style={{color: FG.mutedColor, fontSize: 12}}>{ip}</code>
        </div>
        <div style={{display: "flex", gap: 6, alignItems: "center"}}>
          <StatusPill tone={ok ? "good" : "bad"}>{ok ? "ok" : (res as PerSwitchErr).error_type ?? "error"}</StatusPill>
          {res.duration_ms !== undefined && <Badge>{res.duration_ms}ms</Badge>}
        </div>
      </button>

      {open && (
        <div style={{padding: "0 14px 14px 14px"}}>
          {ok ? (
            _innerRenderer
              ? _innerRenderer(innerTool, (res as PerSwitchOk).payload)
              : <Badge>widget not registered for {innerTool}</Badge>
          ) : (
            <ErrorBanner>{(res as PerSwitchErr).error}</ErrorBanner>
          )}
        </div>
      )}
    </section>
  );
}
