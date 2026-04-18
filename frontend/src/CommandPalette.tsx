/**
 * Command Palette — Cmd/Ctrl+K opens a fuzzy-search overlay of every
 * tool in the catalog plus a few built-in actions (switch selector, view
 * navigation, help). Enter on a tool = submit a reasonable default
 * prompt to the NL router, which routes through the regular flow
 * (confirmation modal for mutations, widget render for reads).
 *
 * Design notes:
 *   - cmdk handles the keyboard / focus / fuzzy filtering; we just feed it
 *     items and handle `onSelect`.
 *   - Tool items reuse the same prompt strings HelpWidget emits, so the
 *     user gets the same "pre-filled modal" behavior they know from Help.
 *   - View-navigation items jump to Dashboard / Fabric / etc.
 *   - Switch items change the global selected switch.
 */

import {useEffect, useMemo, useState} from "react";
import {Command} from "cmdk";
import {displayName} from "./lib/state";
import {SUBMIT_PROMPT_EVENT} from "./widgets/HelpWidget";
import type {ToolSpec} from "./lib/api";
import type {ViewId} from "./Sidebar";

// Lab-safe default prompts for every tool — mirrors HelpWidget's
// TOOL_TO_QUERY map so the palette feels consistent with Help. Null
// means "drive from the Tools view" (requires arbitrary input).
// Keeping this here (not imported from HelpWidget) avoids a circular
// import; duplication is ~30 lines and worth it.
type PromptFn = (switchAlias: string) => string | null;

const PALETTE_PROMPTS: Record<string, PromptFn> = {
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
  get_mac_table:           (s) => `show mac table on ${s}`,
  get_system_info_all:     () => "system info for all switches",
  get_interfaces_all:      () => "show interfaces on all switches",
  get_bgp_summary_all:     () => "show bgp summary on all switches",
  get_routes_all:          () => "show routes on all switches",
  get_lldp_neighbors_all:  () => "show lldp neighbors on all switches",
  get_vlans_all:           () => "show vlans on all switches",
  get_arp_table_all:       () => "arp on all switches",
  get_mac_table_all:       () => "mac table on all switches",
  get_fabric_topology:     () => "fabric topology",
  get_fabric_health:       () => "fabric health",
  get_fabric_reachability_matrix: () => "reachability matrix",
  get_fabric_mtu_consistency:     () => "mtu consistency",
  get_fabric_bandwidth:           () => "fabric bandwidth",
  validate_fabric_vs_intent:      () => "validate fabric",
  get_fabric_config_diff:  () => "diff config of vm1 and vm2",
  ping_between:            (s) => `ping vm2 from ${s}`,
  traceroute_between:      (s) => `traceroute vm2 from ${s}`,
  iperf_between:           (s) => `iperf vm2 from ${s}`,
  get_routes_by_prefix:    () => "who has 10.0.0.0/31",
  detect_routing_loop:     () => "detect routing loops",
  save_fabric_snapshot:    () => "take fabric snapshot named preflight",
  restore_fabric_snapshot: () => "restore snapshot preflight skip reload",
  fabric_drain_rotate:     () => "rolling drain maintenance",
  config_save:             (s) => `save config on ${s}`,
  get_mutation_history:    () => "show mutation history",
  clear_interface_counters:(s) => `clear counters on ${s}`,
  set_interface_admin_status: (s) => `shutdown Ethernet12 on ${s}`,
  set_interface_mtu:          (s) => `set mtu of Ethernet12 to 9000 on ${s}`,
  set_interface_description:  (s) => `set description Ethernet12 "MCP demo" on ${s}`,
  add_vlan:                (s) => `add vlan 250 on ${s}`,
  remove_vlan:             (s) => `remove vlan 250 on ${s}`,
  set_ip_interface:        (s) => `add ip 192.168.99.1/30 to Ethernet64 on ${s}`,
  add_static_route:        (s) => `add route 198.51.100.0/24 via 10.0.0.33 on ${s}`,
  remove_static_route:     (s) => `remove route 198.51.100.0/24 on ${s}`,
  set_bgp_neighbor_admin:  (s) => `shutdown bgp peer 192.168.1.2 on ${s}`,
  set_portchannel_member:  (s) => `add Ethernet64 to PortChannel1 on ${s}`,
  drain_switch:            (s) => `drain ${s}`,
  undrain_switch:          (s) => `undrain ${s}`,
  rollback_mutation:       () => "undo last mutation",
  run_show_command:        (s) => `show version on ${s}`,
};

const VIEWS: {id: ViewId; label: string; hint: string}[] = [
  {id: "dashboard", label: "Dashboard",  hint: "At-a-glance health"},
  {id: "fabric",    label: "Fabric",     hint: "Topology + link health"},
  {id: "console",   label: "AI Console", hint: "Natural language"},
  {id: "tools",     label: "Tools",      hint: "Tool catalog + forms"},
  {id: "activity",  label: "Activity",   hint: "Mutation audit log"},
  {id: "settings",  label: "Settings",   hint: "LLM + intent"},
];

export function CommandPalette(props: {
  tools: ToolSpec[] | null;
  devices: string[];                  // mgmt IPs from /api/ready
  selectedSwitch: string | null;
  onOpenView: (v: ViewId) => void;
  onSelectSwitch: (ip: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Global hotkey: Cmd/Ctrl-K opens (and toggles). Escape closes (handled
  // by cmdk internally).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const switchAlias = props.selectedSwitch ? displayName(props.selectedSwitch) : "vm1";

  const toolItems = useMemo(() => {
    if (!props.tools) return [];
    return props.tools
      .map((t) => {
        const prompter = PALETTE_PROMPTS[t.name];
        const prompt = prompter ? prompter(switchAlias) : null;
        return {tool: t, prompt};
      })
      // Tools we genuinely can't default still appear (they just open
      // the Tools view instead of submitting).
      .sort((a, b) => a.tool.name.localeCompare(b.tool.name));
  }, [props.tools, switchAlias]);

  function runPrompt(prompt: string) {
    setOpen(false);
    setQuery("");
    // Switch to AI Console if we're not there — it's the view that
    // listens for SUBMIT_PROMPT_EVENT.
    props.onOpenView("console");
    // Defer so the view switch lands first.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent(SUBMIT_PROMPT_EVENT, {detail: prompt}));
    }, 50);
  }

  function openTool(t: ToolSpec) {
    setOpen(false);
    setQuery("");
    props.onOpenView("tools");
    // Tell ToolsView which tool to pre-select via a custom event.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("sonic-mcp:open-tool", {detail: t.name}));
    }, 50);
  }

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "10vh",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{width: "min(640px, 92vw)"}}>
        <Command
          loop
          shouldFilter
          label="Command palette"
          className="overflow-hidden rounded-xl border border-white/10 bg-[#1a2332] shadow-2xl"
        >
          <Command.Input
            value={query}
            onValueChange={setQuery}
            autoFocus
            placeholder="Search tools, jump to a view, pick a switch…"
            className="h-12 w-full border-b border-white/[0.06] bg-transparent px-4 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none"
          />
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="p-4 text-center text-sm text-gray-500">
              No matches.
            </Command.Empty>

            <Command.Group heading="Go to view" className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-gray-500">
              {VIEWS.map((v) => (
                <Command.Item
                  key={`view-${v.id}`}
                  value={`view ${v.label} ${v.hint}`}
                  onSelect={() => { setOpen(false); props.onOpenView(v.id); }}
                  className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm text-gray-200 data-[selected=true]:bg-white/[0.06]"
                >
                  <span className="font-medium">{v.label}</span>
                  <span className="text-xs text-gray-500">{v.hint}</span>
                </Command.Item>
              ))}
            </Command.Group>

            {props.devices.length > 0 && (
              <Command.Group heading="Select target switch" className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-gray-500">
                {props.devices.map((ip) => (
                  <Command.Item
                    key={`sw-${ip}`}
                    value={`switch ${displayName(ip)} ${ip}`}
                    onSelect={() => { setOpen(false); props.onSelectSwitch(ip); }}
                    className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm text-gray-200 data-[selected=true]:bg-white/[0.06]"
                  >
                    <span className="font-medium">{displayName(ip)}</span>
                    <code className="text-xs text-gray-500">{ip}</code>
                    {ip === props.selectedSwitch && (
                      <span className="ml-auto rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-300">
                        current
                      </span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading={`Tools (${toolItems.length})`} className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-gray-500">
              {toolItems.map(({tool, prompt}) => {
                const risk = tool.policy?.risk ?? "SAFE_READ";
                const riskColor =
                  risk === "DESTRUCTIVE" ? "text-red-300"
                  : risk === "MUTATION"   ? "text-yellow-300"
                  : "text-green-300/70";
                return (
                  <Command.Item
                    key={`tool-${tool.name}`}
                    value={`${tool.name} ${tool.category} ${tool.description}`}
                    onSelect={() => {
                      if (prompt) runPrompt(prompt);
                      else openTool(tool);
                    }}
                    className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm text-gray-200 data-[selected=true]:bg-white/[0.06]"
                  >
                    <code className="font-mono text-[13px]">{tool.name}</code>
                    <span className={`text-[10px] uppercase tracking-wider ${riskColor}`}>
                      {risk}
                    </span>
                    <span className="ml-auto truncate text-xs text-gray-500">
                      {prompt ?? "open in Tools view"}
                    </span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          </Command.List>

          <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2 text-[11px] text-gray-500">
            <span>↑↓ navigate · ↵ select · Esc close</span>
            <span>⌘K / Ctrl-K anywhere</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
