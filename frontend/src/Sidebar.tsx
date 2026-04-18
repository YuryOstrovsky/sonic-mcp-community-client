/**
 * Left-rail navigation. Icon + label + sublabel per the Figma Core_UI spec.
 */

import {Activity, Layout, Network, Settings, Terminal, Wrench, type LucideIcon} from "lucide-react";
import {cn} from "./lib/cn";

export type ViewId = "dashboard" | "fabric" | "console" | "tools" | "activity" | "settings";

const NAV: {id: ViewId; label: string; icon: LucideIcon; hint: string}[] = [
  {id: "dashboard", label: "Dashboard",  icon: Layout,   hint: "At-a-glance health"},
  {id: "fabric",    label: "Fabric",     icon: Network,  hint: "Topology + link health"},
  {id: "console",   label: "AI Console", icon: Terminal, hint: "Natural language"},
  {id: "tools",     label: "Tools",      icon: Wrench,   hint: "Tool catalog + invoke"},
  {id: "activity",  label: "Activity",   icon: Activity, hint: "Mutation audit log"},
  {id: "settings",  label: "Settings",   icon: Settings, hint: "LLM + persistence"},
];

export function Sidebar(props: {current: ViewId; onChange: (v: ViewId) => void}) {
  return (
    <aside className="flex w-64 flex-shrink-0 flex-col border-r border-white/[0.06] bg-[#0d1220] p-4">
      <div className="mb-6 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500">
        Navigation
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = n.id === props.current;
          return (
            <button
              key={n.id}
              onClick={() => props.onChange(n.id)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                active
                  ? "bg-[#1a2332] text-gray-100"
                  : "text-gray-300 hover:bg-[#1a2332]/50",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 h-5 w-5 flex-shrink-0",
                  active ? "text-gray-200" : "text-gray-400",
                )}
              />
              <div>
                <div className={cn("text-sm", active ? "font-semibold" : "font-medium")}>
                  {n.label}
                </div>
                <div className="text-xs text-gray-500">{n.hint}</div>
              </div>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="border-t border-white/[0.06] px-3 pt-4 text-[11px] leading-tight text-gray-500">
        SONiC MCP Community
        <br />
        Client
      </div>
    </aside>
  );
}
