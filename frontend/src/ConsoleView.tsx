/**
 * AI Console — chat-style interface backed by /api/nl?auto=true.
 *
 * Phase B: shows matched intent, invoked tool + inputs, raw JSON result.
 * Phase C: will replace JsonView with proper widgets per tool.
 * Phase D: LLM fallback for off-pattern queries.
 */

import {useEffect, useRef, useState, type FormEvent} from "react";
import {FG} from "./lib/figmaStyles";
import {displayName} from "./lib/state";
import {SUBMIT_PROMPT_EVENT} from "./widgets/HelpWidget";
import {ConfirmationModal} from "./ConfirmationModal";
import {
  Badge,
  Button,
  ErrorBanner,
  Panel,
  StatusPill,
  Loading,
} from "./shared";
import {ToolResultPanel} from "./widgets";
import {ApiError, getExamples, invoke, nl, type InvokeEnvelope, type NlResponse, type NlSuggestion, type ToolSpec} from "./lib/api";

type Turn =
  | {role: "user"; text: string; ts: number}
  | {role: "assistant"; response: NlResponse; ts: number}
  | {role: "assistant-error"; error: string; ts: number};

type PendingConfirm = {
  suggestion: NlSuggestion;
  toolSpec: ToolSpec;
};

export function ConsoleView(props: {
  selectedSwitch: string | null;
  tools: ToolSpec[] | null;
}) {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [examples, setExamples] = useState<string[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getExamples().then(setExamples).catch(() => setExamples([]));
  }, []);

  // Listen for prompt-submit events from HelpWidget (clicking an example chip)
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

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    // Auto-append selected-switch hint if the text doesn't already name one
    const decorated =
      props.selectedSwitch &&
      !/\b(vm\d|sonic\d|sonic-vm\d|\d+\.\d+\.\d+\.\d+)\b/i.test(trimmed)
        ? `${trimmed} on ${displayName(props.selectedSwitch)}`
        : trimmed;

    setTurns((t) => [...t, {role: "user", text: decorated, ts: Date.now()}]);
    setInput("");
    setBusy(true);

    try {
      // Two-stage flow so we can intercept mutations before they fire:
      //   1. Get suggestion only (auto=false)
      //   2. If the routed tool has requires_confirmation, pop the modal
      //   3. Otherwise invoke directly
      const res = await nl(decorated, {auto: false});

      if (!res.matched || !res.suggestion) {
        setTurns((t) => [...t, {role: "assistant", response: res, ts: Date.now()}]);
        setBusy(false);
        return;
      }

      // Pseudo-tools that the backend resolves locally (e.g. `help`) return
      // an already-populated `result` field from /api/nl. Using it directly
      // avoids a second round-trip to /api/invoke — which would 404 since
      // the MCP server doesn't know about these pseudo-tools.
      if (res.result) {
        setTurns((t) => [...t, {role: "assistant", response: res, ts: Date.now()}]);
        setBusy(false);
        return;
      }

      const toolName = res.suggestion.tool;
      const toolSpec = props.tools?.find((t) => t.name === toolName);

      if (toolSpec?.policy?.requires_confirmation) {
        setPendingConfirm({suggestion: res.suggestion, toolSpec});
        // Leave the user turn visible; assistant turn appears after confirm/cancel.
        setBusy(false);
        return;
      }

      // No confirmation required — invoke directly, preserving the suggestion
      // trace so the turn card still shows "matched X via regex/LLM".
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

    // Some tools don't need a switch_ip (the *_all fanouts, help) — otherwise
    // require one. If missing, surface a helpful error rather than invoking.
    const isFanout = tool.endsWith("_all");
    const isHelp = tool === "help";
    const needsSwitch = !isFanout && !isHelp;
    if (needsSwitch && !inputs.switch_ip) {
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
      // ── Fallback: server says "requires explicit confirmation" ─────────
      // This happens when our up-front `requires_confirmation` check missed
      // (e.g. tools catalog wasn't loaded yet, or the LLM picked a mutation
      // we didn't pre-screen). Instead of recording a failed turn, pop the
      // modal so the user can confirm — no one saw the attempt.
      const msg = String(e?.message || "");
      if (e?.status === 403 && /requires\s+explicit\s+confirmation/i.test(msg) && !confirm && nlResponse.suggestion) {
        // Prefer the full catalog entry when available, otherwise build a
        // minimal synthetic ToolSpec so the modal can still render.
        const toolSpec: ToolSpec = props.tools?.find((t) => t.name === tool) ?? {
          name: tool,
          description: "Mutation tool — catalog details unavailable (the client may have loaded before the tool list).",
          category: "mutation",
          transport: "",
          input_schema: {type: "object", properties: {}, required: []},
          policy: {risk: "MUTATION", allowed_in_auto_mode: false, requires_confirmation: true},
        };
        setPendingConfirm({suggestion: nlResponse.suggestion, toolSpec});
        return; // modal takes over; no turn recorded for the failed pre-check
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

  async function confirmPending() {
    if (!pendingConfirm) return;
    setBusy(true);
    const {suggestion, toolSpec} = pendingConfirm;
    setPendingConfirm(null);
    try {
      const fakeNl: NlResponse = {
        matched: true,
        text: "(confirmed from modal)",
        suggestion,
        source: "regex",
      } as NlResponse;
      void toolSpec;  // reserved for future use (e.g., inputs validation against schema)
      await directInvokeAndRecord(fakeNl, true);
    } catch (e: any) {
      const msg = e instanceof ApiError ? `${e.status}: ${e.message}` : (e?.message ?? String(e));
      setTurns((t) => [...t, {role: "assistant-error", error: msg, ts: Date.now()}]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      // Take the full height of our parent (which is now overflow:auto-bounded);
      // the chat history scrolls internally, not at the page level.
      height: "calc(100vh - 110px)",
      minHeight: 500,
      minWidth: 0,
      maxWidth: "100%",
      width: "100%",
    }}>
      {pendingConfirm && (
        <ConfirmationModal
          tool={pendingConfirm.toolSpec}
          inputs={pendingConfirm.suggestion.inputs ?? {}}
          busy={busy}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={confirmPending}
        />
      )}

      <h1 style={{margin: "0 0 12px 0", color: FG.titleColor, fontSize: 22, fontWeight: 600}}>
        AI Console
      </h1>
      <div style={{fontSize: 12, color: FG.mutedColor, marginBottom: 16}}>
        Ask a question in plain English. The deterministic router maps it to a tool + inputs
        and invokes it. Queries that don't match any regex pattern fall through to an LLM
        (OpenAI or Ollama) when one is configured in Settings.
      </div>

      {/* Examples strip */}
      {turns.length === 0 && examples.length > 0 && (
        <Panel title="Try one of these">
          <div style={{display: "flex", flexWrap: "wrap", gap: 8}}>
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => submit(ex)}
                style={{
                  padding: "6px 10px",
                  background: "transparent",
                  border: `1px solid ${FG.rowDefaultBorder}`,
                  borderRadius: 20,
                  color: FG.bodyColor,
                  fontSize: 12,
                  cursor: "pointer",
                  transition: FG.transition,
                }}
                onMouseEnter={(e) => {e.currentTarget.style.borderColor = FG.rowHoverBorder; e.currentTarget.style.background = FG.rowHoverBg;}}
                onMouseLeave={(e) => {e.currentTarget.style.borderColor = FG.rowDefaultBorder; e.currentTarget.style.background = "transparent";}}
              >{ex}</button>
            ))}
          </div>
        </Panel>
      )}

      {/* Turn history (scrollable) */}
      <div ref={scrollRef} style={{flex: 1, overflowY: "auto", overflowX: "hidden", paddingRight: 4, minWidth: 0}}>
        {turns.map((t, i) => (
          <TurnBlock key={t.ts + "-" + i} turn={t} />
        ))}
        {busy && (
          <div style={{padding: 12}}>
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
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 12,
          padding: 8,
          background: FG.containerBg,
          border: `1px solid ${FG.containerBorder}`,
          borderRadius: 12,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            props.selectedSwitch
              ? `Ask about ${displayName(props.selectedSwitch)} — e.g. "show bgp"  (press Enter ↵)`
              : `Ask — e.g. "show interfaces on vm1"  (press Enter ↵)`
          }
          autoFocus
          disabled={busy}
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            outline: "none",
            color: FG.bodyColor,
            fontSize: 14,
            padding: "6px 10px",
          }}
        />
        <Button type="submit" disabled={busy || !input.trim()} style={{minWidth: 100, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6}}>
          {busy ? (
            <><span className="loading-spin" /> asking…</>
          ) : (
            <>Ask <span style={{fontSize: 15, lineHeight: "15px"}}>↵</span></>
          )}
        </Button>
      </form>
    </div>
  );
}

function TurnBlock({turn}: {turn: Turn}) {
  if (turn.role === "user") {
    return (
      <div style={{
        background: FG.subtleBg,
        border: `1px solid ${FG.subtleBorder}`,
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 10,
        alignSelf: "flex-end",
      }}>
        <div style={{fontSize: 11, color: FG.mutedColor, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1.1}}>
          You
        </div>
        <div style={{color: FG.bodyColor, fontSize: 14}}>{turn.text}</div>
      </div>
    );
  }

  if (turn.role === "assistant-error") {
    return (
      <div style={{marginBottom: 10}}>
        <ErrorBanner>Assistant error: {turn.error}</ErrorBanner>
      </div>
    );
  }

  const r = turn.response;
  return (
    <Panel style={{marginBottom: 10}}>
      <div style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1.1, marginBottom: 8}}>
        Assistant
      </div>

      {!r.matched ? (
        <div>
          <div style={{color: FG.warningYellow, marginBottom: 6}}>No pattern matched.</div>
          <div style={{color: FG.mutedColor, fontSize: 13}}>{r.reason ?? "No regex pattern matched, and no LLM fallback is configured. Configure OpenAI or Ollama in Settings to handle off-script queries."}</div>
        </div>
      ) : (
        <>
          <div style={{display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8}}>
            <span style={{color: FG.headingColor, fontWeight: 600}}>{r.suggestion!.tool}</span>
            <StatusPill tone={r.suggestion!.confidence === "high" ? "good" : r.suggestion!.confidence === "medium" ? "warn" : "neutral"}>
              {r.suggestion!.confidence}
            </StatusPill>
            {r.source === "llm" && (
              <StatusPill tone="info" title={r.suggestion!.reason}>🤖 via LLM</StatusPill>
            )}
            {r.suggestion!.switch_ip && <Badge title={r.suggestion!.switch_ip}>{displayName(r.suggestion!.switch_ip)}</Badge>}
            {Object.entries(r.suggestion!.inputs).filter(([k]) => k !== "switch_ip").map(([k, v]) => (
              <Badge key={k}>{k}={String(v)}</Badge>
            ))}
          </div>

          {r.suggestion!.ambiguities?.length > 0 && (
            <div style={{
              background: FG.warningBg,
              border: `1px solid ${FG.warningBorder}`,
              color: FG.warningYellow,
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 8,
              fontSize: 12,
            }}>
              {r.suggestion!.ambiguities.join("; ")}
            </div>
          )}

          {!r.result && (
            <div style={{color: FG.mutedColor, fontSize: 12, marginBottom: 8}}>
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
                <span style={{fontSize: 11, color: FG.mutedColor}}>
                  result of {r.result.result?.tool ?? r.suggestion!.tool}
                </span>
              }
            />
          )}
        </>
      )}
    </Panel>
  );
}
