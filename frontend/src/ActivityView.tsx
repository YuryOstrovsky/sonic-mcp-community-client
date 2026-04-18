/**
 * Activity view — browsable mutation audit log.
 *
 * Just a thin wrapper: calls invoke('get_mutation_history', {limit}) on
 * mount (and on Refresh click), hands the payload to ActivityWidget.
 */

import {useEffect, useState} from "react";
import {FG} from "./lib/figmaStyles";
import {Button, ErrorBanner, Loading, Panel} from "./shared";
import {ActivityWidget} from "./widgets/ActivityWidget";
import {ApiError, invoke} from "./lib/api";

export function ActivityView() {
  const [payload, setPayload] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(200);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const res = await invoke("get_mutation_history", {limit});
      setPayload(res?.result?.payload ?? null);
    } catch (e: any) {
      setErr(e instanceof ApiError ? `${e.status}: ${e.message}` : (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div>
      <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12}}>
        <div>
          <h1 style={{margin: "0 0 4px 0", color: FG.titleColor, fontSize: 22, fontWeight: 600}}>Activity</h1>
          <div style={{fontSize: 12, color: FG.mutedColor}}>
            Server-side mutation ledger. Every MUTATION / DESTRUCTIVE invocation is recorded here with pre/post state.
          </div>
        </div>
        <div style={{display: "flex", alignItems: "center", gap: 8}}>
          <label style={{fontSize: 11, color: FG.mutedColor, textTransform: "uppercase", letterSpacing: 1}}>
            Last
          </label>
          <select
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value, 10))}
            style={{
              background: FG.inputBg,
              color: FG.inputColor,
              border: `1px solid ${FG.inputBorder}`,
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 12,
            }}
          >
            <option value={50}>50 entries</option>
            <option value={100}>100 entries</option>
            <option value={200}>200 entries</option>
            <option value={500}>500 entries</option>
          </select>
          <Button onClick={refresh} disabled={busy}>
            {busy ? "…" : "↻ Refresh"}
          </Button>
        </div>
      </div>

      {err && <div style={{marginBottom: 14}}><ErrorBanner>{err}</ErrorBanner></div>}

      {!payload && !err ? (
        <Panel><Loading label="loading mutation ledger…" /></Panel>
      ) : payload ? (
        <ActivityWidget payload={payload} />
      ) : null}
    </div>
  );
}
