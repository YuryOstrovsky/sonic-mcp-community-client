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

    Resolution order:
      1. Any bare IPv4 literal in the text (matched against SWITCH_ALIASES first,
         or accepted if it looks like a valid IP)
      2. Any alias token ("vm1", "sonic1", etc.) — word-boundary match
    """
    if not text:
        return None
    t = text.lower()

    for m in _IP_RE.finditer(text):
        ip = m.group(0)
        if ip in SWITCH_ALIASES:
            return SWITCH_ALIASES[ip]
        return ip

    # alias tokens — check longest first so "sonic-vm1" beats "vm1"
    aliases_sorted = sorted(SWITCH_ALIASES.keys(), key=len, reverse=True)
    for alias in aliases_sorted:
        if re.search(rf"(?<![\w\-.]){re.escape(alias)}(?![\w\-.])", t):
            return SWITCH_ALIASES[alias]
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
