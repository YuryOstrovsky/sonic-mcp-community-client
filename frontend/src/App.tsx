/**
 * Application shell: header with switch picker, left sidebar, main view area.
 *
 * Views are plain components — no router dep. View state lives here and
 * is passed down. /api/ready + /api/tools + /api/health are fetched once
 * on mount and shared across views.
 */

import {useEffect, useState} from "react";
import {FG} from "./lib/figmaStyles";
import {displayName, loadSelectedSwitch, saveSelectedSwitch} from "./lib/state";
import {Sidebar, type ViewId} from "./Sidebar";
import {SwitchPicker} from "./SwitchPicker";
import {Dashboard} from "./Dashboard";
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

  // Initial fetch
  useEffect(() => {
    (async () => {
      try {
        const [h, r, t] = await Promise.all([getHealth(), getReady(), getTools()]);
        setHealth(h);
        setReady(r);
        setTools(t);
        // If nothing saved yet, default to the first reachable device.
        if (!selectedSwitch) {
          const devices: Record<string, any> = r?.body?.checks?.devices ?? {};
          const firstReachable = Object.entries(devices).find(([_ip, s]: any) => s?.restconf || s?.ssh)?.[0] as string | undefined;
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

  function onSwitchChange(ip: string | null) {
    setSelectedSwitch(ip);
    saveSelectedSwitch(ip);
  }

  async function refreshReady() {
    try {
      const r = await getReady();
      setReady(r);
    } catch { /* swallow; error already visible on dashboard */ }
  }

  return (
    <div style={{
      display: "flex",
      minHeight: "100vh",
      background: "var(--bg0)",
      color: FG.bodyColor,
      fontFamily: 'Source Sans Pro, system-ui, sans-serif',
    }}>
      <Sidebar current={view} onChange={setView} />

      <main style={{
        flex: 1,
        minWidth: 0,
        // CRITICAL: clip anything that tries to escape the visible area to the right.
        // Without this, wide table widgets / long flex rows push content past the
        // viewport edge, because min-width: 0 on the flex item alone doesn't force
        // descendants to honour the cap.
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Top bar */}
        <header style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          borderBottom: FG.headerBorderBottom,
          background: FG.containerBg,
          flexShrink: 0,
        }}>
          <div>
            <div style={{
              fontSize: 16,
              fontWeight: 600,
              color: FG.titleColor,
              letterSpacing: 0.3,
            }}>
              SONiC MCP Community Client
            </div>
            <div style={{fontSize: 11, color: FG.mutedColor}}>
              {health?.upstream?.base_url ? `upstream: ${health.upstream.base_url}` : "booting…"}
              {selectedSwitch && ` · target: ${displayName(selectedSwitch)} (${selectedSwitch})`}
            </div>
          </div>
          <div style={{display: "flex", alignItems: "center", gap: 12}}>
            <LlmStatus onOpenSettings={() => setView("settings")} />
            <button
              onClick={refreshReady}
              title="Re-probe /ready"
              style={{
                background: "transparent",
                border: `1px solid ${FG.btnSecondaryBorder}`,
                color: FG.btnSecondaryColor,
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >↻ refresh</button>
            <SwitchPicker ready={ready} selected={selectedSwitch} onChange={onSwitchChange} />
          </div>
        </header>

        {/* Content */}
        <div style={{
          flex: 1,
          padding: 24,
          minWidth: 0,
          minHeight: 0,
          overflow: "auto",
        }}>
          {bootErr && (
            <div style={{marginBottom: 16}}>
              <ErrorBanner>
                Boot error: {bootErr}. The backend may not be running or MCP_BASE_URL is
                unreachable. See backend logs.
              </ErrorBanner>
            </div>
          )}

          {view === "dashboard" && (
            <Dashboard
              ready={ready}
              health={health}
              tools={tools}
              selectedSwitch={selectedSwitch}
            />
          )}

          {view === "console" && (
            <ConsoleView selectedSwitch={selectedSwitch} tools={tools} />
          )}

          {view === "tools" && (
            <ToolsView
              tools={tools}
              selectedSwitch={selectedSwitch}
            />
          )}

          {view === "activity" && (
            <ActivityView />
          )}

          {view === "settings" && (
            <SettingsView />
          )}
        </div>
      </main>
    </div>
  );
}
