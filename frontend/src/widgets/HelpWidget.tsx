/**
 * Widget for the "help" pseudo-tool (resolved by the client backend, not MCP).
 *
 * Renders context-aware help:
 *   - Service / lab state banner
 *   - Your lab (real device list with reachability pills)
 *   - Try asking (contextual examples with real device names)
 *   - Tool catalog grouped by category
 *   - Tips
 *
 * Clicking an example or a tool description dispatches a custom event
 * ("sonic-mcp:submit-prompt") that ConsoleView listens for — lets the
 * user try things in one click without leaving the help view.
 */

import {useState} from "react";
import {FG} from "../lib/figmaStyles";
import {displayName, loadSelectedSwitch} from "../lib/state";
import {Badge, StatusPill} from "../shared";
import {Section} from "./common";

type Device = {switch_ip: string; restconf_ok: boolean; ssh_ok: boolean};

type ToolEntry = {
  name: string;
  description: string;
  transport: string;
  risk: string;
  required_inputs: string[];
};

export const SUBMIT_PROMPT_EVENT = "sonic-mcp:submit-prompt";

function fireSubmit(prompt: string) {
  window.dispatchEvent(new CustomEvent(SUBMIT_PROMPT_EVENT, {detail: prompt}));
}

// Map each tool to a canonical natural-language query the NL router can
// route back to it. Tools that need extra input beyond switch_ip (e.g.
// run_show_command wants a `command`) have null and get a "—" placeholder
// instead of a Run button. `help` runs lab-wide, `_all` tools too.
const TOOL_TO_QUERY: Record<string, (switchAlias: string) => string | null> = {
  // Single-device tools — use selected switch alias
  get_interfaces:          (s) => `show interfaces on ${s}`,
  get_ip_interfaces:       (s) => `show ip interfaces on ${s}`,
  get_routes:              (s) => `show routes on ${s}`,
  get_ipv6_routes:         (s) => `show ipv6 routes on ${s}`,
  get_bgp_summary:         (s) => `show bgp summary on ${s}`,
  get_lldp_neighbors:      (s) => `show lldp neighbors on ${s}`,
  get_system_info:         (s) => `system info for ${s}`,
  get_vlans:               (s) => `show vlans on ${s}`,
  get_arp_table:           (s) => `show arp on ${s}`,
  get_portchannels:        (s) => `show portchannels on ${s}`,
  get_platform_detail:     (s) => `show platform detail on ${s}`,
  get_sflow_status:        (s) => `show sflow on ${s}`,
  // Multi-device fan-out tools — no switch needed
  get_system_info_all:     () => "system info for all switches",
  get_interfaces_all:      () => "show interfaces on all switches",
  get_bgp_summary_all:     () => "show bgp summary on all switches",
  get_routes_all:          () => "show routes on all switches",
  get_lldp_neighbors_all:  () => "show lldp neighbors on all switches",
  get_vlans_all:           () => "show vlans on all switches",
  // Mutation tools
  config_save:                (s) => `save config on ${s}`,
  get_mutation_history:       () => "show mutation history",
  clear_interface_counters:   (s) => `clear counters on ${s}`,
  // Mutation tools with fixed test targets — Ethernet12 is a known-safe
  // non-production interface on our lab VMs, vlan 250 is unused.
  set_interface_admin_status: (s) => `shutdown Ethernet12 on ${s}`,
  set_interface_mtu:          (s) => `set mtu of Ethernet12 to 9000 on ${s}`,
  add_vlan:                   (s) => `add vlan 250 on ${s}`,
  remove_vlan:                (s) => `remove vlan 250 on ${s}`,
  // Fabric reads (no switch_ip needed — they span the inventory)
  get_fabric_topology:        () => "fabric topology",
  get_fabric_health:          () => "fabric health",
  get_fabric_reachability_matrix: () => "reachability matrix",
  get_fabric_mtu_consistency:     () => "mtu consistency",
  get_fabric_bandwidth:           () => "fabric bandwidth",
  validate_fabric_vs_intent:      () => "validate fabric",
  ping_between:               (s) => `ping vm2 from ${s}`,
  traceroute_between:         (s) => `traceroute vm2 from ${s}`,
  // Two-switch diff — pick vm1 and vm2 explicitly so NL extracts left/right.
  get_fabric_config_diff:     () => "diff config of vm1 and vm2",
  // Drain/undrain target the currently-selected switch.
  drain_switch:               (s) => `drain ${s}`,
  undrain_switch:             (s) => `undrain ${s}`,
  // Fabric/L3 mutations — lab-safe demo values. The confirmation modal
  // pops with these pre-filled; users can edit (or just confirm to try).
  // These targets are either no-ops or trivially reversible on the VS lab.
  set_ip_interface:           (s) => `add ip 192.168.99.1/30 to Ethernet64 on ${s}`,
  add_static_route:           (s) => `add route 198.51.100.0/24 via 10.0.0.33 on ${s}`,
  remove_static_route:        (s) => `remove route 198.51.100.0/24 on ${s}`,
  set_bgp_neighbor_admin:     (s) => `shutdown bgp peer 192.168.1.2 on ${s}`,
  set_portchannel_member:     (s) => `add Ethernet64 to PortChannel1 on ${s}`,
  // Phase 5d — operator-grade + L2 / snapshot / rollback tools
  iperf_between:              (s) => `iperf vm2 from ${s}`,
  get_routes_by_prefix:       () => "who has 10.0.0.0/31",
  save_fabric_snapshot:       () => "take fabric snapshot named preflight",
  restore_fabric_snapshot:    () => "restore snapshot preflight skip reload",
  compare_fabric_snapshots:   () => "compare snapshots cmp_a and cmp_b",
  fabric_drain_rotate:        () => "rolling drain maintenance",
  detect_routing_loop:        () => "detect routing loops",
  get_mac_table:              (s) => `show mac table on ${s}`,
  get_mac_table_all:          () => "mac table on all switches",
  get_arp_table_all:          () => "arp on all switches",
  // rollback_mutation: route with no id — the confirm modal's combobox
  // pulls the last 20 mutation_ids from the ledger so the user picks one.
  rollback_mutation:          () => "undo last mutation",
  // set_interface_description: a lab-safe demo description. The modal's
  // combobox lists every interface on the target switch; user can edit
  // both the interface name and the description text before confirming.
  set_interface_description:  (s) => `set description Ethernet12 "MCP demo" on ${s}`,
  // run_show_command routes via the "show …" escape hatch — SAFE_READ,
  // runs directly without a modal. `show version` is universal + harmless.
  run_show_command:           (s) => `show version on ${s}`,
  help:                       () => "help",
};

function queryForTool(tool: string, fallbackSwitch: string): string | null {
  const fn = TOOL_TO_QUERY[tool];
  if (!fn) return null;
  return fn(fallbackSwitch);
}

export function HelpWidget({payload}: {payload: any}) {
  const svc = payload?.service ?? {};
  const devices: Device[] = payload?.devices ?? [];
  const byCategory: Record<string, ToolEntry[]> = payload?.tools_by_category ?? {};
  const examples: string[] = payload?.contextual_examples ?? [];
  const tips: Array<string | {text: string; try?: string | null}> = payload?.tips ?? [];

  return (
    <div>
      {/* Intro banner */}
      <div style={{
        background: "var(--bg0)",
        border: `1px solid ${FG.rowSelectedBorder}`,
        borderRadius: 10,
        padding: "14px 18px",
        marginBottom: 14,
      }}>
        <div style={{
          fontSize: 11,
          color: FG.mutedColor,
          textTransform: "uppercase",
          letterSpacing: 1,
        }}>Help</div>
        <h3 style={{margin: "6px 0 4px", color: FG.titleColor, fontSize: 18}}>
          {svc.name ?? "SONiC MCP Community Client"}
        </h3>
        <div style={{color: FG.bodyColor, fontSize: 13, lineHeight: 1.5}}>
          Ask questions in plain English. I route the question to the right SONiC tool,
          invoke it against your chosen switch, and render the result as a widget.
        </div>
        <div style={{display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10}}>
          <Badge>phase {svc.phase ?? "?"}</Badge>
          <Badge>upstream {svc.mcp_base_url ?? "—"}</Badge>
          <StatusPill tone={svc.ready_status === "ready" ? "good" : "warn"}>
            {svc.ready_status ?? "unknown"}
          </StatusPill>
          <Badge>{svc.device_count ?? 0} devices</Badge>
          <Badge>{svc.tool_count ?? 0} tools</Badge>
        </div>
      </div>

      {/* Your lab */}
      <Section title="Your lab">
        {devices.length === 0 ? (
          <div style={{color: FG.mutedColor, fontSize: 13}}>
            No devices reported by <code>/ready</code>.
          </div>
        ) : (
          <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10}}>
            {devices.map((d) => {
              const both = d.restconf_ok && d.ssh_ok;
              return (
                <div key={d.switch_ip} style={{
                  border: `1px solid ${both ? FG.successBorder : FG.warningBorder}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: FG.subtleBg,
                }}>
                  <div style={{display: "flex", alignItems: "baseline", justifyContent: "space-between"}}>
                    <span style={{fontWeight: 600, color: FG.titleColor, fontSize: 15}}>{displayName(d.switch_ip)}</span>
                    <code style={{color: FG.mutedColor, fontSize: 11}}>{d.switch_ip}</code>
                  </div>
                  <div style={{display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap"}}>
                    <StatusPill tone={d.restconf_ok ? "good" : "bad"}>RESTCONF</StatusPill>
                    <StatusPill tone={d.ssh_ok ? "good" : "bad"}>SSH</StatusPill>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Try asking */}
      <Section title="Try asking">
        <div style={{display: "flex", flexWrap: "wrap", gap: 6}}>
          {examples.map((ex) => (
            <button
              key={ex}
              onClick={() => fireSubmit(ex)}
              style={{
                padding: "6px 12px",
                border: `1px solid ${FG.rowDefaultBorder}`,
                background: "transparent",
                color: FG.bodyColor,
                borderRadius: 999,
                fontSize: 12,
                cursor: "pointer",
                transition: FG.transition,
              }}
              onMouseEnter={(e) => {e.currentTarget.style.borderColor = FG.rowHoverBorder; e.currentTarget.style.background = FG.rowHoverBg;}}
              onMouseLeave={(e) => {e.currentTarget.style.borderColor = FG.rowDefaultBorder; e.currentTarget.style.background = "transparent";}}
              title="click to submit"
            >{ex}</button>
          ))}
        </div>
      </Section>

      {/* Tool catalog — collapsible per-category sections with Run buttons */}
      <Section title={`Tool catalog (${svc.tool_count ?? 0})`}>
        {Object.keys(byCategory).length === 0 ? (
          <div style={{color: FG.mutedColor, fontSize: 13}}>No tools discovered.</div>
        ) : (
          <div style={{display: "flex", flexDirection: "column", gap: 8}}>
            {Object.entries(byCategory).map(([cat, list]) => (
              <CategoryDropdown key={cat} category={cat} tools={list} devices={devices} />
            ))}
          </div>
        )}
      </Section>

      {/* Tips — each optionally has a clickable "try it" prompt. (Full tip rendering below.) */}
      <Section title="Tips">
        <ol style={{margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8}}>
          {tips.map((t, i) => {
            const text = typeof t === "string" ? t : (t?.text ?? "");
            const tryIt = typeof t === "string" ? null : (t?.try ?? null);
            return (
              <li key={i} style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                padding: "8px 10px",
                background: FG.subtleBg,
                border: `1px solid ${FG.subtleBorder}`,
                borderRadius: 8,
              }}>
                <span style={{
                  fontSize: 11,
                  color: FG.mutedColor,
                  fontFamily: "ui-monospace, monospace",
                  marginTop: 2,
                  flexShrink: 0,
                  minWidth: 14,
                  textAlign: "right",
                }}>{i + 1}.</span>
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{fontSize: 13, color: FG.bodyColor, lineHeight: 1.5}}>{text}</div>
                  {tryIt && (
                    <div style={{marginTop: 6}}>
                      <button
                        onClick={() => fireSubmit(tryIt)}
                        style={{
                          padding: "4px 10px",
                          border: `1px solid ${FG.btnPrimaryBorder}`,
                          background: "rgba(234,88,12,0.12)",
                          color: "#f97316",
                          borderRadius: 6,
                          fontSize: 12,
                          fontFamily: "ui-monospace, monospace",
                          cursor: "pointer",
                          transition: FG.transition,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                        onMouseEnter={(e) => {e.currentTarget.style.background = FG.btnPrimaryBg; e.currentTarget.style.color = "#fff";}}
                        onMouseLeave={(e) => {e.currentTarget.style.background = "rgba(234,88,12,0.12)"; e.currentTarget.style.color = "#f97316";}}
                        title="click to submit this query"
                      >
                        <span>▶</span>
                        <span>try: {tryIt}</span>
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>
    </div>
  );
}

// ─── Category dropdown (collapsible tool list) ────────────────────
function CategoryDropdown({category, tools, devices}: {
  category: string;
  tools: ToolEntry[];
  devices: Device[];
}) {
  const [open, setOpen] = useState(false);

  // Pick the switch for generated queries:
  //   1. user's saved selection (top-bar picker)
  //   2. first reachable device from /ready
  //   3. literal "vm1" fallback
  const savedIp = loadSelectedSwitch();
  const firstReachable = devices.find((d) => d.restconf_ok || d.ssh_ok);
  const effectiveIp = savedIp || firstReachable?.switch_ip || "";
  const effectiveAlias = effectiveIp ? displayName(effectiveIp) : "vm1";

  return (
    <div style={{
      background: "var(--bg0)",
      border: `1px solid ${FG.divider}`,
      borderRadius: 10,
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: FG.bodyColor,
          transition: FG.transition,
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = FG.rowHoverBg}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        <div style={{display: "flex", alignItems: "center", gap: 10}}>
          <span style={{
            color: FG.mutedColor,
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            width: 12,
            textAlign: "center",
          }}>{open ? "▾" : "▸"}</span>
          <span style={{
            fontSize: 12,
            color: FG.titleColor,
            textTransform: "uppercase",
            letterSpacing: 1,
            fontWeight: 600,
          }}>{category}</span>
          <Badge>{tools.length}</Badge>
        </div>
        <span style={{fontSize: 11, color: FG.mutedColor}}>
          {open ? "click to collapse" : "click to expand"}
        </span>
      </button>

      {open && (
        <div style={{
          padding: "0 10px 10px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          borderTop: `1px solid ${FG.divider}`,
        }}>
          {tools.map((t) => (
            <ToolCard
              key={t.name}
              tool={t}
              effectiveAlias={effectiveAlias}
              effectiveIp={effectiveIp}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCard({tool: t, effectiveAlias, effectiveIp}: {
  tool: ToolEntry;
  effectiveAlias: string;
  effectiveIp: string;
}) {
  const query = queryForTool(t.name, effectiveAlias);
  const canRun = !!query;
  const needsSwitch = t.required_inputs?.includes("switch_ip");

  return (
    <div style={{
      background: FG.subtleBg,
      border: `1px solid ${FG.subtleBorder}`,
      borderRadius: 8,
      padding: "8px 10px",
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
    }}>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          flexWrap: "wrap",
        }}>
          <code style={{fontWeight: 600, color: FG.titleColor, fontSize: 12.5}}>{t.name}</code>
          <Badge>{t.transport}</Badge>
          {t.required_inputs?.length > 0 && (
            <Badge title="required inputs">
              {t.required_inputs.join(", ")}
            </Badge>
          )}
        </div>
        <div style={{fontSize: 12, color: FG.bodyColor, lineHeight: 1.45, marginTop: 4}}>
          {t.description}
        </div>
      </div>
      <div style={{flexShrink: 0}}>
        {canRun ? (
          <button
            onClick={() => fireSubmit(query!)}
            title={
              needsSwitch
                ? `run against ${effectiveAlias} (${effectiveIp})`
                : "run"
            }
            style={{
              padding: "5px 12px",
              border: `1px solid ${FG.btnPrimaryBorder}`,
              background: "rgba(234,88,12,0.12)",
              color: "#f97316",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: FG.transition,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {e.currentTarget.style.background = FG.btnPrimaryBg; e.currentTarget.style.color = "#fff";}}
            onMouseLeave={(e) => {e.currentTarget.style.background = "rgba(234,88,12,0.12)"; e.currentTarget.style.color = "#f97316";}}
          >▶ Run</button>
        ) : (
          <span title="tool needs extra inputs — configure in the Tools view" style={{
            color: FG.dimColor,
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            padding: "5px 8px",
          }}>needs inputs →</span>
        )}
      </div>
    </div>
  );
}
