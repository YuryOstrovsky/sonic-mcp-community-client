"""Deterministic NL intent router for the SONiC MCP community client.

Input: a free-text user utterance.
Output: {"tool": str, "inputs": {...}} or None (nothing matched).

Design:
  - Regex patterns first — instant, zero-cost, catches the 90% case.
  - A small alias map for switch identifiers ("vm1", "vm2", raw IPs).
  - Unmatched queries return None; the caller can fall back to an LLM
    in Phase D (not wired yet).

Covers the Phase 1+2 tool surface:
  get_interfaces, get_ip_interfaces, get_routes, get_ipv6_routes,
  get_bgp_summary, get_lldp_neighbors, get_system_info, run_show_command.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------
# Switch aliases
# ---------------------------------------------------------------
# Map common natural-language switch identifiers to management IPs.
# Keys should be lowercase. Values are the switch_ip the MCP server expects.
SWITCH_ALIASES: Dict[str, str] = {
    "vm1": "10.46.11.50",
    "vm-1": "10.46.11.50",
    "sonic1": "10.46.11.50",
    "sonic-vm1": "10.46.11.50",
    "10.46.11.50": "10.46.11.50",
    "vm2": "10.46.11.51",
    "vm-2": "10.46.11.51",
    "sonic2": "10.46.11.51",
    "sonic-vm2": "10.46.11.51",
    "10.46.11.51": "10.46.11.51",
}

_IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")


# ---------------------------------------------------------------
# "All switches" scope modifier
# ---------------------------------------------------------------
# If the user says "all switches", "on both", "across the fabric", etc.,
# AND the matched tool has a registered multi-device variant (name + "_all"
# is in _TOOLS_WITH_ALL_VARIANT below), the router upgrades the single-switch
# intent to its fan-out sibling. Extend this set as more `*_all` tools ship
# on the server.
_TOOLS_WITH_ALL_VARIANT: set = {
    "get_system_info",
    "get_interfaces",
    "get_bgp_summary",
    "get_routes",
    "get_lldp_neighbors",
    "get_vlans",
    "get_arp_table",
    "get_mac_table",
}

_ALL_SCOPE_RE = re.compile(
    r"\b(?:on\s+|across\s+|for\s+)?(?:all|both|every|each)\s+(?:the\s+|of\s+the\s+)?"
    r"(?:switches|devices|vms?|hosts?|nodes?|routers?)\b"
    r"|\b(?:across|throughout)\s+(?:the\s+)?(?:fabric|lab|network)\b"
    r"|\bfabric[- ]?wide\b"
    r"|\bon\s+(?:all|both)\b",
    re.I,
)


def has_all_scope(text: str) -> bool:
    return bool(_ALL_SCOPE_RE.search(text or ""))


def extract_switch_ip(text: str) -> Optional[str]:
    """Pull a switch IP out of an utterance.

    Resolution order (aliases first, then IP literals — this matters for
    tool inputs that also contain IP-like values, e.g. 'shutdown bgp peer
    192.168.1.2 on vm1' — the switch is vm1, not the peer IP):
      1. Known alias token (vm1, sonic1, 10.46.11.50, ...) — longest first
      2. Any bare IPv4 literal — only if step 1 found nothing
    """
    if not text:
        return None
    t = text.lower()

    # Aliases first — longest-first so "sonic-vm1" beats "vm1".
    aliases_sorted = sorted(SWITCH_ALIASES.keys(), key=len, reverse=True)
    for alias in aliases_sorted:
        if re.search(rf"(?<![\w\-.]){re.escape(alias)}(?![\w\-.])", t):
            return SWITCH_ALIASES[alias]

    # No alias — fall back to the first IP literal we see.
    for m in _IP_RE.finditer(text):
        ip = m.group(0)
        if ip in SWITCH_ALIASES:
            return SWITCH_ALIASES[ip]
        return ip
    return None


# ---------------------------------------------------------------
# Intent patterns
# ---------------------------------------------------------------
# Each entry: (tool_name, list of regex patterns). First match wins.
# Keep patterns anchored with \b so short words don't over-match.
#
# The "help" tool is a pseudo-tool handled entirely by the client backend
# (not round-tripped to the MCP server) — it renders a context-aware help
# widget with real device names, the live tool catalog, and usage tips.
_PATTERNS: List[Tuple[str, List[re.Pattern]]] = [
    (
        "help",
        [
            # "help", "help?", "help me", "help please", "help on VM1" — any text
            # that *starts with* help is treated as a help request. Help is lab-wide
            # so an appended switch doesn't change the answer.
            re.compile(r"^\s*help\b", re.I),
            re.compile(r"\bwhat\s+can\s+(you|i|we)\s+do\b", re.I),
            re.compile(r"\bwhat\s+(tools|commands)\b", re.I),
            re.compile(r"\b(what|which)\s+are\s+(the|my|your)\s+(tools|commands|options)\b", re.I),
            re.compile(r"\bhow\s+(do|can)\s+i\s+(use|start|begin|get\s+started)\b", re.I),
            re.compile(r"\bgetting\s+started\b", re.I),
            re.compile(r"\b(show|list)\s+(the\s+)?tools\b", re.I),
            re.compile(r"\b(show|give)\s+me\s+(the\s+)?help\b", re.I),
        ],
    ),
    (
        "set_interface_admin_status",
        # Place BEFORE get_interfaces so "shutdown Ethernet12" and "set
        # interface Ethernet12 up" are recognized as mutations, not reads.
        # Every pattern requires an explicit Ethernet<N> literal so we don't
        # false-match generic phrases like "which interfaces are up".
        [
            # verb + <gap> + Ethernet<N>
            re.compile(r"\b(shut(down)?|disable|take\s+down|bring\s+down|admin\s+down)\b.*\bEthernet\d+\b", re.I),
            re.compile(r"\b(startup|enable|turn\s+on|bring\s+up|no\s+shut(down)?|admin\s+up)\b.*\bEthernet\d+\b", re.I),
            # Reverse phrasing: "Ethernet12 shutdown"
            re.compile(r"\bEthernet\d+\b.*\b(shut(down)?|disable)\b", re.I),
            re.compile(r"\bEthernet\d+\b.*\b(startup|no\s+shut(down)?)\b", re.I),
            # "set|configure Ethernet<N> (to) up/down" and variants — covers
            # "set Ethernet12 up", "set interface Ethernet12 up",
            # "configure Ethernet0 down", "set Ethernet4 to admin-down".
            re.compile(r"\b(set|configure)\b.*\bEthernet\d+\b.*\b(up|down)\b", re.I),
            # "set Ethernet12 up" with up/down BEFORE the iface (rare but safe)
            re.compile(r"\b(set|configure)\b.*\b(up|down)\b.*\bEthernet\d+\b", re.I),
        ],
    ),
    (
        "set_bgp_neighbor_admin",
        # Must come BEFORE get_bgp_summary — otherwise "shut bgp peer X" hits
        # the bare `\bbgp\b` pattern. Requires a BGP-qualifying word + IP.
        [
            re.compile(r"\b(shut(down)?|disable|admin\s+down)\b.*\b(bgp|peer|neighbor)\b.*\b(?:\d{1,3}\.){3}\d{1,3}\b", re.I),
            re.compile(r"\b(no\s+shut(down)?|unshut|enable|bring\s+up|admin\s+up)\b.*\b(bgp|peer|neighbor)\b.*\b(?:\d{1,3}\.){3}\d{1,3}\b", re.I),
            re.compile(r"\b(bgp|peer|neighbor)\b.*\b(?:\d{1,3}\.){3}\d{1,3}\b.*\b(shut(down)?|no\s+shut(down)?|disable|enable)\b", re.I),
        ],
    ),
    (
        "get_bgp_summary",
        [
            re.compile(r"\bbgp\b.*\b(summary|status|peers?|neighbors?|sessions?)\b", re.I),
            re.compile(r"\b(show|list|get)\b.*\bbgp\b", re.I),
            re.compile(r"\bbgp\b", re.I),
        ],
    ),
    # Mutations on VLANs must be tried BEFORE the read tool because
    # get_vlans has a bare \bvlans?\b fallback that would otherwise catch
    # "add vlan 250" first.
    (
        "add_vlan",
        [
            re.compile(r"\b(add|create|new|make)\b.*\bvlan\s*\d+\b", re.I),
            re.compile(r"\bvlan\s*\d+\b.*\b(add|create)\b", re.I),
        ],
    ),
    (
        "remove_vlan",
        [
            re.compile(r"\b(remove|delete|del|drop|destroy)\b.*\bvlan\s*\d+\b", re.I),
            re.compile(r"\bvlan\s*\d+\b.*\b(remove|delete|del)\b", re.I),
        ],
    ),
    (
        "get_vlans",
        [
            re.compile(r"\b(show|list|get)\b.*\bvlans?\b", re.I),
            re.compile(r"\bvlans?\b", re.I),
        ],
    ),
    (
        "get_arp_table",
        [
            re.compile(r"\b(show|list|get)\b.*\barp\b", re.I),
            re.compile(r"\barp\s+(table|entries|neighbors?)\b", re.I),
            re.compile(r"\barp\b", re.I),
        ],
    ),
    (
        "set_portchannel_member",
        # Must come BEFORE get_portchannels (which has bare \bportchannels?\b).
        [
            re.compile(r"\b(add|join)\b.*\bEthernet\d+\b.*\b(to|into)\b.*\bPortChannel\d+\b", re.I),
            re.compile(r"\b(remove|detach)\b.*\bEthernet\d+\b.*\bfrom\b.*\bPortChannel\d+\b", re.I),
            re.compile(r"\bPortChannel\d+\b.*\b(add|remove)\b.*\bEthernet\d+\b", re.I),
        ],
    ),
    (
        "get_portchannels",
        [
            re.compile(r"\bport[-\s]?channels?\b", re.I),
            re.compile(r"\blags?\b", re.I),
            re.compile(r"\blink\s+aggregation\b", re.I),
        ],
    ),
    (
        "get_platform_detail",
        [
            re.compile(r"\b(show|list|get)\b.*\bplatform\s+(detail|health|hardware|fans?|temp(erature)?s?|psus?|sensors?)\b", re.I),
            re.compile(r"\b(fans?|temperature|psu|sensors?)\b.*\b(status|health|detail)\b", re.I),
            re.compile(r"\bplatform\s+(detail|health|hardware|info)\b", re.I),
            re.compile(r"\bhardware\s+(health|detail|info|status)\b", re.I),
        ],
    ),
    (
        "get_sflow_status",
        [
            re.compile(r"\bs[-\s]?flow\b", re.I),
            re.compile(r"\b(sampling|telemetry)\s+(status|config|configuration)\b", re.I),
        ],
    ),
    (
        "config_save",
        [
            re.compile(r"\bsave\s+(the\s+)?config(uration)?\b", re.I),
            re.compile(r"\bpersist\s+(the\s+)?config(uration)?\b", re.I),
            re.compile(r"\bcommit\s+(the\s+)?config(uration)?\b", re.I),
            re.compile(r"\bconfig\s+save\b", re.I),
        ],
    ),
    (
        "set_interface_mtu",
        # Match any phrasing that sets/changes MTU on an Ethernet<N> literal.
        [
            re.compile(r"\b(set|change|update|configure)\b.*\bmtu\b.*\bEthernet\d+\b", re.I),
            re.compile(r"\bmtu\b.*\bEthernet\d+\b.*\b\d{2,5}\b", re.I),
            re.compile(r"\bEthernet\d+\b.*\bmtu\b.*\b\d{2,5}\b", re.I),
        ],
    ),
    (
        "set_interface_description",
        # "set description Ethernet12 'foo'", "describe Ethernet12 as 'foo'",
        # "Ethernet12 description 'foo'". Requires an Ethernet<N> + the word
        # description (avoids grabbing generic "set foo" phrases).
        [
            re.compile(r"\b(set|update|change)\b.*\bdescription\b.*\bEthernet\d+\b", re.I),
            re.compile(r"\bdescription\b.*\bEthernet\d+\b", re.I),
            re.compile(r"\bEthernet\d+\b.*\bdescription\b", re.I),
            re.compile(r"\bdescribe\b.*\bEthernet\d+\b", re.I),
        ],
    ),
    (
        "clear_interface_counters",
        [
            re.compile(r"\b(clear|reset|zero)\b.*\b(counters?|statistics|stats)\b", re.I),
            re.compile(r"\b(counters?|statistics|stats)\s+(clear|reset)\b", re.I),
        ],
    ),
    # (add_vlan and remove_vlan are registered earlier, above get_vlans.)
    (
        "get_mutation_history",
        [
            re.compile(r"\b(show|list|get)\s+(mutation|audit|activity)\s+(history|log)?\b", re.I),
            re.compile(r"\b(mutation|audit)\s+(history|log|ledger)\b", re.I),
            re.compile(r"\brecent\s+(mutations|changes)\b", re.I),
        ],
    ),
    # discover_fabric_from_seed must come BEFORE get_fabric_topology so
    # "discover fabric from vm1" doesn't get eaten by the generic
    # "fabric" reads.
    (
        "discover_fabric_from_seed",
        [
            re.compile(r"\bdiscover\b.*\bfabric\b", re.I),
            re.compile(r"\bdiscover\b.*\b(neighbors?|switches)\b", re.I),
            re.compile(r"\blldp\s+walk\b", re.I),
            re.compile(r"\bseed\s+discovery\b", re.I),
        ],
    ),
    # Fabric-level reads must match BEFORE get_lldp_neighbors (whose bare
    # `\b(topology|neighbors?)\b` would otherwise swallow "fabric topology").
    (
        "get_fabric_topology",
        [
            re.compile(r"\bfabric\s+topology\b", re.I),
            re.compile(r"\b(topology|graph)\s+of\s+(the\s+)?fabric\b", re.I),
            re.compile(r"\b(show|draw|render)\b.*\bfabric\b", re.I),
            re.compile(r"\bfabric\s+map\b", re.I),
        ],
    ),
    (
        "get_fabric_health",
        [
            re.compile(r"\bfabric\s+(health|status)\b", re.I),
            re.compile(r"\b(all|every)\s+(bgp\s+)?(links?|peers?|sessions?|adjacencies)\s+(up|established|healthy)\b", re.I),
            re.compile(r"\b(any|are\s+there)\s+broken\s+(links?|peers?)\b", re.I),
        ],
    ),
    # iperf must come BEFORE generic "test" / "throughput" words would match
    # anything else. Its own patterns already require "iperf" explicitly.
    (
        "iperf_between",
        [
            re.compile(r"\biperf3?\b", re.I),
            re.compile(r"\b(throughput|bandwidth)\s+(test|between)\b", re.I),
            re.compile(r"\b(test\s+)?(bandwidth|throughput)\b.*\bfrom\b", re.I),
        ],
    ),
    (
        "get_routes_by_prefix",
        # CIDR + explicit LOOKUP verb (search/find/lookup/who). Crucially,
        # patterns here must NOT match "add route CIDR" — that's an
        # add_static_route mutation. We enforce this by either requiring a
        # lookup verb or by using a negative lookahead in the bare "route"
        # pattern.
        [
            re.compile(r"\b(search|find|lookup|look\s+up)\b.*\b(route|prefix|network)\b.*\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b", re.I),
            re.compile(r"\bwho\s+(has|advertises|sees|installs|knows)\b.*\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b", re.I),
            re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b.*\b(on\s+fabric|across\s+fabric|fabric\s+wide|everywhere|installed|advertised)\b", re.I),
            # Bare "route CIDR" form — rejected when the query begins with
            # add/install/create/remove/delete/withdraw (those are mutations).
            re.compile(r"^(?!.*\b(add|install|create|remove|delete|del|drop|withdraw)\b).*\b(route|prefix)\s+(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b", re.I),
        ],
    ),
    # Snapshot comparison — matches "compare snapshots X and Y",
    # "diff snapshots X Y", etc. Requires the word 'snapshot' so it
    # doesn't poach phrases like "diff config of vm1 and vm2"
    # (which routes to get_fabric_config_diff).
    (
        "compare_fabric_snapshots",
        [
            re.compile(r"\b(compare|diff)\b.*\bsnapshots?\b", re.I),
            re.compile(r"\bsnapshot\s+diff\b", re.I),
        ],
    ),
    # restore_fabric_snapshot must come BEFORE rollback_mutation so that
    # "rollback to snapshot X" routes to the snapshot restore, not the
    # per-mutation rollback.
    (
        "restore_fabric_snapshot",
        [
            re.compile(r"\brestore\b.*\b(snapshot|backup)\b", re.I),
            re.compile(r"\brestore\s+the\s+backup\b", re.I),
            re.compile(r"\b(rollback|roll\s+back)\b.*\b(to\s+)?(snapshot|backup)\b", re.I),
        ],
    ),
    (
        "rollback_mutation",
        # Require a mutation-specific anchor: either the word "mutation"
        # or a mut-xxxxxx id. Bare "rollback" is too ambiguous (see above).
        [
            re.compile(r"\b(rollback|roll\s+back|undo|revert)\b.*\b(mut[ -]?\w{6,}|mutation)\b", re.I),
            re.compile(r"\b(undo|revert)\b.*\b(last\s+)?(change|mutation)\b", re.I),
        ],
    ),
    (
        "save_fabric_snapshot",
        [
            re.compile(r"\b(save|take|create|snapshot)\b.*\b(snapshot|backup)\b", re.I),
            re.compile(r"\b(snapshot|backup)\s+(fabric|config)\b", re.I),
        ],
    ),
    (
        "fabric_drain_rotate",
        [
            re.compile(r"\b(rolling\s+(drain|maintenance)|drain\s+rotate|rotate\s+(drain|fabric))\b", re.I),
            re.compile(r"\brotate\s+the\s+fabric\b", re.I),
            re.compile(r"\b(maintenance\s+rotation|rolling\s+bgp\s+maintenance)\b", re.I),
        ],
    ),
    (
        "detect_routing_loop",
        [
            re.compile(r"\b(detect|find|check(?:\s+for)?)\b.*\brouting\s+loops?\b", re.I),
            re.compile(r"\brouting\s+loops?\b", re.I),
            re.compile(r"\bforwarding\s+loops?\b", re.I),
            re.compile(r"\bloop\s+detection\b", re.I),
        ],
    ),
    # MAC / ARP fabric reads — must come BEFORE get_arp_table's bare \barp\b
    # pattern (scope modifier "all" upgrades to the _all variant anyway, but
    # "fabric mac" / "fabric arp" should route to our new fanouts).
    (
        "get_mac_table_all",
        [
            re.compile(r"\b(fabric\s+)?mac\s+(table|learning)\s+(all|across|fabric)\b", re.I),
            re.compile(r"\b(all|every|fabric)\s+.*\bmac\s+(table|learning)\b", re.I),
            re.compile(r"\bmac\s+table\s+on\s+all\b", re.I),
        ],
    ),
    (
        "get_mac_table",
        [
            re.compile(r"\b(show|list|get)\b.*\bmac\s+(table|address(es)?|learning)\b", re.I),
            re.compile(r"\bmac\s+(table|address(es)?)\b", re.I),
            re.compile(r"\bforwarding\s+table\b", re.I),
            re.compile(r"\bfdb\b", re.I),
        ],
    ),
    (
        "get_arp_table_all",
        [
            re.compile(r"\b(fabric\s+)?arp\s+(across|on\s+all|everywhere)\b", re.I),
            re.compile(r"\b(all|every|fabric)\s+.*\barp\b", re.I),
            re.compile(r"\barp\s+on\s+all\b", re.I),
        ],
    ),
    # Reachability matrix must come BEFORE bare `\bping\b` — otherwise
    # "ping all / fabric reachability matrix" falls through to ping_between.
    (
        "get_fabric_reachability_matrix",
        [
            re.compile(r"\breachability\s+matrix\b", re.I),
            re.compile(r"\bping\s+(all|every|the\s+fabric|the\s+whole\s+fabric|across)\b", re.I),
            re.compile(r"\b(fabric|full|pairwise)\s+(reachability|ping)\b", re.I),
            re.compile(r"\bn\s*x\s*n\s+ping\b", re.I),
        ],
    ),
    # Traceroute above plain ping_between.
    (
        "traceroute_between",
        [
            re.compile(r"\b(traceroute|tracert|trace\s+route|trace\s+path)\b", re.I),
            re.compile(r"\btrace\b.*\bfrom\b", re.I),
            re.compile(r"\bpath\s+(from|to)\b.*\b(to|from)\b", re.I),
        ],
    ),
    (
        "ping_between",
        [
            # "ping vm2 from vm1" / "ping 10.46.11.51 from vm1"
            re.compile(r"\bping\b.*\bfrom\b", re.I),
            # "from vm1 ping vm2"
            re.compile(r"\bfrom\b.*\bping\b", re.I),
            # "can vm1 reach vm2" / "does vm1 reach vm2"
            re.compile(r"\b(can|does)\b.*\b(reach|ping)\b", re.I),
            # Bare "ping" — catches "ping", "ping vm2", "ping 10.1.1.1".
            # Source/target may be partial or missing; the ping widget's
            # dropdowns let the user complete the call. This avoids an
            # expensive LLM round-trip for the common case.
            re.compile(r"\bping\b", re.I),
        ],
    ),
    (
        "get_fabric_mtu_consistency",
        [
            re.compile(r"\bmtu\s+(consistency|audit|mismatch(es)?|check)\b", re.I),
            re.compile(r"\b(audit|check)\s+mtu\b", re.I),
            re.compile(r"\bmtu\s+across\s+(the\s+)?fabric\b", re.I),
        ],
    ),
    (
        "get_fabric_bandwidth",
        [
            re.compile(r"\bfabric\s+(bandwidth|utilization|traffic)\b", re.I),
            re.compile(r"\b(show|check)\s+(link|interface)\s+(utilization|usage|bandwidth)\b", re.I),
            re.compile(r"\b(utilization|bps|bandwidth)\b.*\b(across|fabric|all)\b", re.I),
            re.compile(r"\btop\s+(talkers|links|interfaces)\b", re.I),
        ],
    ),
    (
        "get_fabric_config_diff",
        [
            re.compile(r"\b(diff|compare)\b.*\bconfig\b", re.I),
            re.compile(r"\bconfig\s+(diff|drift|compare)\b", re.I),
            re.compile(r"\b(diff|compare)\b.*\b(vm\d|sonic\d).*\b(and|vs|with)\b.*\b(vm\d|sonic\d)\b", re.I),
        ],
    ),
    (
        "validate_fabric_vs_intent",
        [
            re.compile(r"\bvalidate\s+(fabric|intent)\b", re.I),
            re.compile(r"\b(check|verify)\s+intent\b", re.I),
            re.compile(r"\bfabric\s+vs\.?\s+intent\b", re.I),
            re.compile(r"\bintent\s+(drift|compliance|check)\b", re.I),
        ],
    ),
    (
        "drain_switch",
        [
            re.compile(r"\bdrain\b.*\b(vm\d|sonic\d|sonic-vm\d|switch|10\.\d)", re.I),
            re.compile(r"\b(maintenance|isolate)\b.*\b(vm\d|sonic\d)\b", re.I),
            re.compile(r"\b(admin\s+shut|shut\s+all)\s+(bgp\s+)?(peers|neighbors)\b", re.I),
        ],
    ),
    (
        "undrain_switch",
        [
            re.compile(r"\bundrain\b", re.I),
            re.compile(r"\b(un-?isolate|bring\s+back|return\s+to\s+service)\b", re.I),
            re.compile(r"\b(admin\s+up|no\s+shut\s+all)\s+(bgp\s+)?(peers|neighbors)\b", re.I),
        ],
    ),
    (
        "set_ip_interface",
        # CIDR literal + interface literal discriminates this from plain
        # "add route" phrases — no ambiguity with add_static_route below.
        [
            re.compile(r"\b(add|assign|set)\b.*\bip\b.*\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b.*\b(Ethernet|PortChannel|Loopback|Vlan)\d+\b", re.I),
            re.compile(r"\b(remove|unassign|clear)\b.*\bip\b.*\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b.*\b(Ethernet|PortChannel|Loopback|Vlan)\d+\b", re.I),
            re.compile(r"\b(Ethernet|PortChannel|Loopback|Vlan)\d+\b.*\bip\b.*\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b", re.I),
        ],
    ),
    (
        "get_lldp_neighbors",
        [
            re.compile(r"\blldp\b", re.I),
            re.compile(r"\b(topology|neighbors?)\b", re.I),
        ],
    ),
    (
        "get_ipv6_routes",
        [
            re.compile(r"\b(ipv6|v6)\b.*\broutes?\b", re.I),
            re.compile(r"\broutes?\b.*\b(ipv6|v6)\b", re.I),
            re.compile(r"\bipv6\s+(routing|route\s+table)\b", re.I),
        ],
    ),
    # Route mutations must come BEFORE get_routes (which has bare \broutes?\b).
    (
        "add_static_route",
        [
            re.compile(r"\b(add|install|create)\b.*\b(static\s+)?route\b.*\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b.*\bvia\b.*\b(?:\d{1,3}\.){3}\d{1,3}\b", re.I),
            re.compile(r"\b(add|install|create)\b.*\b(static\s+)?route\b.*\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b.*\bnexthop\b.*\b(?:\d{1,3}\.){3}\d{1,3}\b", re.I),
            re.compile(r"\bip\s+route\b.*\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b.*\b(?:\d{1,3}\.){3}\d{1,3}\b", re.I),
        ],
    ),
    (
        "remove_static_route",
        [
            re.compile(r"\b(remove|delete|del|withdraw|drop)\b.*\b(static\s+)?route\b.*\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b", re.I),
            re.compile(r"\bno\s+ip\s+route\b.*\b(?:\d{1,3}\.){3}\d{1,3}/\d{1,2}\b", re.I),
        ],
    ),
    (
        "get_routes",
        [
            re.compile(r"\b(show|list|get|display)\b.*\b(ip\s+)?(routes?|routing\s+table)\b", re.I),
            re.compile(r"\b(routing\s+table|route\s+table)\b", re.I),
            re.compile(r"\b(ipv4|v4)\b.*\broutes?\b", re.I),
            re.compile(r"\broutes?\b", re.I),
        ],
    ),
    (
        "get_ip_interfaces",
        [
            re.compile(r"\bip\s+interfaces?\b", re.I),
            re.compile(r"\b(l3|layer\s*3)\b.*\binterfaces?\b", re.I),
            re.compile(r"\b(show|list|get)\b.*\b(ip|ipv4)\s+addresses?\b", re.I),
        ],
    ),
    (
        "get_interfaces",
        [
            re.compile(r"\b(show|list|get|display)\b.*\binterfaces?\b", re.I),
            re.compile(r"\b(interfaces?|ports?)\s+(status|state)\b", re.I),
            re.compile(r"\binterfaces?\b", re.I),
        ],
    ),
    (
        "get_system_info",
        [
            re.compile(r"\b(show|get)\s+version\b", re.I),
            re.compile(r"\bsystem\s+info(rmation)?\b", re.I),
            re.compile(r"\b(what|which)\s+version\b", re.I),
            re.compile(r"\b(sonic\s+)?build\b", re.I),
            re.compile(r"\buptime\b", re.I),
            re.compile(r"\bplatform\b", re.I),
        ],
    ),
]


@dataclass
class RoutedIntent:
    tool: str
    inputs: Dict[str, Any]
    confidence: str        # "high" | "medium" | "low"
    reason: str
    switch_ip: Optional[str]
    ambiguities: List[str]


def _match_tool(text: str) -> Optional[Tuple[str, str]]:
    """Return (tool_name, matching_pattern_repr) or None."""
    for tool, pats in _PATTERNS:
        for pat in pats:
            if pat.search(text):
                return tool, pat.pattern
    return None


# ---------------------------------------------------------------
# Escape-hatch pattern for literal `show <...>` commands
# ---------------------------------------------------------------
# Matches things like: "run 'show platform summary' on vm1"
#                     "show platform summary"
#                     "show vlan brief"
_SHOW_CMD_RE = re.compile(
    r"""
    (?:\brun\s+|\bexecute\s+)?       # optional verb
    ['"]?                             # optional opening quote
    (show\s+[A-Za-z0-9 _\-./:|=+,]+) # the actual show command (matches server validation)
    ['"]?                             # optional closing quote
    """,
    re.I | re.X,
)


def route(text: str) -> Optional[RoutedIntent]:
    """Route a free-text utterance to a tool + inputs.

    Returns None if no pattern matched.
    """
    if not text or not text.strip():
        return None

    raw = text.strip()
    ambiguities: List[str] = []

    switch_ip = extract_switch_ip(raw)
    scope_all = has_all_scope(raw)

    if switch_ip is None and not scope_all:
        ambiguities.append(
            "no switch identified — the client will need to ask the user "
            "which switch (vm1/vm2) to target"
        )

    # 1. Tool match via pattern table
    matched = _match_tool(raw)
    if matched is not None:
        tool, pattern = matched

        # Skip pseudo-tools (e.g., "help") — never fan those out.
        is_pseudo = tool in {"help"}

        # Upgrade to _all variant when the user scoped to "all switches"
        # and the matched tool has a multi-device sibling on the server.
        if scope_all and not is_pseudo and tool in _TOOLS_WITH_ALL_VARIANT:
            return RoutedIntent(
                tool=f"{tool}_all",
                inputs={},  # _all tools take no switch_ip
                confidence="high",
                reason=f"matched {tool} with 'all-switches' scope → upgraded to {tool}_all",
                switch_ip=None,
                ambiguities=[],
            )

        inputs: Dict[str, Any] = {}
        if switch_ip:
            inputs["switch_ip"] = switch_ip

        # ---------- Tool-specific input extraction ----------
        # set_interface_admin_status needs `interface` + `admin_status` in
        # addition to switch_ip. Pull the interface name from an Ethernet<N>
        # literal and derive the status from the verb used.
        if tool == "set_interface_admin_status":
            iface_m = re.search(r"\bEthernet(\d+)\b", raw, re.I)
            if iface_m:
                # Normalize the casing — server regex requires ^Ethernet\d+$
                inputs["interface"] = f"Ethernet{iface_m.group(1)}"

            # Detect admin_status via multiple verb families. Order matters:
            # UP verbs are checked first so "no shut" isn't misread as "shut".
            is_up = bool(re.search(
                r"\b(startup|enable|turn\s+on|bring\s+up|no\s+shut(down)?|admin\s+up|admin[- ]up)\b",
                raw, re.I,
            ))
            is_down = False
            if not is_up:
                is_down = bool(re.search(
                    r"\b(shut(down)?|disable|take\s+down|bring\s+down|admin\s+down|admin[- ]down)\b",
                    raw, re.I,
                ))

            # "set|configure ... up/down" phrasing — only consulted when the
            # explicit verb families above didn't match. Examples:
            #   "set Ethernet12 up"  →  up
            #   "configure Ethernet0 down"  →  down
            #   "set interface Ethernet12 to up"  →  up
            if not is_up and not is_down:
                if re.search(r"\b(set|configure)\b.*\bup\b", raw, re.I):
                    is_up = True
                elif re.search(r"\b(set|configure)\b.*\bdown\b", raw, re.I):
                    is_down = True

            if is_up:
                inputs["admin_status"] = "up"
            elif is_down:
                inputs["admin_status"] = "down"

        # set_interface_description needs `interface` + `description`.
        if tool == "set_interface_description":
            iface_m = re.search(r"\bEthernet(\d+)\b", raw, re.I)
            if iface_m:
                inputs["interface"] = f"Ethernet{iface_m.group(1)}"
            # Description is a quoted string (single or double) — preferred —
            # or falls back to whatever follows "to " / "as " up to the next
            # "on <switch>" clause. We intentionally DON'T treat "description"
            # as a starting anchor because the field name itself precedes
            # the value in phrases like "set description Ethernet0 to Uplink".
            quoted = re.search(r'"([^"]+)"|' + r"'([^']+)'", raw)
            if quoted:
                inputs["description"] = quoted.group(1) or quoted.group(2)
            else:
                tail = re.sub(r"\s+on\s+\S+\s*$", "", raw, flags=re.I)
                after = re.search(r"\b(?:to|as)\s+(.+)$", tail, re.I)
                if after:
                    text = after.group(1).strip().strip(".,")
                    if text and len(text) >= 2:
                        inputs["description"] = text

        # set_interface_mtu needs `interface` + `mtu`.
        if tool == "set_interface_mtu":
            iface_m = re.search(r"\bEthernet(\d+)\b", raw, re.I)
            if iface_m:
                inputs["interface"] = f"Ethernet{iface_m.group(1)}"
            # Pull the first 2-5 digit number that isn't the interface index.
            # Walk all numbers in the text; reject the one inside Ethernet<N>
            # and anything outside the sensible MTU range.
            iface_digits = iface_m.group(1) if iface_m else None
            for num_m in re.finditer(r"\b(\d{2,5})\b", raw):
                n = num_m.group(1)
                if iface_digits and n == iface_digits and raw[num_m.start() - 8:num_m.start()].lower().endswith("ethernet"):
                    continue
                try:
                    nv = int(n)
                except ValueError:
                    continue
                if 68 <= nv <= 9216:
                    inputs["mtu"] = nv
                    break

        # add_vlan / remove_vlan need `vlan_id`.
        if tool in ("add_vlan", "remove_vlan"):
            vid_m = re.search(r"\bvlan\s*(\d{1,4})\b", raw, re.I)
            if vid_m:
                try:
                    inputs["vlan_id"] = int(vid_m.group(1))
                except ValueError:
                    pass

        # set_ip_interface needs `interface`, `address`, `action`.
        if tool == "set_ip_interface":
            iface_m = re.search(r"\b(Ethernet|PortChannel|Loopback|Vlan)(\d+)\b", raw, re.I)
            if iface_m:
                prefix = {"ethernet": "Ethernet", "portchannel": "PortChannel",
                          "loopback": "Loopback", "vlan": "Vlan"}[iface_m.group(1).lower()]
                inputs["interface"] = f"{prefix}{iface_m.group(2)}"
            cidr_m = re.search(r"\b((?:\d{1,3}\.){3}\d{1,3}/\d{1,2})\b", raw)
            if cidr_m:
                inputs["address"] = cidr_m.group(1)
            if re.search(r"\b(remove|unassign|clear|delete|del)\b", raw, re.I):
                inputs["action"] = "remove"
            elif re.search(r"\b(add|assign|set)\b", raw, re.I):
                inputs["action"] = "add"

        # add_static_route needs `prefix`, `nexthop`, optional `distance`.
        if tool == "add_static_route":
            cidrs = re.findall(r"\b((?:\d{1,3}\.){3}\d{1,3}/\d{1,2})\b", raw)
            ips_no_mask = re.findall(r"\b((?:\d{1,3}\.){3}\d{1,3})\b(?!/)", raw)
            if cidrs:
                inputs["prefix"] = cidrs[0]
            # Prefer an IP that comes after "via" or "nexthop"; else first
            # bare IP that isn't a mgmt alias.
            nh_m = re.search(r"\b(?:via|nexthop|gw|gateway)\s+((?:\d{1,3}\.){3}\d{1,3})\b", raw, re.I)
            if nh_m:
                inputs["nexthop"] = nh_m.group(1)
            elif ips_no_mask:
                inputs["nexthop"] = ips_no_mask[0]
            # Trailing integer in 1..255 after the nexthop is interpreted as
            # administrative distance.
            dist_m = re.search(r"\b(?:distance|ad)\s+(\d{1,3})\b", raw, re.I)
            if dist_m:
                try:
                    d = int(dist_m.group(1))
                    if 1 <= d <= 255:
                        inputs["distance"] = d
                except ValueError:
                    pass

        # remove_static_route needs `prefix`, optional `nexthop`.
        if tool == "remove_static_route":
            cidrs = re.findall(r"\b((?:\d{1,3}\.){3}\d{1,3}/\d{1,2})\b", raw)
            if cidrs:
                inputs["prefix"] = cidrs[0]
            nh_m = re.search(r"\b(?:via|nexthop|gw|gateway)\s+((?:\d{1,3}\.){3}\d{1,3})\b", raw, re.I)
            if nh_m:
                inputs["nexthop"] = nh_m.group(1)

        # set_bgp_neighbor_admin needs `peer` + `admin_status`.
        if tool == "set_bgp_neighbor_admin":
            peer_m = re.search(r"\b((?:\d{1,3}\.){3}\d{1,3})\b", raw)
            if peer_m:
                inputs["peer"] = peer_m.group(1)
            # Up verbs checked first — "no shut" must not count as "shut".
            is_up = bool(re.search(
                r"\b(no\s+shut(down)?|unshut|enable|bring\s+up|admin\s+up)\b", raw, re.I,
            ))
            is_down = False
            if not is_up:
                is_down = bool(re.search(
                    r"\b(shut(down)?|disable|admin\s+down)\b", raw, re.I,
                ))
            if is_up:
                inputs["admin_status"] = "up"
            elif is_down:
                inputs["admin_status"] = "down"

        # set_portchannel_member needs `portchannel`, `interface`, `action`.
        if tool == "set_portchannel_member":
            po_m = re.search(r"\bPortChannel(\d+)\b", raw, re.I)
            if po_m:
                inputs["portchannel"] = f"PortChannel{po_m.group(1)}"
            eth_m = re.search(r"\bEthernet(\d+)\b", raw, re.I)
            if eth_m:
                inputs["interface"] = f"Ethernet{eth_m.group(1)}"
            if re.search(r"\b(remove|detach|delete|del)\b", raw, re.I):
                inputs["action"] = "remove"
            elif re.search(r"\b(add|join)\b", raw, re.I):
                inputs["action"] = "add"

        # ping_between needs `source_switch_ip` + `target`. Two switch aliases
        # can appear; the one after "from" is the source, the other is target.
        if tool == "ping_between":
            # Find switch aliases / IPs in order of appearance. Store
            # (position, resolved_mgmt_ip, original_token) so we can pick
            # resolved form for both source and target — SONiC VMs don't
            # resolve each other's aliases via DNS.
            matches = []
            for m in re.finditer(r"\b(vm\d|sonic\d|sonic-vm\d|(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?)\b", raw, re.I):
                token = m.group(1).lower().split("/")[0]
                resolved = SWITCH_ALIASES.get(token, m.group(1))
                matches.append((m.start(), resolved, m.group(1)))
            # Where does "from" appear? Everything after it is the source.
            # "ping X from Y"  → X=target (before from), Y=source (after from)
            # "from Y ping X"  → Y=source (first after from), X=target (second after from)
            from_m = re.search(r"\bfrom\b", raw, re.I)
            src, tgt = None, None
            if from_m:
                before = [x for x in matches if x[0] < from_m.start()]
                after = [x for x in matches if x[0] > from_m.start()]
                if after:
                    src = after[0][1]
                if before:
                    tgt = before[0][1]
                elif len(after) >= 2:
                    # "from X ping Y" — no tokens before "from", so the
                    # second post-"from" alias is the target.
                    tgt = after[1][1]
            else:
                # "can vm1 reach vm2": first = source, second = target
                if len(matches) >= 2:
                    src = matches[0][1]
                    tgt = matches[1][1]
                elif matches:
                    tgt = matches[0][1]
            if src:
                inputs["source_switch_ip"] = src
                inputs.pop("switch_ip", None)
            elif switch_ip:
                # Fall back to whatever the generic switch extraction found.
                # For bare "ping", this is usually the global-selected switch
                # appended by the ConsoleView as "on <alias>".
                inputs["source_switch_ip"] = switch_ip
                inputs.pop("switch_ip", None)
            if tgt:
                inputs["target"] = tgt

        # traceroute_between uses the same source/target logic as ping_between.
        if tool == "traceroute_between":
            matches = []
            for m in re.finditer(r"\b(vm\d|sonic\d|sonic-vm\d|(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?)\b", raw, re.I):
                token = m.group(1).lower().split("/")[0]
                resolved = SWITCH_ALIASES.get(token, m.group(1))
                matches.append((m.start(), resolved, m.group(1)))
            from_m = re.search(r"\bfrom\b", raw, re.I)
            src, tgt = None, None
            if from_m:
                before = [x for x in matches if x[0] < from_m.start()]
                after  = [x for x in matches if x[0] > from_m.start()]
                if after:  src = after[0][1]
                if before: tgt = before[0][1]
                elif len(after) >= 2: tgt = after[1][1]
            else:
                if len(matches) >= 2:
                    src = matches[0][1]; tgt = matches[1][1]
                elif matches:
                    tgt = matches[0][1]
            if src:
                inputs["source_switch_ip"] = src
                inputs.pop("switch_ip", None)
            elif switch_ip:
                inputs["source_switch_ip"] = switch_ip
                inputs.pop("switch_ip", None)
            if tgt:
                inputs["target"] = tgt

        # drain_switch / undrain_switch: pick target switch from the text
        # (an alias like "drain vm2" should operate on vm2, not the globally-
        # selected switch). Fall back to switch_ip when no alias in text.
        if tool in ("drain_switch", "undrain_switch"):
            # switch_ip is already set by the generic extraction above —
            # nothing more to do, but drop any stray keys.
            for k in list(inputs.keys()):
                if k not in {"switch_ip"}:
                    inputs.pop(k, None)

        # iperf_between uses the same source/target logic as ping/traceroute.
        if tool == "iperf_between":
            matches = []
            for m in re.finditer(r"\b(vm\d|sonic\d|sonic-vm\d|(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?)\b", raw, re.I):
                token = m.group(1).lower().split("/")[0]
                resolved = SWITCH_ALIASES.get(token, m.group(1))
                matches.append((m.start(), resolved, m.group(1)))
            from_m = re.search(r"\bfrom\b", raw, re.I)
            src, tgt = None, None
            if from_m:
                before = [x for x in matches if x[0] < from_m.start()]
                after  = [x for x in matches if x[0] > from_m.start()]
                if after:  src = after[0][1]
                if before: tgt = before[0][1]
                elif len(after) >= 2: tgt = after[1][1]
            else:
                if len(matches) >= 2:
                    src = matches[0][1]; tgt = matches[1][1]
                elif matches:
                    tgt = matches[0][1]
            if src:
                inputs["source_switch_ip"] = src
                inputs.pop("switch_ip", None)
            elif switch_ip:
                inputs["source_switch_ip"] = switch_ip
                inputs.pop("switch_ip", None)
            if tgt:
                inputs["target"] = tgt
            # optional duration: "5s", "10 seconds", "for 5"
            dur_m = re.search(r"\b(?:for\s+)?(\d{1,2})\s*(?:s|sec|seconds?)\b", raw, re.I)
            if dur_m:
                try:
                    inputs["duration_s"] = int(dur_m.group(1))
                except ValueError:
                    pass
            # "reverse" keyword → reverse mode
            if re.search(r"\breverse\b", raw, re.I):
                inputs["reverse"] = True

        # get_routes_by_prefix: grab first CIDR in the text as prefix.
        if tool == "get_routes_by_prefix":
            cidr = re.search(r"\b((?:\d{1,3}\.){3}\d{1,3}/\d{1,2})\b", raw)
            if cidr:
                inputs["prefix"] = cidr.group(1)
            # match_mode keywords
            if re.search(r"\bexact\b", raw, re.I):       inputs["match_mode"] = "exact"
            elif re.search(r"\bcovers\b", raw, re.I):    inputs["match_mode"] = "covers"
            elif re.search(r"\bcovered\b", raw, re.I):   inputs["match_mode"] = "covered_by"
            inputs.pop("switch_ip", None)

        # rollback_mutation: extract a mutation_id-looking token.
        if tool == "rollback_mutation":
            m = re.search(r"\b(mut-[a-f0-9]{6,}|mut_[a-zA-Z0-9]+)\b", raw, re.I)
            if m:
                inputs["mutation_id"] = m.group(1)
            inputs.pop("switch_ip", None)

        # save_fabric_snapshot: optional name from "named X" / "as X"
        if tool == "save_fabric_snapshot":
            nm = re.search(r"\b(?:named|as|label(?:ed)?|called)\s+([A-Za-z0-9_.\-]+)\b", raw, re.I)
            if nm:
                inputs["name"] = nm.group(1)
            inputs.pop("switch_ip", None)

        # compare_fabric_snapshots: pull two snapshot names after
        # "snapshots" keyword, or two tokens after "diff"/"compare".
        if tool == "compare_fabric_snapshots":
            # Match "snapshots X and Y", "snapshots X Y", "X vs Y"
            m = re.search(
                r"\bsnapshots?\s+([A-Za-z0-9_.\-]+)\s+(?:and|vs|v\.?|versus|,)?\s*([A-Za-z0-9_.\-]+)\b",
                raw, re.I,
            )
            if m:
                inputs["left_name"] = m.group(1)
                inputs["right_name"] = m.group(2)
            inputs.pop("switch_ip", None)

        # restore_fabric_snapshot: mandatory name. Look for a token after
        # "restore snapshot X" / "restore X" / "snapshot X". Explicitly skip
        # "snapshot"/"backup" themselves so "restore snapshot preflight"
        # captures "preflight", not "snapshot".
        if tool == "restore_fabric_snapshot":
            nm = re.search(
                r"\b(?:restore|rollback\s+to)\s+(?:(?:the\s+)?(?:snapshot|backup)\s+)?"
                r"([A-Za-z0-9_.\-]+)\b",
                raw, re.I,
            )
            if nm:
                candidate = nm.group(1)
                # Reject filler words the regex might capture accidentally.
                if candidate.lower() not in {"snapshot", "backup", "the", "a", "an"}:
                    inputs["name"] = candidate
            if re.search(r"\bskip\s+reload\b|\bno\s+reload\b|\bstage\b", raw, re.I):
                inputs["skip_reload"] = True
            inputs.pop("switch_ip", None)

        # fabric_drain_rotate / detect_routing_loop / arp_table_all /
        # mac_table_all: all inventory-wide; strip any switch_ip.
        if tool in ("fabric_drain_rotate", "detect_routing_loop",
                    "get_arp_table_all", "get_mac_table_all"):
            inputs.pop("switch_ip", None)

        # discover_fabric_from_seed: the "on X"/"from X" switch becomes
        # the seed. Fall back to the generic switch_ip the router already
        # extracted (e.g. the globally-selected switch).
        if tool == "discover_fabric_from_seed":
            if switch_ip:
                inputs["seed_switch_ip"] = switch_ip
            inputs.pop("switch_ip", None)
            # Optional "depth N" / "N hops"
            hops_m = re.search(r"\b(\d+)\s*hops?\b|\bdepth\s+(\d+)\b", raw, re.I)
            if hops_m:
                n = int(hops_m.group(1) or hops_m.group(2))
                if 1 <= n <= 5:
                    inputs["max_hops"] = n

        # get_fabric_config_diff: pick two switch aliases in order of
        # appearance. "diff config of vm1 and vm2" → left=vm1 right=vm2.
        if tool == "get_fabric_config_diff":
            matches = []
            for m in re.finditer(r"\b(vm\d|sonic\d|sonic-vm\d|(?:\d{1,3}\.){3}\d{1,3})\b", raw, re.I):
                token = m.group(1).lower()
                resolved = SWITCH_ALIASES.get(token, m.group(1))
                matches.append(resolved)
            # dedupe while preserving order
            seen = set(); uniq = []
            for ip in matches:
                if ip not in seen:
                    seen.add(ip); uniq.append(ip)
            if len(uniq) >= 2:
                inputs["left_switch_ip"]  = uniq[0]
                inputs["right_switch_ip"] = uniq[1]
                inputs.pop("switch_ip", None)  # not needed for diff
            # If <2 switches in the text, leave it for the user to fill
            # in via the Tools view.

        # User said "all" but the matched tool has no _all variant — keep
        # single-device call and note the limitation so the UI can surface it.
        if scope_all and not is_pseudo and tool not in _TOOLS_WITH_ALL_VARIANT:
            ambiguities.append(
                f"'all switches' scope requested, but {tool} has no multi-device "
                f"variant yet — falling back to a single-switch call"
                + (f" against {switch_ip}" if switch_ip else "")
            )

        return RoutedIntent(
            tool=tool,
            inputs=inputs,
            confidence="high",
            reason=f"matched pattern for {tool}: /{pattern}/",
            switch_ip=switch_ip,
            ambiguities=ambiguities,
        )

    # 2. Escape hatch: literal 'show …' command
    m = _SHOW_CMD_RE.search(raw)
    if m:
        show_cmd = m.group(1).strip()
        inputs = {"command": show_cmd}
        if switch_ip:
            inputs["switch_ip"] = switch_ip
        return RoutedIntent(
            tool="run_show_command",
            inputs=inputs,
            confidence="medium",
            reason=f"matched literal show command: '{show_cmd}'",
            switch_ip=switch_ip,
            ambiguities=ambiguities,
        )

    return None


# ---------------------------------------------------------------
# Static example prompts — shown by the UI as suggestions
# ---------------------------------------------------------------
EXAMPLES: List[str] = [
    "show interfaces on vm1",
    "list ip interfaces on vm1",
    "show routes on vm1",
    "show ipv6 routes on vm1",
    "bgp summary on vm1",
    "lldp neighbors on vm2",
    "system info for vm1",
    "system info for all switches",
    "show version on vm2",
    "uptime of vm1",
    "run 'show platform summary' on vm1",
    "run 'show vlan brief' on vm1",
    "shutdown Ethernet12 on vm1",
    "startup Ethernet12 on vm1",
    "set mtu of Ethernet12 to 9000 on vm1",
    "clear counters on vm1",
    "add vlan 250 on vm1",
    "remove vlan 250 on vm1",
    "save config on vm1",
    "show mutation history",
    "help",
]
