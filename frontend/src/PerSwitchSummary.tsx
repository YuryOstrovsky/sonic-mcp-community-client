/**
 * Per-switch operational health summary for the Dashboard.
 *
 * Fans out four multi-device tools in parallel on mount and on each
 * refresh, then renders a grid of rich per-switch cards:
 *   - system (SONiC version, platform, HwSKU, uptime)
 *   - interfaces (total + admin-up count)
 *   - BGP (peers + established count)
 *   - LLDP (TX, RX, neighbor count; warning when RX=0 on SONiC VS)
 *
 * Missing data (e.g. one _all call fails) shows a per-section error
 * without blocking the other sections. A partial card is more useful
 * than a big red banner.
 */

import {useEffect, useState} from "react";
import {FG} from "./lib/figmaStyles";
import {displayName} from "./lib/state";
import {Badge, Button, ErrorBanner, Loading, StatusPill} from "./shared";
import {ApiError, invoke} from "./lib/api";

// ─── Types ──────────────────────────────────────────────────────

type SwitchSummary = {
  switch_ip: string;
  reachable: boolean;
  duration_ms?: number;
  system: {
    version?: string | null;
    platform?: string | null;
    hwsku?: string | null;
    uptime?: string | null;
  };
  interfaces: {
    total?: number;
    admin_up?: number;
  };
  bgp: {
    peers?: number;
    established?: number;
    router_id?: string | null;
  };
  lldp: {
    tx?: number;
    rx?: number;
    neighbor_count?: number;
  };
  errors: string[];
};

type FanoutResult = {
  summary?: {target_count?: number; ok_count?: number; error_count?: number; elapsed_ms?: number};
  by_switch?: Record<string, {status: string; payload?: any; error?: string; duration_ms?: number}>;
};

// ─── Component ──────────────────────────────────────────────────

export function PerSwitchSummary(props: {selectedSwitch: string | null}) {
  const [summaries, setSummaries] = useState<SwitchSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  async function fetchAll() {
    setLoading(true);
    setErr(null);
    try {
      // Fire four multi-device fan-outs in parallel.
      const [sysR, ifaceR, bgpR, lldpR] = await Promise.allSettled([
        invoke("get_system_info_all", {}),
        invoke("get_interfaces_all", {}),
        invoke("get_bgp_summary_all", {}),
        invoke("get_lldp_neighbors_all", {}),
      ]);
      setSummaries(aggregate(sysR, ifaceR, bgpR, lldpR));
      setLastFetched(new Date());
    } catch (e: any) {
      setErr(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section style={{
      background: FG.containerBg,
      border: `1px solid ${FG.containerBorder}`,
      borderRadius: FG.containerRadius,
      padding: 16,
      marginBottom: 16,
      boxShadow: FG.containerShadow,
    }}>
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 14,
        flexWrap: "wrap",
      }}>
        <div>
          <h2 style={{margin: 0, color: FG.headingColor, fontSize: 16, fontWeight: 600}}>
            Per-switch summary
          </h2>
          <div style={{fontSize: 11, color: FG.mutedColor, marginTop: 2}}>
            Live fan-out across the whole inventory: system, interfaces, BGP, LLDP.
          </div>
        </div>
        <div style={{display: "flex", alignItems: "center", gap: 10}}>
          {lastFetched && (
            <span style={{fontSize: 11, color: FG.mutedColor}}>
              {humanSince(lastFetched)}
            </span>
          )}
          <Button onClick={fetchAll} disabled={loading}>
            {loading ? <><span className="loading-spin" /> refreshing…</> : "↻ Refresh"}
          </Button>
        </div>
      </header>

      {err && <div style={{marginBottom: 10}}><ErrorBanner>{err}</ErrorBanner></div>}

      {!summaries && loading && <Loading label="fanning out to all switches…" />}

      {summaries && summaries.length === 0 && (
        <div style={{color: FG.mutedColor, fontSize: 13, textAlign: "center", padding: 20}}>
          No switches returned any data.
        </div>
      )}

      {summaries && summaries.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 12,
        }}>
          {summaries.map((s) => (
            <SwitchCard
              key={s.switch_ip}
              s={s}
              selected={s.switch_ip === props.selectedSwitch}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Merge the four fan-out envelopes into per-switch rows ────────

function aggregate(
  sysR: PromiseSettledResult<any>,
  ifaceR: PromiseSettledResult<any>,
  bgpR: PromiseSettledResult<any>,
  lldpR: PromiseSettledResult<any>,
): SwitchSummary[] {
  const byIp = new Map<string, SwitchSummary>();
  const ensure = (ip: string): SwitchSummary => {
    let s = byIp.get(ip);
    if (!s) {
      s = {
        switch_ip: ip,
        reachable: false,
        system: {},
        interfaces: {},
        bgp: {},
        lldp: {},
        errors: [],
      };
      byIp.set(ip, s);
    }
    return s;
  };

  // ---- system_info_all ----
  if (sysR.status === "fulfilled") {
    const fo = (sysR.value?.result?.payload || {}) as FanoutResult;
    for (const [ip, entry] of Object.entries(fo.by_switch ?? {})) {
      const s = ensure(ip);
      s.duration_ms = entry.duration_ms;
      if (entry.status === "ok") {
        s.reachable = true;
        const sys = entry.payload?.system ?? {};
        s.system = {
          version: sys.sonic_software_version,
          platform: sys.platform,
          hwsku: sys.hwsku,
          uptime: sys.uptime,
        };
      } else {
        s.errors.push(`system_info: ${truncate(entry.error || "unknown", 80)}`);
      }
    }
  } else {
    // Whole call failed — we don't know which switches, nothing to do here.
  }

  // ---- interfaces_all ----
  if (ifaceR.status === "fulfilled") {
    const fo = (ifaceR.value?.result?.payload || {}) as FanoutResult;
    for (const [ip, entry] of Object.entries(fo.by_switch ?? {})) {
      const s = ensure(ip);
      if (entry.status === "ok") {
        const sum = entry.payload?.summary ?? {};
        s.interfaces = {
          total: sum.count ?? (entry.payload?.interfaces?.length),
          admin_up: (entry.payload?.interfaces || []).filter(
            (r: any) => String(r?.admin_status ?? "").toUpperCase() === "UP",
          ).length,
        };
      } else {
        s.errors.push(`interfaces: ${truncate(entry.error || "unknown", 80)}`);
      }
    }
  }

  // ---- bgp_summary_all ----
  if (bgpR.status === "fulfilled") {
    const fo = (bgpR.value?.result?.payload || {}) as FanoutResult;
    for (const [ip, entry] of Object.entries(fo.by_switch ?? {})) {
      const s = ensure(ip);
      if (entry.status === "ok") {
        const totals = entry.payload?.summary?.totals ?? {};
        s.bgp = {
          peers: totals.ipv4_peers,
          established: totals.ipv4_established,
          router_id: entry.payload?.ipv4?.router_id,
        };
      } else {
        s.errors.push(`bgp: ${truncate(entry.error || "unknown", 80)}`);
      }
    }
  }

  // ---- lldp_neighbors_all ----
  if (lldpR.status === "fulfilled") {
    const fo = (lldpR.value?.result?.payload || {}) as FanoutResult;
    for (const [ip, entry] of Object.entries(fo.by_switch ?? {})) {
      const s = ensure(ip);
      if (entry.status === "ok") {
        const sum = entry.payload?.summary ?? {};
        const st = sum.stats_totals ?? {};
        s.lldp = {
          tx: numify(st.tx),
          rx: numify(st.rx),
          neighbor_count: sum.neighbor_count,
        };
      } else {
        s.errors.push(`lldp: ${truncate(entry.error || "unknown", 80)}`);
      }
    }
  }

  // Sort by IP (stable, predictable)
  return Array.from(byIp.values()).sort((a, b) => a.switch_ip.localeCompare(b.switch_ip));
}

// ─── Card ───────────────────────────────────────────────────────

function SwitchCard(props: {s: SwitchSummary; selected: boolean}) {
  const {s, selected} = props;

  // Tones
  const ifaceTone: "good" | "warn" | "bad" | "neutral" =
    s.interfaces.total === undefined ? "neutral" :
    (s.interfaces.admin_up ?? 0) === 0 ? "warn" :
    (s.interfaces.admin_up ?? 0) < (s.interfaces.total ?? 0) ? "warn" :
    "good";

  const bgpTone: "good" | "warn" | "bad" | "neutral" =
    s.bgp.peers === undefined ? "neutral" :
    (s.bgp.established ?? 0) === 0 && (s.bgp.peers ?? 0) > 0 ? "warn" :
    (s.bgp.established ?? 0) < (s.bgp.peers ?? 0) ? "warn" :
    (s.bgp.established ?? 0) === 0 ? "neutral" : "good";

  const lldpRxZero = s.lldp.tx !== undefined && (s.lldp.tx ?? 0) > 0 && (s.lldp.rx ?? 0) === 0;
  const lldpTone: "good" | "warn" | "bad" | "neutral" =
    s.lldp.neighbor_count === undefined ? "neutral" :
    (s.lldp.neighbor_count ?? 0) > 0 ? "good" :
    lldpRxZero ? "warn" : "neutral";

  // ifaceTone/bgpTone only ever produce good|warn|neutral by their own logic,
  // so the "bad" tier is reserved for unreachable switches.
  const overall: "good" | "warn" | "bad" | "neutral" =
    !s.reachable ? "bad" :
    s.errors.length > 0 ? "warn" :
    ifaceTone === "warn" || bgpTone === "warn" ? "warn" :
    "good";

  return (
    <div style={{
      background: "var(--bg0)",
      border: `1px solid ${selected ? FG.rowSelectedBorder : FG.containerBorder}`,
      borderRadius: FG.containerRadius,
      padding: 14,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      boxShadow: selected ? FG.containerShadow : "none",
    }}>
      {/* Header */}
      <div style={{display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap"}}>
        <div>
          <div style={{fontSize: 16, fontWeight: 600, color: FG.titleColor}}>
            {displayName(s.switch_ip)}
          </div>
          <code style={{fontSize: 11, color: FG.mutedColor}}>{s.switch_ip}</code>
        </div>
        <div style={{display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap"}}>
          {selected && <Badge>selected</Badge>}
          <StatusPill tone={overall}>
            {!s.reachable ? "unreachable" : overall === "good" ? "healthy" : overall === "warn" ? "attention" : "error"}
          </StatusPill>
        </div>
      </div>

      {/* System */}
      {s.system.version && (
        <div style={{fontSize: 11, color: FG.mutedColor, fontFamily: "ui-monospace, monospace", wordBreak: "break-all"}}>
          <div>{s.system.version}</div>
          <div>{s.system.hwsku ?? "?"}{s.system.platform ? ` · ${s.system.platform}` : ""}</div>
        </div>
      )}

      {/* Metrics grid */}
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8}}>
        <Metric
          label="Interfaces"
          value={
            s.interfaces.total === undefined ? "—"
              : `${s.interfaces.admin_up ?? 0}/${s.interfaces.total}`
          }
          sub={s.interfaces.total === undefined ? "" : "admin up"}
          tone={ifaceTone}
        />
        <Metric
          label="BGP v4"
          value={
            s.bgp.peers === undefined ? "—"
              : `${s.bgp.established ?? 0}/${s.bgp.peers}`
          }
          sub={s.bgp.peers === undefined ? "" : "established"}
          tone={bgpTone}
        />
        <Metric
          label="LLDP"
          value={
            s.lldp.tx === undefined ? "—"
              : `${s.lldp.neighbor_count ?? 0}`
          }
          sub={
            s.lldp.tx === undefined ? ""
              : `tx ${fmt(s.lldp.tx)} · rx ${fmt(s.lldp.rx)}`
          }
          tone={lldpTone}
        />
      </div>

      {/* LLDP VS warning — same note the LldpWidget surfaces */}
      {lldpRxZero && (
        <div style={{
          fontSize: 11,
          color: FG.warningYellow,
          background: FG.warningBg,
          border: `1px solid ${FG.warningBorder}`,
          padding: "4px 8px",
          borderRadius: 6,
        }}>
          ⚠ LLDP TX &gt; 0, RX = 0 — SONiC VS limitation
        </div>
      )}

      {/* Uptime */}
      {s.system.uptime && (
        <div style={{fontSize: 10, color: FG.dimColor, fontFamily: "ui-monospace, monospace", wordBreak: "break-all"}}>
          ⏱ {s.system.uptime}
        </div>
      )}

      {/* Per-section errors */}
      {s.errors.length > 0 && (
        <div style={{
          fontSize: 10,
          color: FG.errorRed,
          background: FG.errorBg,
          border: `1px solid ${FG.errorBorder}`,
          padding: "4px 8px",
          borderRadius: 6,
          fontFamily: "ui-monospace, monospace",
          lineHeight: 1.5,
        }}>
          {s.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}
    </div>
  );
}

// ─── Small bits ─────────────────────────────────────────────────

function Metric(props: {
  label: string;
  value: string | number;
  sub?: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const color =
    props.tone === "good"  ? FG.successGreen :
    props.tone === "warn"  ? FG.warningYellow :
    props.tone === "bad"   ? FG.errorRed :
    FG.headingColor;
  return (
    <div style={{
      background: FG.subtleBg,
      border: `1px solid ${FG.subtleBorder}`,
      borderRadius: 8,
      padding: "6px 8px",
      minWidth: 0,
      overflow: "hidden",
    }}>
      <div style={{
        fontSize: 9,
        color: FG.mutedColor,
        textTransform: "uppercase",
        letterSpacing: 1,
        whiteSpace: "nowrap",
      }}>{props.label}</div>
      <div style={{
        fontSize: 17,
        fontWeight: 700,
        color,
        fontFamily: "ui-monospace, monospace",
        whiteSpace: "nowrap",
      }}>{props.value}</div>
      {props.sub && (
        <div style={{
          fontSize: 10,
          color: FG.mutedColor,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>{props.sub}</div>
      )}
    </div>
  );
}

function numify(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? undefined : n;
}

function fmt(v: number | undefined): string {
  if (v === undefined) return "—";
  return v.toLocaleString();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function humanSince(d: Date): string {
  const ms = Date.now() - d.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `updated ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `updated ${m}m ago`;
  return `updated at ${d.toLocaleTimeString()}`;
}
