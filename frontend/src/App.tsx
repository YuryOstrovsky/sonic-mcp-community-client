/**
 * Application shell: left sidebar + top header + view area.
 *
 * Views are plain components — no router. /api/ready + /api/tools + /api/health
 * are fetched once on mount and passed down.
 */

import {useEffect, useState} from "react";
import {RefreshCw} from "lucide-react";
import {Toaster} from "sonner";
import {displayName, loadSelectedSwitch, saveSelectedSwitch} from "./lib/state";
import {Sidebar, type ViewId} from "./Sidebar";
import {SwitchPicker} from "./SwitchPicker";
import {CommandPalette} from "./CommandPalette";
import {Dashboard} from "./Dashboard";
import {FabricView} from "./FabricView";
import {HealthBadge} from "./HealthBadge";
import {ConsoleView} from "./ConsoleView";
import {ToolsView} from "./ToolsView";
import {SettingsView} from "./SettingsView";
import {ActivityView} from "./ActivityView";
import {ErrorBanner} from "./shared";
import {LlmStatus} from "./LlmStatus";
import {getHealth, getReady, getTools, type ToolSpec} from "./lib/api";
import "./App.css";

export default function App() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [selectedSwitch, setSelectedSwitch] = useState<string | null>(loadSelectedSwitch());
  const [ready, setReady] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [tools, setTools] = useState<ToolSpec[] | null>(null);
  const [bootErr, setBootErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped on every header-refresh click. Views that own their own async
  // data (e.g. PerSwitchSummary's 4 fanouts) watch this to re-fetch.
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [h, r, t] = await Promise.all([getHealth(), getReady(), getTools()]);
        setHealth(h);
        setReady(r);
        setTools(t);
        if (!selectedSwitch) {
          const devices: Record<string, any> = r?.body?.checks?.devices ?? {};
          const firstReachable = Object.entries(devices).find(([, s]: [string, any]) => s?.restconf || s?.ssh)?.[0] as string | undefined;
          if (firstReachable) {
            setSelectedSwitch(firstReachable);
            saveSelectedSwitch(firstReachable);
          }
        }
      } catch (e: any) {
        setBootErr(e?.message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global "open the Fabric view" event — dispatched by FabricTopologyWidget.
  useEffect(() => {
    const handler = () => setView("fabric");
    window.addEventListener("sonic-mcp:open-fabric", handler);
    return () => window.removeEventListener("sonic-mcp:open-fabric", handler);
  }, []);

  // Generic "open <view-id>" event — used by the error card's "activity"
  // button and potentially any future deep-link.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === "string") setView(id as ViewId);
    };
    window.addEventListener("sonic-mcp:open-view", handler);
    return () => window.removeEventListener("sonic-mcp:open-view", handler);
  }, []);

  function onSwitchChange(ip: string | null) {
    setSelectedSwitch(ip);
    saveSelectedSwitch(ip);
  }

  async function refreshReady() {
    setRefreshing(true);
    // Tell views that own their own async data to re-fetch too.
    setRefreshKey((n) => n + 1);
    try {
      // Re-pull everything the shell exposes — not just /ready — so the
      // Tools count, LLM pill, and upstream version line all stay in sync.
      const [h, r, t] = await Promise.all([getHealth(), getReady(), getTools()]);
      setHealth(h);
      setReady(r);
      setTools(t);
    } catch {/* swallow */}
    finally {
      // Keep the spin visible for at least ~400 ms so fast refreshes still
      // register as a visible click.
      setTimeout(() => setRefreshing(false), 400);
    }
  }

  return (
    <div className="flex h-screen bg-[#0a0e1a] text-gray-200">
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "#1a2332",
            border: "1px solid rgba(255,255,255,0.10)",
            color: "#e5e7eb",
          },
        }}
      />
      <CommandPalette
        tools={tools}
        devices={Object.keys(ready?.body?.checks?.devices ?? {})}
        selectedSwitch={selectedSwitch}
        onOpenView={setView}
        onSelectSwitch={onSwitchChange}
      />
      <Sidebar current={view} onChange={setView} />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0d1220] px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-100">
              SONiC MCP Community Client
            </h1>
            <p className="mt-0.5 text-xs text-gray-400">
              {health?.upstream?.base_url ? `upstream: ${health.upstream.base_url}` : "booting…"}
              {selectedSwitch && ` · target: ${displayName(selectedSwitch)} (${selectedSwitch})`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LlmStatus onOpenSettings={() => setView("settings")} />
            <HealthBadge onTick={refreshReady} />
            <button
              onClick={refreshReady}
              disabled={refreshing}
              title="Re-fetch /ready, /health, and the tool catalog"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-gray-300 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <SwitchPicker ready={ready} selected={selectedSwitch} onChange={onSwitchChange} />
          </div>
        </header>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto p-6">
          {bootErr && (
            <div className="mb-4">
              <ErrorBanner>
                Boot error: {bootErr}. The backend may not be running or MCP_BASE_URL is
                unreachable. See backend logs.
              </ErrorBanner>
            </div>
          )}

          {view === "dashboard" && (
            <Dashboard ready={ready} health={health} tools={tools} selectedSwitch={selectedSwitch} refreshKey={refreshKey} />
          )}
          {view === "fabric" && <FabricView refreshKey={refreshKey} />}
          {view === "console" && (
            <ConsoleView selectedSwitch={selectedSwitch} tools={tools} />
          )}
          {view === "tools" && (
            <ToolsView tools={tools} selectedSwitch={selectedSwitch} />
          )}
          {view === "activity" && <ActivityView />}
          {view === "settings" && <SettingsView />}
        </div>
      </main>
    </div>
  );
}
