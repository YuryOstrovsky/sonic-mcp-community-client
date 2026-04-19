# Contributing to SONiC MCP Community Client

Thanks for considering a contribution! The most common contributions
here are:

1. **A new widget** for a tool that currently renders as JSON.
2. **An NL pattern** so a tool that currently needs the Tools view can
   be invoked from the AI Console.
3. **Bug fixes** in existing widgets or the confirm-mutation modal.
4. **A new NL-level feature** (a new kind of input extractor, a new
   field-suggestion provider, etc.).

This doc walks you through each. The general rule: the server is the
source of truth for tools; the client reacts to whatever `/tools`
returns. You shouldn't need to touch server code to add client features.

## Quickstart

```bash
git clone https://github.com/YuryOstrovsky/sonic-mcp-community-client
cd sonic-mcp-community-client

# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # point MCP_BASE_URL at your server

# Frontend
cd ../frontend
npm ci

# Run
cd ../backend && uvicorn main:app --port 5174 --reload &
cd ../frontend && npm run dev         # http://<host>:5173
```

## Layout

```
backend/
  main.py          FastAPI routes: /api/health /api/tools /api/invoke
                   /api/nl /api/settings /api/fabric-intent
                   /api/inventory* …
  nl_router.py     Regex-based text → {tool, inputs} routing
  llm.py           OpenAI + Ollama backends for the NL fallback path
  .env.example     Runtime configuration template

frontend/
  src/
    App.tsx        View shell + global event listeners
    Sidebar.tsx    Left nav (Dashboard / Fabric / Console / Tools /
                   Activity / Settings)
    ConfirmationModal.tsx  Editable-input mutation gate
    CommandPalette.tsx     Cmd/Ctrl-K overlay
    HealthBadge.tsx        Auto-refresh + fabric-health dot
    widgets/
      index.tsx    Widget registry (tool name → component)
      common.tsx   Shared primitives: Table, KvGrid, SummaryStrip
      RowActions.tsx   "⋯" row menu helper
      <ToolName>Widget.tsx
    lib/
      api.ts       Thin HTTP wrapper, InvokeEnvelope types
      notify.ts    Toast helpers (sonner)
      export.ts    Copy/download helpers (JSON / MD / CSV)
      fieldSuggestions.ts  Live suggestion provider registry
```

## Adding a widget

A widget is a React component that renders the payload of one tool.
The `widgets/index.tsx` registry maps each tool name to its widget
(unknown tools fall back to pretty-printed JSON).

### 1. Call the tool via the Tools view to see its payload shape

Open **Tools**, pick your tool, fill inputs, hit Run. The result panel
has a `{ } raw` toggle — copy the JSON into your editor as a guide.

### 2. Write the component

```tsx
// frontend/src/widgets/MyToolWidget.tsx
import {type Column, SummaryStrip, Table} from "./common";

type Row = {name: string; ok: boolean; count: number};

export function MyToolWidget({payload}: {payload: any}) {
  const rows: Row[] = payload?.entries ?? [];
  const summary = payload?.summary ?? {};

  const columns: Column<Row>[] = [
    {key: "name", label: "Name", mono: true},
    {key: "ok",   label: "OK",   render: (r) => r.ok ? "✓" : "✗"},
    {key: "count", label: "Count", align: "right", mono: true},
  ];

  return (
    <div>
      <SummaryStrip items={[
        {label: "Entries", value: rows.length},
        {label: "All OK",  value: rows.every(r => r.ok) ? "yes" : "no"},
      ]} />
      <Table
        columns={columns}
        rows={rows}
        getKey={(r) => r.name}
        filterText={(r) => r.name}
        filterPlaceholder="filter…"
      />
    </div>
  );
}
```

### 3. Register it

```tsx
// frontend/src/widgets/index.tsx
import {MyToolWidget} from "./MyToolWidget";

const REGISTRY: Record<string, WidgetRender> = {
  // … existing entries …
  my_tool: (p) => <MyToolWidget payload={p.payload} />,
};
```

That's it — every code path that handles tool results (ConsoleView,
ToolsView, MultiDeviceWidget) picks the new widget up automatically.

## Adding an NL pattern

NL routing lives in `backend/nl_router.py`. Add a `(tool_name,
[compiled_regex, …])` block to `_PATTERNS`, then (if your tool takes
inputs beyond `switch_ip`) add an extraction clause inside `route()`.

**Order matters.** The first matching tool wins. Place mutations above
their sibling reads (so `add vlan 250` beats `get_vlans`'s bare
`\bvlans?\b` fallback).

```python
# _PATTERNS entry
(
    "my_tool",
    [
        re.compile(r"\bmy\s+tool\b.*\bEthernet\d+\b", re.I),
        re.compile(r"\brun\s+my\s+tool\b", re.I),
    ],
),

# Input extraction inside route()
if tool == "my_tool":
    iface_m = re.search(r"\bEthernet(\d+)\b", raw, re.I)
    if iface_m:
        inputs["interface"] = f"Ethernet{iface_m.group(1)}"
```

Test routing without booting the UI:

```bash
python3 -c "
import sys; sys.path.insert(0, 'backend')
from nl_router import route
print(route('run my tool on Ethernet12 for vm1'))
"
```

## Adding live combobox suggestions

`lib/fieldSuggestions.ts` keeps a `(tool, field) → async fetcher` map.
Providers return `[{value, label?}, …]` — the confirm modal renders the
input as an HTML5 `<input list>` combobox so users can type or pick.

```ts
// frontend/src/lib/fieldSuggestions.ts
const _REGISTRY: Record<string, Provider> = {
  // … existing entries …
  "my_tool.interface": ({switchIp}) =>
    switchIp ? _interfaces(switchIp) : Promise.resolve([]),
};
```

Providers are cached per-switch for 5s so keystrokes don't hammer the
upstream server.

## Adding a row action

Widgets that render tables can use `widgets/RowActions.tsx`. Each
action maps to a natural-language prompt — the same `SUBMIT_PROMPT`
event Help uses.

```tsx
import {RowActionsMenu, type RowAction} from "./RowActions";

function actionsFor(row: Row): RowAction[] {
  return [
    {label: "Do the thing",  prompt: () => `do the thing on ${row.name}`},
    {label: "Drop it", tone: "danger",
     prompt: () => `remove ${row.name} on vm1`},
  ];
}

// In your column list:
{key: "actions", label: "", width: "32px",
 render: (r) => <RowActionsMenu actions={actionsFor(r)} />}
```

## Code style

- TypeScript strict. Type-annotate component props.
- Keep widgets pure — they consume `payload`, render. Anything that
  needs to talk to the server should use helpers in `lib/api.ts`.
- Don't add global CSS — use the Tailwind classes + FG tokens.
- ESLint must be clean before PR (`npm run lint`).

## Reporting bugs

Use the Bug Report template. Include:

1. Exact prompt / action you tried
2. Expected vs actual
3. Browser console logs if the UI glitched
4. `docker compose logs client` or `journalctl -u sonic-mcp-client` tail
5. MCP server version (from its `/health`)

## PRs

- One widget / one fix per PR.
- CI runs eslint + vite build + docker build on Node 20 & 22.
- We ask for changes, we don't reject lightly — this is a community repo.
