/**
 * Export helpers for tool results.
 *
 * Three formats:
 *   - JSON: full payload, pretty-printed (best for pasting into tickets)
 *   - Markdown: if the payload has an "entries" or "routes"/"interfaces"
 *     array of objects, render as a Markdown table; otherwise JSON fenced
 *   - CSV: same array-of-objects → CSV; otherwise empty
 *
 * `copyToClipboard` handles the HTTP / non-secure-context case (the
 * lab runs over plain HTTP, where navigator.clipboard is unavailable)
 * by falling back to the legacy execCommand textarea trick.
 */

import {notify} from "./notify";


export async function copyToClipboard(text: string, successMsg = "copied to clipboard") {
  // Try the modern API first.
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      notify.ok(successMsg);
      return;
    } catch { /* fall through to legacy */ }
  }
  // Legacy fallback for HTTP contexts.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    const ok = document.execCommand("copy");
    if (ok) notify.ok(successMsg);
    else notify.err("copy failed", "browser blocked clipboard access");
  } catch (e: any) {
    notify.err("copy failed", e?.message ?? String(e));
  } finally {
    document.body.removeChild(ta);
  }
}


export function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  notify.ok(`downloaded ${filename}`);
}


/** Find the first "table-like" array inside a payload, if any. */
export function detectTableArray(payload: any): any[] | null {
  if (!payload || typeof payload !== "object") return null;
  // Common shapes from our catalog.
  const candidates = [
    "entries", "routes", "interfaces", "ip_interfaces", "rows",
    "peers", "neighbors", "vlans", "portchannels", "hops",
    "matches", "healthy_links", "broken_links",
  ];
  for (const key of candidates) {
    const v = payload[key];
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return v;
  }
  // Fall back: if there's exactly one array-of-objects field, use it.
  const arrayFields = Object.entries(payload).filter(
    ([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === "object",
  );
  return arrayFields.length === 1 ? (arrayFields[0][1] as any[]) : null;
}


export function toMarkdown(tool: string, payload: any): string {
  const rows = detectTableArray(payload);
  const header = `# ${tool}\n\n`;
  if (!rows) {
    return `${header}\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
  }
  // Union of all keys — preserves "missing" as empty cells.
  const keys: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  }
  const esc = (v: any) => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  };
  const head = `| ${keys.join(" | ")} |`;
  const sep  = `| ${keys.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${keys.map((k) => esc(r[k])).join(" | ")} |`).join("\n");
  const summary = payload.summary
    ? `\n**Summary**\n\n\`\`\`json\n${JSON.stringify(payload.summary, null, 2)}\n\`\`\`\n\n`
    : "";
  return `${header}${summary}${head}\n${sep}\n${body}\n`;
}


export function toCsv(payload: any): string | null {
  const rows = detectTableArray(payload);
  if (!rows) return null;
  const keys: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  }
  const cell = (v: any) => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = keys.join(",");
  const body = rows.map((r) => keys.map((k) => cell(r[k])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}
