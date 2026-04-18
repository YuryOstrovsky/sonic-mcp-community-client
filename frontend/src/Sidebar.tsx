/**
 * Left-rail navigation for the three core views: Dashboard, Console, Tools.
 */

import {FG} from "./lib/figmaStyles";

export type ViewId = "dashboard" | "console" | "tools" | "activity" | "settings";

const NAV: {id: ViewId; label: string; icon: string; hint: string}[] = [
  {id: "dashboard", label: "Dashboard", icon: "▤", hint: "At-a-glance health"},
  {id: "console",   label: "AI Console", icon: "◈", hint: "Natural language"},
  {id: "tools",     label: "Tools",      icon: "▦", hint: "Tool catalog + invoke"},
  {id: "activity",  label: "Activity",   icon: "⟳", hint: "Mutation audit log"},
  {id: "settings",  label: "Settings",   icon: "⚙", hint: "LLM + persistence"},
];

export function Sidebar(props: {
  current: ViewId;
  onChange: (v: ViewId) => void;
}) {
  return (
    <aside style={{
      width: 220,
      flex: "0 0 220px",
      background: FG.containerBg,
      borderRight: `1px solid ${FG.containerBorder}`,
      padding: "20px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}>
      <div style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 1.2,
        color: FG.mutedColor,
        margin: "4px 8px 12px",
      }}>
        Navigation
      </div>
      {NAV.map((n) => {
        const active = n.id === props.current;
        return (
          <button
            key={n.id}
            onClick={() => props.onChange(n.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              border: "1px solid",
              borderColor: active ? FG.rowSelectedBorder : "transparent",
              borderRadius: 8,
              background: active ? FG.rowSelectedBg : "transparent",
              color: active ? FG.titleColor : FG.bodyColor,
              textAlign: "left",
              cursor: "pointer",
              transition: FG.transition,
              fontSize: 14,
              fontWeight: active ? 600 : 500,
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget.style.background = FG.rowHoverBg);
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget.style.background = "transparent");
            }}
          >
            <span style={{width: 18, textAlign: "center", color: active ? FG.titleColor : FG.mutedColor}}>
              {n.icon}
            </span>
            <div style={{display: "flex", flexDirection: "column"}}>
              <span>{n.label}</span>
              <span style={{fontSize: 11, color: FG.mutedColor, fontWeight: 400}}>{n.hint}</span>
            </div>
          </button>
        );
      })}

      <div style={{flex: 1}} />

      <div style={{
        fontSize: 11,
        color: FG.dimColor,
        padding: "8px 12px",
        borderTop: `1px solid ${FG.divider}`,
        marginTop: 12,
      }}>
        SONiC MCP Community<br />Phase B
      </div>
    </aside>
  );
}
