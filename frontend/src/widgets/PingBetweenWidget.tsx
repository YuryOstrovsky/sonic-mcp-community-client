/**
 * Widget for ping_between — ICMP reachability result + an inline
 * "Pick source / target and re-run" control strip.
 *
 * Why interactive: ping is the only single-invocation tool that asks for
 * TWO switch identifiers. Re-running it via a NL prompt ("ping vm2 from
 * vm1") round-trips through the same NL pipeline the console uses for
 * everything else, so the confirmation modal / ledger / activity flow
 * stay consistent.
 */

import {useEffect, useMemo, useState} from "react";
import {FG} from "../lib/figmaStyles";
import {getReady} from "../lib/api";
import {displayName} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {KvGrid, Section} from "./common";
import {SUBMIT_PROMPT_EVENT} from "./HelpWidget";

type DeviceStatus = {restconf?: boolean; ssh?: boolean};
type ReadyDevices = Record<string, DeviceStatus>;

export function PingBetweenWidget({payload}: {payload: any}) {
  const s = payload?.summary ?? {};
  const reachable = !!s.reachable;
  const loss = s.loss_pct;
  const rtt = s.rtt_avg_ms;
  const stdout: string = payload?.stdout ?? "";

  // Infer defaults for the re-run dropdowns from the current result so the
  // user can tweak one side without retyping the other.
  const defaultSource = typeof s.from === "string" ? s.from : "";
  const defaultTarget = typeof s.to === "string" ? s.to : "";

  const [devices, setDevices] = useState<ReadyDevices>({});
  const [source, setSource] = useState(defaultSource);
  const [target, setTarget] = useState(defaultTarget);

  useEffect(() => {
    let cancelled = false;
    getReady()
      .then((r) => {
        const d = r?.body?.checks?.devices ?? {};
        if (!cancelled) {
          setDevices(d);
          // If the existing values don't match any known device, pick the
          // first reachable one as a sensible default.
          const ips = Object.keys(d);
          if (!source && ips.length) setSource(ips[0]);
          if (!target && ips.length > 1) setTarget(ips[1]);
          else if (!target && ips.length) setTarget(ips[0]);
        }
      })
      .catch(() => {/* silently leave devices empty */});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deviceIps = useMemo(() => Object.keys(devices), [devices]);

  // Distinguish "never ran / errored" from "actually unreachable". A real
  // ping result always has a `from` + `to` + `transmitted` count; if any
  // of those are missing the server either didn't run it or raised early.
  const hasResult = !!s.from && !!s.to && s.transmitted != null;
  const tone: "good" | "warn" | "bad" | "neutral" =
    !hasResult ? "neutral" :
    reachable && (loss ?? 0) === 0 ? "good" :
    reachable ? "warn" :
    "bad";
  const verdict =
    !hasResult ? "no result yet — pick endpoints below"
      : reachable && (loss ?? 0) === 0 ? "100% reachable"
      : reachable ? `partial loss (${loss}%)`
      : "unreachable";

  function runAgain() {
    if (!source || !target) return;
    // Route through the NL pipeline so the turn cards + ledger look the
    // same as if the user had typed it.
    const prompt = `ping ${displayName(target)} from ${displayName(source)}`;
    window.dispatchEvent(new CustomEvent(SUBMIT_PROMPT_EVENT, {detail: prompt}));
  }

  const canRun = !!source && !!target && source !== target;

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
          <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>Verdict</div>
          <div style={{display: "flex", gap: 8, alignItems: "center", marginTop: 6}}>
            <StatusPill tone={tone}>{verdict}</StatusPill>
          </div>
          <div style={{fontSize: 12, color: FG.mutedColor, marginTop: 6, fontFamily: "ui-monospace, monospace"}}>
            {s.from ? displayName(s.from) : "—"} → {s.to ? displayName(s.to) : "—"}
            {s.source_interface ? ` (via ${s.source_interface})` : ""}
          </div>
        </div>
        <div style={{flex: "1 1 140px"}}>
          <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>RTT avg</div>
          <div style={{fontSize: 20, fontWeight: 700, color: FG.headingColor, marginTop: 4, fontFamily: "ui-monospace, monospace"}}>
            {rtt != null ? `${rtt} ms` : "—"}
          </div>
        </div>
        <div style={{flex: "1 1 140px"}}>
          <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>Packets</div>
          <div style={{fontSize: 20, fontWeight: 700, color: FG.headingColor, marginTop: 4, fontFamily: "ui-monospace, monospace"}}>
            {s.received ?? "—"}/{s.transmitted ?? "—"}
          </div>
          <div style={{fontSize: 11, color: FG.mutedColor, marginTop: 2}}>received / sent</div>
        </div>
      </div>

      {/* Interactive re-run strip */}
      <div style={{
        background: FG.subtleBg,
        border: `1px solid ${FG.subtleBorder}`,
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}>
        <SwitchSelect
          label="From"
          value={source}
          onChange={setSource}
          devices={deviceIps}
        />
        <span style={{color: FG.mutedColor, fontSize: 16, padding: "0 4px"}}>→</span>
        <SwitchSelect
          label="To"
          value={target}
          onChange={setTarget}
          devices={deviceIps}
        />
        <div style={{flex: 1}} />
        <button
          onClick={runAgain}
          disabled={!canRun}
          title={source === target ? "Pick two different switches" : "Re-run ping between selected endpoints"}
          style={{
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 500,
            background: canRun ? FG.btnPrimaryBg : FG.btnDisabledBg,
            color: canRun ? "#ffffff" : FG.btnDisabledColor,
            border: `1px solid ${canRun ? FG.btnPrimaryBorder : FG.btnDisabledBorder}`,
            borderRadius: 8,
            cursor: canRun ? "pointer" : "not-allowed",
            transition: FG.transition,
          }}
          onMouseEnter={(e) => { if (canRun) e.currentTarget.style.background = FG.btnPrimaryHover; }}
          onMouseLeave={(e) => { if (canRun) e.currentTarget.style.background = FG.btnPrimaryBg; }}
        >Run ping</button>
      </div>

      <Section title="Details">
        <KvGrid columns={3} rows={[
          {label: "From",       value: s.from,                    mono: true},
          {label: "To",         value: s.to,                      mono: true},
          {label: "Transmitted", value: s.transmitted},
          {label: "Received",    value: s.received},
          {label: "Loss",        value: s.loss_pct != null ? `${s.loss_pct}%` : "—"},
          {label: "RTT avg",     value: rtt != null ? `${rtt} ms` : "—"},
          {label: "Source",      value: s.source,                  mono: true},
        ]} />
      </Section>

      {stdout && (
        <Section title="Raw ping output">
          <pre style={{
            background: "var(--bg0)",
            border: `1px solid ${FG.divider}`,
            borderRadius: 8,
            padding: 10,
            fontSize: 11.5,
            fontFamily: "ui-monospace, monospace",
            color: FG.bodyColor,
            margin: 0,
            maxHeight: 220,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}>{stdout}</pre>
        </Section>
      )}

      <div style={{marginTop: 4}}><Badge>transport: ssh</Badge></div>
    </div>
  );
}

function SwitchSelect(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  devices: string[];
}) {
  return (
    <div style={{display: "flex", alignItems: "center", gap: 6}}>
      <span style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>
        {props.label}
      </span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{
          background: FG.inputBg,
          color: FG.inputColor,
          border: `1px solid ${FG.inputBorder}`,
          borderRadius: 8,
          padding: "5px 10px",
          fontSize: 13,
          minWidth: 160,
          cursor: "pointer",
        }}
      >
        {props.devices.length === 0 && (
          <option value="">(no devices)</option>
        )}
        {props.devices.map((ip) => (
          <option key={ip} value={ip}>
            {displayName(ip)} ({ip})
          </option>
        ))}
        {/* Preserve pre-existing value that isn't in inventory (e.g. a
            custom target IP used on a previous ping). */}
        {props.value && !props.devices.includes(props.value) && (
          <option value={props.value}>{props.value}</option>
        )}
      </select>
    </div>
  );
}
