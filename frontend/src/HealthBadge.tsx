/**
 * Auto-refresh control + live fabric-health indicator for the header.
 *
 * Two things in one component:
 *   1. A small dropdown — off / 30s / 60s / 120s — that fires `onTick()`
 *      at the selected interval. App.tsx wires that to refreshReady()
 *      so every view gets re-fetched automatically.
 *   2. A status dot that turns red when `get_fabric_health` reports
 *      broken adjacencies or unreachable switches, with a tooltip of
 *      exactly which ones. The fabric probe runs on the same interval.
 *
 * User's choice of interval persists in localStorage.
 */

import {useEffect, useRef, useState} from "react";
import {invoke} from "./lib/api";

type HealthPayload = {
  summary?: {
    broken?: number;
    healthy?: number;
    orphan?: number;
    unreachable?: number;
  };
  broken_links?: any[];
  unreachable?: string[];
};

type Interval = "off" | "30" | "60" | "120";
const LS_KEY = "sonic-mcp:auto-refresh";

export function HealthBadge(props: {onTick: () => void}) {
  const [interval, setInterval_] = useState<Interval>(() => {
    const raw = localStorage.getItem(LS_KEY);
    return (raw as Interval) ?? "off";
  });
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const onTickRef = useRef(props.onTick);

  // Keep the ref in sync with the latest callback without assigning
  // during render (which trips React's concurrent-mode invariants).
  useEffect(() => {
    onTickRef.current = props.onTick;
  }, [props.onTick]);

  // Persist selection across reloads.
  useEffect(() => {
    localStorage.setItem(LS_KEY, interval);
  }, [interval]);

  // Auto-refresh loop. When `interval` changes we clear the previous
  // timer and start a fresh one; on unmount we clear it as well. Each
  // tick does TWO things: bump the global refreshKey via onTick, and
  // fetch `get_fabric_health` for the badge color.
  useEffect(() => {
    if (interval === "off") return;
    const ms = Number(interval) * 1000;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const doCycle = async () => {
      if (cancelled) return;
      onTickRef.current();
      try {
        const res = await invoke("get_fabric_health", {include_lldp: false});
        if (!cancelled) setHealth(res?.result?.payload ?? null);
      } catch {
        // swallow — leave the previous health state so the badge doesn't flicker
      }
      if (!cancelled) {
        timer = setTimeout(doCycle, ms);
      }
    };

    // First cycle fires immediately so the badge populates without
    // waiting for one full interval.
    doCycle();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [interval]);

  // When auto-refresh is off, ignore any stale payload — prevents the
  // badge from showing a cached "healthy" after the user disabled polling.
  const effectiveHealth = interval === "off" ? null : health;
  const s = effectiveHealth?.summary ?? {};
  const broken = (s.broken ?? 0) + (s.unreachable ?? 0);
  const orphan = s.orphan ?? 0;
  const tone: "good" | "warn" | "bad" | "off" =
    interval === "off" ? "off" :
    broken > 0 ? "bad" :
    orphan > 0 ? "warn" :
    "good";

  const title =
    interval === "off"
      ? "Auto-refresh off. Enable to poll fabric health in the background."
    : tone === "good"
      ? `Fabric healthy (${s.healthy ?? 0} adjacenc${(s.healthy ?? 0) === 1 ? "y" : "ies"} established)`
    : tone === "warn"
      ? `${orphan} orphan peer${orphan === 1 ? "" : "s"} — configured but unmatched`
    : `${s.broken ?? 0} broken · ${s.unreachable ?? 0} unreachable — click to see details`;

  return (
    <div className="flex items-center gap-2" title={title}>
      {interval !== "off" && <StatusDot tone={tone} />}
      <select
        value={interval}
        onChange={(e) => setInterval_(e.target.value as Interval)}
        className="h-8 cursor-pointer rounded-md border border-white/10 bg-[#0d1220] px-2 text-xs text-gray-300 hover:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20"
      >
        <option value="off">auto-refresh: off</option>
        <option value="30">auto: 30s</option>
        <option value="60">auto: 60s</option>
        <option value="120">auto: 120s</option>
      </select>
    </div>
  );
}

function StatusDot({tone}: {tone: "good" | "warn" | "bad" | "off"}) {
  const cls =
    tone === "good" ? "bg-green-500"
    : tone === "warn" ? "bg-yellow-400 animate-pulse"
    : tone === "bad" ? "bg-red-500 animate-pulse"
    : "bg-gray-500";
  return <span className={`h-2 w-2 rounded-full ${cls}`} />;
}
