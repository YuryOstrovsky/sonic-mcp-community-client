/**
 * Top-bar switch picker — dropdown of known inventory devices.
 *
 * Sources the device list from /api/ready (passed in as readyData).
 * Selection persists in localStorage.
 */

import {displayName} from "./lib/state";

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
    <div className="flex items-center gap-2.5">
      <span className="text-xs text-gray-400">Target switch</span>
      <select
        value={props.selected ?? ""}
        onChange={(e) => props.onChange(e.target.value || null)}
        className="h-8 cursor-pointer rounded-md border border-white/10 bg-[#0d1220] px-3 text-sm text-gray-200 hover:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20"
      >
        <option value="">— none —</option>
        {ips.map((ip) => (
          <option key={ip} value={ip}>
            {displayName(ip)} ({ip})
          </option>
        ))}
      </select>
    </div>
  );
}
