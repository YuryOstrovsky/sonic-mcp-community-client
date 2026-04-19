/**
 * AI Console — chat-style interface backed by /api/nl?auto=true.
 */

import {useEffect, useRef, useState, type FormEvent} from "react";
import {AlertTriangle, ChevronDown, ChevronRight, Send} from "lucide-react";
import {cn} from "./lib/cn";
import {displayName} from "./lib/state";
import {SUBMIT_PROMPT_EVENT} from "./widgets/HelpWidget";
import {ConfirmationModal} from "./ConfirmationModal";
import {ErrorBanner, StatusPill, Badge, Loading} from "./shared";
import {copyToClipboard} from "./lib/export";
void ErrorBanner;
import {ToolResultPanel} from "./widgets";
import {ApiError, invoke, nl, type InvokeEnvelope, type NlResponse, type NlSuggestion, type ToolSpec} from "./lib/api";

type Turn =
  | {role: "user"; text: string; ts: number}
  | {role: "assistant"; response: NlResponse; ts: number}
  | {role: "assistant-error"; error: string; ts: number};

// ─── Persistent history ───────────────────────────────────────
// Stored as JSON in localStorage. We cap the turn count so LS doesn't
// grow unbounded on a long-running session. On load we tolerate any
// parse error and fall back to an empty history — better to start fresh
// than to crash the view with a bad blob.
const HISTORY_KEY = "sonic-mcp:console-history";
const MAX_HISTORY = 50;

function loadHistory(): Turn[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_HISTORY) : [];
  } catch { return []; }
}
function saveHistory(turns: Turn[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(turns.slice(-MAX_HISTORY)));
  } catch {/* quota / private mode — silently ignore */}
}

type PendingConfirm = {
  suggestion: NlSuggestion;
  toolSpec: ToolSpec;
};

export function ConsoleView(props: {
  selectedSwitch: string | null;
  tools: ToolSpec[] | null;
}) {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>(() => loadHistory());
  const [busy, setBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent<string>).detail;
      if (typeof prompt === "string" && prompt.trim()) submit(prompt);
    };
    window.addEventListener(SUBMIT_PROMPT_EVENT, handler);
    return () => window.removeEventListener(SUBMIT_PROMPT_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, props.selectedSwitch]);

  useEffect(() => {
    scrollRef.current?.scrollTo({top: scrollRef.current.scrollHeight, behavior: "smooth"});
  }, [turns]);

  // Persist history across page reloads — cap at MAX_HISTORY so LS never
  // grows unbounded. Oldest turns drop off the front.
  useEffect(() => {
    saveHistory(turns);
  }, [turns]);

  function clearHistory() {
    setTurns([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch {/* ignore */}
  }

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    // Auto-decorate with the globally-selected switch so single-switch
    // tools don't need the user to retype it. Two special cases:
    //   1. "ping X" (without "from") needs a SOURCE — we append "from <sel>"
    //      so the server knows which switch is firing the ICMP.
    //   2. Everything else: if no switch reference at all, append "on <sel>".
    let decorated = trimmed;
    if (props.selectedSwitch) {
      const sel = displayName(props.selectedSwitch);
      const hasSwitchRef = /\b(vm\d|sonic\d|sonic-vm\d|\d+\.\d+\.\d+\.\d+)\b/i.test(trimmed);
      // Tools that need a SOURCE switch explicitly. If the query mentions
      // the tool verb but doesn't name a source ("from X"), auto-append the
      // globally-selected switch.
      const needsSourceOn = /\b(ping|traceroute|trace\s+route|iperf3?|throughput)\b/i.test(trimmed)
        && !/\bfrom\b/i.test(trimmed);
      if (needsSourceOn) {
        decorated = `${trimmed} from ${sel}`;
      } else if (!hasSwitchRef) {
        decorated = `${trimmed} on ${sel}`;
      }
    }

    setTurns((t) => [...t, {role: "user", text: decorated, ts: Date.now()}]);
    setInput("");
    setBusy(true);

    try {
      const res = await nl(decorated, {auto: false});

      if (!res.matched || !res.suggestion) {
        setTurns((t) => [...t, {role: "assistant", response: res, ts: Date.now()}]);
        setBusy(false);
        return;
      }

      // Pseudo-tools like `help` come back pre-resolved — use that result
      // directly and skip the /api/invoke round-trip (would 404).
      if (res.result) {
        setTurns((t) => [...t, {role: "assistant", response: res, ts: Date.now()}]);
        setBusy(false);
        return;
      }

      const toolName = res.suggestion.tool;
      const toolSpec = props.tools?.find((t) => t.name === toolName);

      if (toolSpec?.policy?.requires_confirmation) {
        setPendingConfirm({suggestion: res.suggestion, toolSpec});
        setBusy(false);
        return;
      }

      await directInvokeAndRecord(res);
    } catch (e: any) {
      const msg = e instanceof ApiError
        ? `${e.status}: ${e.message}`
        : (e?.message ?? String(e));
      setTurns((t) => [...t, {role: "assistant-error", error: msg, ts: Date.now()}]);
    } finally {
      setBusy(false);
    }
  }

  async function directInvokeAndRecord(nlResponse: NlResponse, confirm: boolean = false) {
    if (!nlResponse.suggestion) return;
    const {tool, inputs} = nlResponse.suggestion;

    const isFanout = tool.endsWith("_all");
    const isHelp = tool === "help";
    // Inventory-wide fabric reads don't need a switch.
    const INVENTORY_WIDE = new Set([
      "get_fabric_topology",
      "get_fabric_health",
      "get_fabric_reachability_matrix",
      "get_fabric_mtu_consistency",
      "get_fabric_bandwidth",
      "validate_fabric_vs_intent",
      "get_routes_by_prefix",
      "fabric_drain_rotate",
      "detect_routing_loop",
      "rollback_mutation",
      "save_fabric_snapshot",
      "restore_fabric_snapshot",
      "compare_fabric_snapshots",
    ]);
    // Diff tool uses left_switch_ip / right_switch_ip; ping/trace/iperf use
    // source_switch_ip. Neither field is `switch_ip`.
    const usesSourceSwitch =
      tool === "ping_between" ||
      tool === "traceroute_between" ||
      tool === "iperf_between";
    // discover_fabric_from_seed uses seed_switch_ip (parallel to source_switch_ip).
    const usesSeedSwitch = tool === "discover_fabric_from_seed";
    const usesLeftRight = tool === "get_fabric_config_diff";
    const hasSwitchId =
      !!inputs.switch_ip ||
      (usesSourceSwitch && !!inputs.source_switch_ip) ||
      (usesSeedSwitch && !!inputs.seed_switch_ip) ||
      (usesLeftRight && !!inputs.left_switch_ip && !!inputs.right_switch_ip);
    const needsSwitch = !isFanout && !isHelp && !INVENTORY_WIDE.has(tool);
    if (needsSwitch && !hasSwitchId) {
      const errTurn: NlResponse = {
        ...nlResponse,
        result_status: 422,
        result: {
          session_id: "",
          result: {
            tool,
            status: 422,
            payload: {error: "no switch identified — pick a target switch in the top-right dropdown first"},
            context: {},
            meta: {},
            explain: {},
          },
        } as any,
      };
      setTurns((t) => [...t, {role: "assistant", response: errTurn, ts: Date.now()}]);
      return;
    }

    let envelope: InvokeEnvelope | null = null;
    let resultStatus = 200;
    try {
      envelope = await invoke(tool, inputs ?? {}, {confirm});
    } catch (e: any) {
      // Server says "requires explicit confirmation" — pop the modal so the
      // user can confirm. Synthesize a minimal ToolSpec if catalog isn't loaded.
      const msg = String(e?.message || "");
      if (e?.status === 403 && /requires\s+explicit\s+confirmation/i.test(msg) && !confirm && nlResponse.suggestion) {
        const toolSpec: ToolSpec = props.tools?.find((t) => t.name === tool) ?? {
          name: tool,
          description: "Mutation tool — catalog details unavailable.",
          category: "mutation",
          transport: "",
          input_schema: {type: "object", properties: {}, required: []},
          policy: {risk: "MUTATION", allowed_in_auto_mode: false, requires_confirmation: true},
        };
        setPendingConfirm({suggestion: nlResponse.suggestion, toolSpec});
        return;
      }
      resultStatus = e?.status ?? 500;
      envelope = {
        session_id: "",
        result: {
          tool,
          status: resultStatus,
          payload: {error: e?.message ?? String(e), detail: e?.body ?? null},
          context: {},
          meta: {},
          explain: {},
        },
      } as any;
    }

    setTurns((t) => [...t, {
      role: "assistant",
      response: {
        ...nlResponse,
        result: envelope ?? undefined,
        result_status: resultStatus,
      },
      ts: Date.now(),
    }]);
  }

  async function confirmPending(editedInputs: Record<string, any>) {
    if (!pendingConfirm) return;
    setBusy(true);
    const {suggestion, toolSpec} = pendingConfirm;
    setPendingConfirm(null);
    try {
      // Overlay the user's edits on top of the original suggestion so the
      // tool name/source stays, but the inputs reflect what the user typed
      // in the modal.
      const fakeNl: NlResponse = {
        matched: true,
        text: "(confirmed from modal)",
        suggestion: {...suggestion, inputs: {...editedInputs}},
        source: "regex",
      } as NlResponse;
      void toolSpec;
      await directInvokeAndRecord(fakeNl, true);
    } catch (e: any) {
      const msg = e instanceof ApiError ? `${e.status}: ${e.message}` : (e?.message ?? String(e));
      setTurns((t) => [...t, {role: "assistant-error", error: msg, ts: Date.now()}]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-112px)] min-h-[500px] w-full flex-col">
      {pendingConfirm && (
        <ConfirmationModal
          tool={pendingConfirm.toolSpec}
          inputs={pendingConfirm.suggestion.inputs ?? {}}
          busy={busy}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={confirmPending}
        />
      )}

      <div className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-gray-100">AI Console</h1>
          {turns.length > 0 && (
            <button
              onClick={clearHistory}
              title={`Clear ${turns.length} saved turn${turns.length === 1 ? "" : "s"}`}
              className="rounded border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-gray-300 hover:bg-white/[0.08]"
            >Clear history ({turns.length})</button>
          )}
        </div>
        <p className="mt-2 text-sm text-gray-400">
          Ask a question in plain English. The deterministic router maps it to a tool + inputs
          and invokes it. Queries that don't match any regex pattern fall through to an LLM
          (OpenAI or Ollama) when one is configured in Settings.
          History persists across reloads (last {MAX_HISTORY} turns).
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Tip: Type{" "}
          <button
            type="button"
            onClick={() => submit("help")}
            className="cursor-pointer rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-xs text-gray-300 transition-colors hover:bg-white/[0.08]"
          >
            help
          </button>
          {" "}any time to see available commands.
        </p>
      </div>

      {/* Turn history (scrollable) */}
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
        {turns.map((t, i) => (
          <TurnBlock key={t.ts + "-" + i} turn={t} />
        ))}
        {busy && (
          <div className="p-3">
            <Loading label="routing + invoking…" />
          </div>
        )}
      </div>

      {/* Input bar */}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit(input);
        }}
        className="mt-3 flex items-center gap-3 border-t border-white/[0.06] pt-4"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            props.selectedSwitch
              ? `Ask about ${displayName(props.selectedSwitch)} — e.g. "show bgp" (press Enter ↵)`
              : `Ask — e.g. "show interfaces on vm1" (press Enter ↵)`
          }
          autoFocus
          disabled={busy}
          className={cn(
            "flex-1 rounded-lg border border-white/10 bg-[#1a2332] px-4 py-3 text-sm text-gray-200 placeholder:text-gray-500",
            "focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20",
            "disabled:opacity-60",
          )}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:pointer-events-none disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {busy ? "asking…" : "Ask"}
        </button>
      </form>
    </div>
  );
}

function TurnBlock({turn}: {turn: Turn}) {
  if (turn.role === "user") {
    return (
      <div className="mb-3 ml-auto max-w-[80%] rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-2.5">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">You</div>
        <div className="text-sm text-gray-200">{turn.text}</div>
      </div>
    );
  }

  if (turn.role === "assistant-error") {
    return <ErrorTurnCard error={turn.error} />;
  }

  const r = turn.response;
  return (
    <div className="mb-3 rounded-lg border border-white/[0.08] bg-[#1a2332] p-4">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-gray-500">Assistant</div>

      {!r.matched ? (
        <div>
          <div className="mb-1.5 text-sm text-yellow-300">No pattern matched.</div>
          <div className="text-xs text-gray-400">
            {r.reason ?? "No regex pattern matched, and no LLM fallback is configured. Configure OpenAI or Ollama in Settings to handle off-script queries."}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-gray-100">{r.suggestion!.tool}</span>
            {/* The regex router is the expected path (90%+ of calls) — no */}
            {/* badge needed. Only flag the LLM fallback so users can tell  */}
            {/* when a non-deterministic pick was made.                     */}
            {r.source === "llm" && (
              <StatusPill tone="info" title={r.suggestion!.reason}>🤖 via LLM</StatusPill>
            )}
            {r.suggestion!.switch_ip && (
              <Badge title={r.suggestion!.switch_ip}>{displayName(r.suggestion!.switch_ip)}</Badge>
            )}
            {Object.entries(r.suggestion!.inputs).filter(([k]) => k !== "switch_ip").map(([k, v]) => (
              <Badge key={k}>{k}={String(v)}</Badge>
            ))}
          </div>

          {r.suggestion!.ambiguities?.length > 0 && (
            <div className="mb-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
              {r.suggestion!.ambiguities.join("; ")}
            </div>
          )}

          {!r.result && (
            <div className="mb-2 text-xs text-gray-500">
              (not invoked — no switch in the query and none selected)
            </div>
          )}

          {r.result && (
            <ToolResultPanel
              tool={r.result.result?.tool ?? r.suggestion!.tool}
              payload={r.result.result?.payload ?? r.result}
              meta={{
                status: r.result_status,
                transport: r.result.result?.meta?.transport,
                duration_ms: r.result.result?.meta?.duration_ms,
              }}
              title={
                <span className="text-[11px] text-gray-500">
                  result of {r.result.result?.tool ?? r.suggestion!.tool}
                </span>
              }
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Structured error card ────────────────────────────────────
//
// Replaces the old single-line red banner. Surfaces the error message
// prominently, classifies common patterns into actionable tips, and
// provides "copy error" + "open Activity" actions.

function ErrorTurnCard({error}: {error: string}) {
  const [expanded, setExpanded] = useState(false);
  const {title, hint} = classifyError(error);

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-red-500/30 bg-red-500/5">
      <div className="flex items-start gap-3 p-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-400" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-200">
            {title}
          </div>
          {hint && (
            <div className="mt-1 text-xs text-red-200/70">{hint}</div>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-xs text-red-300/80 hover:text-red-200"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {expanded ? "hide details" : "show details"}
          </button>
          {expanded && (
            <pre className="mt-2 max-h-48 overflow-auto rounded border border-red-500/20 bg-[#0d0b0b] p-2 font-mono text-[11px] text-red-200 whitespace-pre-wrap break-words">
              {error}
            </pre>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => copyToClipboard(error, "error copied")}
            className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-gray-300 hover:bg-white/[0.08]"
          >copy</button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("sonic-mcp:open-view", {detail: "activity"}))}
            className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-gray-300 hover:bg-white/[0.08]"
            title="Open the Activity view to see the full ledger"
          >activity</button>
        </div>
      </div>
    </div>
  );
}

// Best-effort classification of common failure strings into friendlier
// titles + short hints. Falls through to a generic "Tool invocation failed".
function classifyError(raw: string): {title: string; hint?: string} {
  const msg = raw.toLowerCase();
  if (/requires\s+explicit\s+confirmation/.test(msg)) {
    return {
      title: "Requires confirmation",
      hint: "Try again — the confirmation modal should pop up and let you review inputs before running.",
    };
  }
  if (/403/.test(msg) && /mutation/.test(msg)) {
    return {
      title: "Mutations disabled server-side",
      hint: "Set MCP_MUTATIONS_ENABLED=1 in the server's .env and restart.",
    };
  }
  if (/timeout|timed out/.test(msg)) {
    return {
      title: "Upstream timeout",
      hint: "The switch or the MCP server didn't answer in time. Check reachability on the Dashboard.",
    };
  }
  if (/connection refused|refused|unreachable/.test(msg)) {
    return {title: "Switch unreachable", hint: "Management IP isn't answering. Confirm it's in the inventory and powered on."};
  }
  if (/authentication failed|auth(entication)? (error|failed)/.test(msg)) {
    return {title: "Authentication failed", hint: "Check SONIC_DEFAULT_USERNAME / _PASSWORD in the server's .env."};
  }
  if (/no switch identified/.test(msg)) {
    return {title: "No target switch", hint: "Pick one from the top-bar dropdown or include \"on vm1\" in your prompt."};
  }
  if (/missing required input|is required/.test(msg)) {
    return {title: "Missing required input", hint: "The tool needs an argument that wasn't in the prompt. Try the Tools view for a form-based input."};
  }
  if (/503/.test(msg)) {
    return {title: "Server not ready", hint: "MCP server reports /ready 503 — check its logs."};
  }
  return {title: "Tool invocation failed"};
}
