/**
 * Minimal client-side API wrapper.
 *
 * No auth (community-grade). Session ID is stored in sessionStorage so it
 * survives page refresh but not tab close — matches the MCP server's
 * session model. Always sent as the `X-MCP-Session` header via the backend
 * proxy, which forwards to the MCP server.
 */

const SESSION_KEY = "sonic_mcp_session";
// Use the Vite dev-proxy prefix so /api/* works in both dev and prod builds.
const API = "/api";

// ─── Session ──────────────────────────────────────────────────────────────
export function getSession(): string | null {
  return sessionStorage.getItem(SESSION_KEY);
}
export function setSession(id: string): void {
  sessionStorage.setItem(SESSION_KEY, id);
}
export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

function headers(): HeadersInit {
  const h: Record<string, string> = {"Content-Type": "application/json"};
  const s = getSession();
  if (s) h["X-MCP-Session"] = s;
  return h;
}

async function parseOrThrow(r: Response): Promise<any> {
  const text = await r.text();
  let body: any;
  try { body = text ? JSON.parse(text) : null; } catch { body = {_raw: text}; }
  if (!r.ok) {
    const detail = (body && typeof body === "object" && "detail" in body) ? body.detail : body;
    throw new ApiError(r.status, typeof detail === "string" ? detail : JSON.stringify(detail), body);
  }
  return body;
}

// ─── Error type ───────────────────────────────────────────────────────────
export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, message: string, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// ─── Typed helpers ────────────────────────────────────────────────────────
export type ToolSpec = {
  name: string;
  description: string;
  category: string;
  transport: string;
  input_schema: { type: string; properties: Record<string, any>; required?: string[] };
  policy: { risk: string; allowed_in_auto_mode: boolean; requires_confirmation: boolean };
  tags?: string[];
};

export type InvokeEnvelope = {
  session_id: string;
  result: {
    tool: string;
    status: number;
    payload: any;
    context: Record<string, any>;
    meta: Record<string, any>;
    explain: Record<string, any>;
  };
};

export type NlSuggestion = {
  tool: string;
  inputs: Record<string, any>;
  confidence: "high" | "medium" | "low";
  reason: string;
  switch_ip: string | null;
  ambiguities: string[];
};

export type NlResponse = {
  matched: boolean;
  text: string;
  suggestion: NlSuggestion | null;
  reason?: string;
  source?: "regex" | "llm";
  llm_trace?: any;
  result?: InvokeEnvelope;
  result_status?: number;
};

// ─── API calls ────────────────────────────────────────────────────────────
export async function getHealth(): Promise<any> {
  return parseOrThrow(await fetch(`${API}/health`));
}

export async function getReady(): Promise<any> {
  return parseOrThrow(await fetch(`${API}/ready`));
}

export async function getTools(): Promise<ToolSpec[]> {
  return parseOrThrow(await fetch(`${API}/tools`));
}

export async function invoke(
  tool: string,
  inputs: Record<string, any> = {},
  opts: {confirm?: boolean} = {},
): Promise<InvokeEnvelope> {
  const reqBody: Record<string, any> = {tool, inputs};
  if (opts.confirm) reqBody.confirm = true;
  const r = await fetch(`${API}/invoke`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(reqBody),
  });
  const body = await parseOrThrow(r);
  if (body && body.session_id) setSession(body.session_id);
  return body;
}

export async function nl(text: string, opts?: {auto?: boolean}): Promise<NlResponse> {
  const q = opts?.auto ? "?auto=true" : "";
  const r = await fetch(`${API}/nl${q}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({text}),
  });
  const body = await parseOrThrow(r);
  if (body?.result?.session_id) setSession(body.result.session_id);
  return body;
}

export async function getExamples(): Promise<string[]> {
  const body = await parseOrThrow(await fetch(`${API}/examples`));
  return body?.examples ?? [];
}

export async function getClientSettings(): Promise<any> {
  return parseOrThrow(await fetch(`${API}/client-settings`));
}

export async function getHelp(): Promise<any> {
  return parseOrThrow(await fetch(`${API}/help`));
}

export async function getLlmStatus(): Promise<any> {
  return parseOrThrow(await fetch(`${API}/llm-status`));
}

export async function setOpenAIKey(key: string | null): Promise<{configured: boolean}> {
  const r = await fetch(`${API}/openai-key`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({api_key: key}),
  });
  return parseOrThrow(r);
}

export type SettingsView = {
  openai: {
    configured: boolean;
    key_preview: string | null;
    key_source: "settings.json" | "env" | null;
    model: string;
    model_source: "settings.json" | "env" | "default";
  };
  ollama: {
    enabled: boolean;
    base_url: string;
    model: string;
    enabled_source: "settings.json" | "env" | "default";
  };
  preferred_provider: "openai" | "ollama" | "auto";
  effective_provider: "openai" | "ollama" | null;
  preference: "openai" | "ollama" | null;   // legacy alias for effective_provider
  storage_path: string;
};

export async function getSettings(): Promise<SettingsView> {
  return parseOrThrow(await fetch(`${API}/settings`));
}

export async function patchSettings(update: {
  openai?: Record<string, any>;
  ollama?: Record<string, any>;
  preferred_provider?: "openai" | "ollama" | "auto";
}): Promise<SettingsView> {
  const r = await fetch(`${API}/settings`, {
    method: "PATCH",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(update),
  });
  return parseOrThrow(r);
}
