/**
 * Per-(tool, field) suggestion providers for the mutation-confirm modal.
 *
 * Each provider is an async fn that returns a list of plausible values.
 * The modal renders the field as an HTML5 <input list="…"> combobox:
 * the user sees a dropdown of suggestions and can still type anything
 * else if the desired value isn't listed.
 *
 * Keep providers cheap and cached — the modal may call them multiple
 * times per keystroke while the user types.
 */

import {invoke} from "./api";

export type Suggestion = {value: string; label?: string};
type Provider = (args: {switchIp?: string; inputs: Record<string, any>}) => Promise<Suggestion[]>;

// ---------------------------------------------------------------
// Module-level cache keyed by provider + (switch, extra). Short TTL
// so state changes (e.g. a VLAN was just created) show up quickly.
// ---------------------------------------------------------------
const _CACHE = new Map<string, {at: number; data: Suggestion[]}>();
const _TTL_MS = 5_000;

async function _memo(key: string, fn: () => Promise<Suggestion[]>): Promise<Suggestion[]> {
  const hit = _CACHE.get(key);
  if (hit && Date.now() - hit.at < _TTL_MS) return hit.data;
  try {
    const data = await fn();
    _CACHE.set(key, {at: Date.now(), data});
    return data;
  } catch {
    return hit?.data ?? [];
  }
}

// ---------------------------------------------------------------
// Concrete fetchers — all of them invoke a read tool through the
// existing /api/invoke proxy. Each pulls just the field the UI needs
// from the tool's payload and maps to {value, label} entries.
// ---------------------------------------------------------------

async function _interfaces(switchIp: string, filter?: (name: string) => boolean): Promise<Suggestion[]> {
  return _memo(`interfaces:${switchIp}:${filter?.toString() ?? ""}`, async () => {
    const r = await invoke("get_interfaces", {switch_ip: switchIp});
    const rows = (r?.result?.payload?.interfaces ?? []) as any[];
    return rows
      .map((row) => row.name)
      .filter((n) => typeof n === "string" && n.length > 0 && (!filter || filter(n)))
      .sort(_intfSort)
      .map((n) => ({value: n}));
  });
}

async function _portchannels(switchIp: string): Promise<Suggestion[]> {
  return _memo(`portchannels:${switchIp}`, async () => {
    const r = await invoke("get_portchannels", {switch_ip: switchIp});
    const rows = (r?.result?.payload?.portchannels ?? r?.result?.payload?.entries ?? []) as any[];
    return rows
      .map((row) => row.name ?? row.portchannel)
      .filter((n) => typeof n === "string" && n.startsWith("PortChannel"))
      .sort()
      .map((n) => ({value: n}));
  });
}

async function _vlans(switchIp: string): Promise<Suggestion[]> {
  return _memo(`vlans:${switchIp}`, async () => {
    const r = await invoke("get_vlans", {switch_ip: switchIp});
    const rows = (r?.result?.payload?.vlans ?? r?.result?.payload?.entries ?? []) as any[];
    return rows
      .map((row) => row.vlan_id ?? row.vlanid ?? row.vid)
      .filter((v) => v !== undefined && v !== null)
      .map((v) => ({value: String(v), label: `Vlan${v}`}))
      .sort((a, b) => Number(a.value) - Number(b.value));
  });
}

async function _bgpPeers(switchIp: string): Promise<Suggestion[]> {
  return _memo(`bgp:${switchIp}`, async () => {
    const r = await invoke("get_bgp_summary", {switch_ip: switchIp});
    const peers = (r?.result?.payload?.ipv4?.peers ?? []) as any[];
    return peers
      .map((p) => p.peer)
      .filter((ip) => typeof ip === "string")
      .sort()
      .map((ip) => ({value: ip}));
  });
}

async function _routePrefixes(switchIp: string): Promise<Suggestion[]> {
  return _memo(`routes:${switchIp}`, async () => {
    const r = await invoke("get_routes", {switch_ip: switchIp});
    const rows = (r?.result?.payload?.routes ?? []) as any[];
    const staticOnly = rows.filter((row) =>
      String(row.protocol ?? "").toLowerCase().includes("static")
    );
    const uniq = new Set<string>();
    for (const row of staticOnly) {
      const p = row.destination ?? row.prefix;
      if (typeof p === "string") uniq.add(p);
    }
    return Array.from(uniq).sort().map((p) => ({value: p, label: `${p} (static)`}));
  });
}

async function _inventoryAliases(): Promise<Suggestion[]> {
  return _memo("inventory", async () => {
    // /api/ready carries the device list; extract once.
    const ready = await (await fetch("/api/ready")).json();
    const devs = ready?.body?.checks?.devices ?? {};
    return Object.keys(devs).sort().map((ip) => ({value: ip, label: `${_alias(ip)} (${ip})`}));
  });
}

async function _mutationIds(): Promise<Suggestion[]> {
  return _memo("mutation_ids", async () => {
    const r = await invoke("get_mutation_history", {limit: 30});
    const entries = (r?.result?.payload?.entries ?? []) as any[];
    return entries
      .filter((e) => e.status === "ok" && e.mutation_id)
      .slice(-20)
      .reverse()
      .map((e) => ({
        value: e.mutation_id,
        label: `${e.mutation_id} — ${e.tool} @ ${e.timestamp?.slice(11, 19) ?? "?"}`,
      }));
  });
}

// ---------------------------------------------------------------
// Registry — (tool, field) → provider
// ---------------------------------------------------------------

const _REGISTRY: Record<string, Provider> = {
  "set_interface_admin_status.interface":  ({switchIp}) => switchIp ? _interfaces(switchIp, (n) => /^Ethernet\d+$/.test(n)) : Promise.resolve([]),
  "set_interface_mtu.interface":           ({switchIp}) => switchIp ? _interfaces(switchIp, (n) => /^Ethernet\d+$/.test(n)) : Promise.resolve([]),
  "set_interface_description.interface":   ({switchIp}) => switchIp ? _interfaces(switchIp) : Promise.resolve([]),
  "clear_interface_counters.interface":    ({switchIp}) => switchIp ? _interfaces(switchIp) : Promise.resolve([]),
  "set_ip_interface.interface":            ({switchIp}) => switchIp ? _interfaces(switchIp, (n) =>
    /^(Ethernet|PortChannel|Loopback|Vlan)\d+$/.test(n)) : Promise.resolve([]),
  "set_portchannel_member.interface":      ({switchIp}) => switchIp ? _interfaces(switchIp, (n) => /^Ethernet\d+$/.test(n)) : Promise.resolve([]),
  "set_portchannel_member.portchannel":    ({switchIp}) => switchIp ? _portchannels(switchIp) : Promise.resolve([]),
  "remove_vlan.vlan_id":                   ({switchIp}) => switchIp ? _vlans(switchIp) : Promise.resolve([]),
  "set_bgp_neighbor_admin.peer":           ({switchIp}) => switchIp ? _bgpPeers(switchIp) : Promise.resolve([]),
  "remove_static_route.prefix":            ({switchIp}) => switchIp ? _routePrefixes(switchIp) : Promise.resolve([]),
  "remove_static_route.nexthop":           ({switchIp}) => switchIp ? _bgpPeers(switchIp) : Promise.resolve([]),
  "ping_between.target":                   () => _inventoryAliases(),
  "traceroute_between.target":             () => _inventoryAliases(),
  "iperf_between.target":                  () => _inventoryAliases(),
  "rollback_mutation.mutation_id":         () => _mutationIds(),
  "get_fabric_config_diff.left_switch_ip":  () => _inventoryAliases(),
  "get_fabric_config_diff.right_switch_ip": () => _inventoryAliases(),
};

export function getSuggestionProvider(tool: string, field: string): Provider | null {
  return _REGISTRY[`${tool}.${field}`] ?? null;
}

// ---------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------

function _intfSort(a: string, b: string): number {
  // Natural sort: "Ethernet2" before "Ethernet10", PortChannel before Vlan, etc.
  const parse = (s: string) => {
    const m = s.match(/^([A-Za-z]+)(\d+)$/);
    return m ? [m[1], parseInt(m[2], 10)] as const : [s, 0] as const;
  };
  const [aPrefix, aNum] = parse(a);
  const [bPrefix, bNum] = parse(b);
  if (aPrefix !== bPrefix) return String(aPrefix).localeCompare(String(bPrefix));
  return (aNum as number) - (bNum as number);
}

function _alias(ip: string): string {
  // Mirror the `displayName` convention from lib/state.ts without the
  // circular dependency. Best-effort mapping of common lab IPs.
  if (ip.endsWith(".50")) return "VM1";
  if (ip.endsWith(".51")) return "VM2";
  return ip;
}
