/**
 * Widget for run_show_command — terminal-style stdout display.
 * Payload: { summary: {command, exit_status, duration_ms, truncated, stdout_bytes, stderr_bytes},
 *            stdout: string, stderr: string }
 */

import {FG} from "../lib/figmaStyles";
import {Badge, CopyButton, StatusPill} from "../shared";
import {Section} from "./common";

export function ShowCommandWidget({payload}: {payload: any}) {
  const summary = payload?.summary ?? {};
  const stdout = payload?.stdout ?? "";
  const stderr = payload?.stderr ?? "";
  const exit = summary.exit_status;

  return (
    <div>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 10,
        flexWrap: "wrap",
      }}>
        <StatusPill tone={exit === 0 ? "good" : "bad"}>exit {exit ?? "?"}</StatusPill>
        <Badge>{summary.duration_ms ?? "?"}ms</Badge>
        <Badge>{summary.stdout_bytes ?? 0} bytes stdout</Badge>
        {summary.stderr_bytes > 0 && <Badge>{summary.stderr_bytes} bytes stderr</Badge>}
        {summary.truncated && <StatusPill tone="warn">truncated</StatusPill>}
      </div>

      <Section
        title={`$ ${summary.command ?? "(no command)"}`}
        right={<CopyButton text={stdout} label="copy stdout" />}
      >
        <pre style={{
          background: "var(--bg0)",
          color: FG.bodyColor,
          border: `1px solid ${FG.divider}`,
          borderRadius: 8,
          padding: 12,
          fontSize: 12.5,
          lineHeight: 1.5,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          margin: 0,
          maxHeight: 500,
          overflow: "auto",
          whiteSpace: "pre",
        }}>{stdout || <span style={{color: FG.dimColor}}>(no stdout)</span>}</pre>
      </Section>

      {stderr && stderr.trim() && (
        <Section title="stderr">
          <pre style={{
            background: FG.errorBg,
            color: FG.errorRed,
            border: `1px solid ${FG.errorBorder}`,
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            margin: 0,
            maxHeight: 200,
            overflow: "auto",
            whiteSpace: "pre",
          }}>{stderr}</pre>
        </Section>
      )}
    </div>
  );
}
