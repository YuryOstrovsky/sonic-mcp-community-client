/**
 * Activity view — browsable mutation audit log with search + filters.
 *
 * Server returns the last N entries from the ledger; filtering is done
 * client-side so the user can tweak search/status without a round-trip.
 * The filtered payload is handed to ActivityWidget for rendering.
 */

import {useEffect, useMemo, useState} from "react";
import {RefreshCw, Search} from "lucide-react";
import {cn} from "./lib/cn";
import {displayName} from "./lib/state";
import {ErrorBanner, Loading} from "./shared";
import {ActivityWidget} from "./widgets/ActivityWidget";
import {ApiError, invoke} from "./lib/api";

type StatusFilter = "all" | "ok" | "failed";

export function ActivityView() {
  const [payload, setPayload] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(200);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [switchFilter, setSwitchFilter] = useState<string>("all");

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const res = await invoke("get_mutation_history", {limit});
      setPayload(res?.result?.payload ?? null);
    } catch (e: any) {
      setErr(e instanceof ApiError ? `${e.status}: ${e.message}` : (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // refresh is a stable fetch closure — deliberately excluded to avoid
    // re-running on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  // Unique lists for the tool + switch dropdowns — drawn from the
  // currently loaded entries, not the full catalog, so the menus only
  // show things that actually appear in the ledger.
  const toolOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of payload?.entries ?? []) if (e.tool) set.add(e.tool);
    return Array.from(set).sort();
  }, [payload]);
  const switchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of payload?.entries ?? []) if (e.switch_ip) set.add(e.switch_ip);
    return Array.from(set).sort();
  }, [payload]);

  // Filtered payload for the widget. We keep the shape intact so
  // ActivityWidget doesn't need to know about filters — just hand it a
  // narrower `entries` array and a re-computed summary.
  const filteredPayload = useMemo(() => {
    if (!payload) return null;
    const q = search.trim().toLowerCase();
    const entries = (payload.entries ?? []).filter((e: any) => {
      if (status !== "all" && e.status !== status) return false;
      if (toolFilter !== "all" && e.tool !== toolFilter) return false;
      if (switchFilter !== "all" && e.switch_ip !== switchFilter) return false;
      if (q) {
        const hay = [
          e.tool, e.switch_ip, e.mutation_id, e.status, e.risk,
          JSON.stringify(e.inputs ?? {}),
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Recompute a minimal summary so ActivityWidget's counts reflect the filter.
    const by_tool: Record<string, number> = {};
    const by_status: Record<string, number> = {ok: 0, failed: 0};
    for (const e of entries) {
      by_tool[e.tool ?? "unknown"] = (by_tool[e.tool ?? "unknown"] ?? 0) + 1;
      by_status[e.status ?? "unknown"] = (by_status[e.status ?? "unknown"] ?? 0) + 1;
    }
    return {
      ...payload,
      summary: {...(payload.summary ?? {}), count: entries.length, by_tool, by_status},
      entries,
    };
  }, [payload, search, status, toolFilter, switchFilter]);

  const totalLoaded = payload?.entries?.length ?? 0;
  const shown = filteredPayload?.entries?.length ?? 0;
  const filterActive = search.trim() || status !== "all" || toolFilter !== "all" || switchFilter !== "all";

  function clearFilters() {
    setSearch(""); setStatus("all"); setToolFilter("all"); setSwitchFilter("all");
  }

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Activity</h1>
          <p className="mt-2 text-sm text-gray-400">
            Server-side invocation ledger. Every MUTATION / DESTRUCTIVE invocation is recorded here with pre/post state.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <select
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value, 10))}
            className="h-9 cursor-pointer rounded-md border border-white/10 bg-[#0d1220] px-3 text-sm text-gray-300 hover:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value={50}>50 entries</option>
            <option value={100}>100 entries</option>
            <option value={200}>200 entries</option>
            <option value={500}>500 entries</option>
          </select>
          <button
            onClick={refresh}
            disabled={busy}
            title="Re-fetch the mutation ledger"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-gray-300 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Search + filter strip — only enabled once data is loaded. */}
      {payload && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.08] bg-[#1a2332] p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search by tool / switch / mutation_id / inputs…"
              className="h-8 w-full rounded border border-white/10 bg-[#0d1220] pl-8 pr-3 text-sm text-gray-200 placeholder:text-gray-500 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20"
            />
          </div>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="h-8 cursor-pointer rounded border border-white/10 bg-[#0d1220] px-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="all">status: any</option>
            <option value="ok">status: ok</option>
            <option value="failed">status: failed</option>
          </select>

          <select
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
            className="h-8 cursor-pointer rounded border border-white/10 bg-[#0d1220] px-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="all">tool: any</option>
            {toolOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <select
            value={switchFilter}
            onChange={(e) => setSwitchFilter(e.target.value)}
            className="h-8 cursor-pointer rounded border border-white/10 bg-[#0d1220] px-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value="all">switch: any</option>
            {switchOptions.map((ip) => (
              <option key={ip} value={ip}>{displayName(ip)} ({ip})</option>
            ))}
          </select>

          <div className={cn(
            "ml-auto flex items-center gap-2 text-xs",
            filterActive ? "text-yellow-300" : "text-gray-500",
          )}>
            <span>showing {shown}/{totalLoaded}</span>
            {filterActive && (
              <button
                onClick={clearFilters}
                className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-gray-300 hover:bg-white/[0.08]"
              >clear</button>
            )}
          </div>
        </div>
      )}

      {err && <div className="mb-4"><ErrorBanner>{err}</ErrorBanner></div>}

      {!payload && !err ? (
        <div className="rounded-lg border border-white/[0.08] bg-[#1a2332] p-8">
          <Loading label="loading mutation ledger…" />
        </div>
      ) : filteredPayload ? (
        <ActivityWidget payload={filteredPayload} />
      ) : null}
    </div>
  );
}
