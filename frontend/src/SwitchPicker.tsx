/**
 * Top-bar switch picker — dropdown of known inventory devices.
 *
 * Sources the device list from /api/ready (passed in as readyData).
 * Selection persists in localStorage.
 */

import {FG} from "./lib/figmaStyles";
import {displayName} from "./lib/state";
import {StatusPill} from "./shared";

type DeviceStatus = {restconf?: boolean; ssh?: boolean};
type ReadyShape = {
  status_code?: number;
  body?: {
    checks?: {
      devices?: Record<string, DeviceStatus>;
    };
  };
};

export function SwitchPicker(props: {
  ready: ReadyShape | null;
  selected: string | null;
  onChange: (ip: string | null) => void;
}) {
  const devices = props.ready?.body?.checks?.devices ?? {};
  const ips = Object.keys(devices);

  return (
    <div style={{display: "flex", alignItems: "center", gap: 10}}>
      <label style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1.1}}>
        Target switch
      </label>
      <select
        value={props.selected ?? ""}
        onChange={(e) => props.onChange(e.target.value || null)}
        style={{
          background: FG.inputBg,
          color: FG.inputColor,
          border: `1px solid ${FG.inputBorder}`,
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 13,
          minWidth: 180,
          cursor: "pointer",
        }}
      >
        <option value="">— none —</option>
        {ips.map((ip) => (
          <option key={ip} value={ip}>
            {displayName(ip)} ({ip})
          </option>
        ))}
      </select>

      {props.selected && devices[props.selected] && (
        <>
          <StatusPill tone={devices[props.selected].restconf ? "good" : "bad"}>
            RESTCONF
          </StatusPill>
          <StatusPill tone={devices[props.selected].ssh ? "good" : "bad"}>
            SSH
          </StatusPill>
        </>
      )}
    </div>
  );
}
