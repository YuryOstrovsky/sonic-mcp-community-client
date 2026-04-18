/**
 * Small state helpers: switch alias mapping + localStorage persistence.
 * Mirrors backend/nl_router.py SWITCH_ALIASES.
 */

// Alias map (shortName → management IP). Kept in sync with the backend's
// nl_router.SWITCH_ALIASES. Edit both together if you add devices.
export const SWITCH_DISPLAY: Record<string, string> = {
  "10.46.11.50": "VM1",
  "10.46.11.51": "VM2",
};

export function displayName(ip: string): string {
  return SWITCH_DISPLAY[ip] ?? ip;
}

// ── localStorage-backed selected switch ────────────────────────────
const SELECTED_SWITCH_KEY = "sonic_mcp_selected_switch";

export function loadSelectedSwitch(): string | null {
  try {
    return localStorage.getItem(SELECTED_SWITCH_KEY);
  } catch {
    return null;
  }
}

export function saveSelectedSwitch(ip: string | null): void {
  try {
    if (ip === null) localStorage.removeItem(SELECTED_SWITCH_KEY);
    else localStorage.setItem(SELECTED_SWITCH_KEY, ip);
  } catch {
    /* localStorage disabled — ignore */
  }
}
