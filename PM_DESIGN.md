# t3code-pm: Project Manager threads, design

Status: draft for approval. No feature code exists yet. Requirements and UI source of truth:
the approved requirements page and the mockups `01-sidebar` to `07-mobile` (kept outside the repo,
under `~/.local/share/agent-work/t3code/`). Line references are to `main` at `8cfd2b5211`.

## 1. What this adds, in one paragraph

A Project Manager (PM) is an ordinary T3 thread in an existing project that the fork marks as a PM
in its own tables. It runs a port of the Ghostex coordinator playbook: it plans, starts and briefs
worker threads, gets woken by worker reports, keeps numbered work items (W1, W2, ...), asks the user
numbered questions (Q1, Q2, ...), publishes Live pages, and keeps memory notes. A project can have
any number of PMs. Everything is additive: new code lives in `apps/*/src/pm/**` and `packages/pm`,
every edit to an upstream file is small and marked `// t3code-pm:`, and one setting turns it all off.

## 2. Names

| Thing                 | Name                                                                     | Why                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The PM's goal         | **Mission** (`pm_threads.mission`, `pm_set_mission`, UI label "Mission") | Upstream already has a per-thread `goal`: the provider-native `/goal` objective (`OrchestrationV2ProviderGoal`, `packages/contracts/src/orchestrationV2.ts:1174-1193`, shown as the status word "Goal" at `apps/web/src/components/sidebar/SidebarThreadRow.tsx:789-790`). A PM can also send `/goal` to a worker, so "goal" must keep meaning that one. |
| Standing instructions | Instructions (`pm_threads.instructions`)                                 | No clash.                                                                                                                                                                                                                                                                                                                                                |
| Work item / ask tags  | `W<n>`, `Q<n>`, per PM, never reused                                     | Same as Ghostex.                                                                                                                                                                                                                                                                                                                                         |
| Wire namespace        | `pm.*` RPC methods, `pm_*` MCP tools, `pm_*` tables                      | Requirement 7.                                                                                                                                                                                                                                                                                                                                           |
| Setting               | "Project Managers (t3code-pm)"                                           | Requirement 7.                                                                                                                                                                                                                                                                                                                                           |

The mockups say "Goal" in the details card and the hover card; implementation uses "Mission" there.

## 3. Ground rules the design follows

- **No new orchestration events or commands.** The domain event union is closed
  (`packages/contracts/src/orchestrationV2.ts:2062`), stored events must stay decodable on replay
  (`docs/internals/overview.md:75`), and the log is pruned to about a day (`overview.md:61`). An
  upstream server would fail on a fork-only event. PM state therefore lives in side tables written
  by a PM service, which drives threads only through existing commands.
- **No contract change to existing payloads.** New wire types live in `packages/contracts/src/pm.ts`
  (new file) and are merged into the RPC group with one line.
- **Never bump `ORCHESTRATION_PROTOCOL_VERSION`** (`packages/contracts/src/environment.ts:13`). The
  server answers 426 on a mismatch (`apps/server/src/ws.ts:799-804`), so keeping it equal is what
  lets upstream clients (app.t3.codes, the store apps) keep talking to a fork server and vice versa.
- **No provider adapter changes.** The PM role reaches the model through a first message and tools,
  not a per-thread system prompt, because T3's agent instructions are global constants injected by
  each adapter (`packages/provider-core/src/server/orchestrationInstructions.ts:4-30`).

## 4. Data model

### 4.1 Migrations: a separate ledger

Upstream migrations are one flat list in `apps/server/src/persistence/Migrations.ts:114-217`
(currently ending at id 102) recorded in Effect's `effect_sql_migrations` ledger (`:295`). Adding a
fork id there breaks both ways: upstream's later id 103 under another name fails
`assertV2MigrationsCanRun` (`:236-276`), and a high fork id makes upstream's service preflight
refuse the database as "written by a newer build" (`apps/server/src/cloud/servicePreflight.ts:61-77`).

So the fork keeps its own ledger: `Migrator.make({ table: "pm_migrations" })` (supported by
`.repos/effect/packages/effect/src/sql/Migrator.ts:32,126`), ids 1..N, run by the PM layer at
startup after upstream's migrations. Rules for every PM migration:

- Only `CREATE TABLE IF NOT EXISTS pm_*` and `CREATE INDEX IF NOT EXISTS`. Never alter an upstream table.
- No foreign keys or triggers pointing at upstream tables (`PRAGMA foreign_keys = ON` is set in
  `apps/server/src/persistence/Sqlite.ts:72`, and upstream rebuilds tables). Thread ids are plain
  text; the PM service cleans up on thread deletion (section 6.4).

Result: upstream opens a fork database and never reads `pm_*` or `pm_migrations`; the fork opens an
upstream database and just creates them.

### 4.2 Tables

All keyed by thread id. `pm` = the PM's thread id. Times are ISO strings like upstream's.

| Table           | Key                      | Columns                                                                                                                                                                                                       | Notes                                                                                                                                                                                                |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pm_threads`    | `thread_id`              | `project_id`, `mission` (default `''`), `instructions` (default `''`), `next_item_no`, `next_ask_no`, `guide_version_read`, `created_at`                                                                      | A row here is what makes a thread a PM. Counters only ever go up.                                                                                                                                    |
| `pm_workers`    | `worker_thread_id`       | `pm_thread_id`, `item_no` (nullable), `linked_at`, `resolved_at`, `last_report_kind`, `last_report_at`, `last_report_line`, `watch_json`                                                                      | The side table that links a worker to its PM. `watch_json` holds watcher progress (quiet since, nudged at, round) so restarts don't repeat a round.                                                  |
| `pm_items`      | `(pm, item_no)`          | `title`, `status` (`moving`, `waiting`, `needs`, `later`, `finished`, `dropped`), `later_reason`, `now_line`, `done_line`, `created_at`, `updated_at`, `finished_at`, `dropped_at`                            | Stored statuses as in Ghostex; the shown status is derived (section 5.3).                                                                                                                            |
| `pm_item_steps` | `(pm, item_no, step_no)` | `text`, `done`, `chore`, `at`                                                                                                                                                                                 |                                                                                                                                                                                                      |
| `pm_item_waits` | `(pm, item_no, wait_no)` | `on_kind` (`item`, `ask`, `text`), `on_ref`, `since`, `cleared_at`                                                                                                                                            | `release`/`ota`/`rebuild` waits from Ghostex are left out (YAGNI); free text covers them.                                                                                                            |
| `pm_asks`       | `(pm, ask_no)`           | `item_no`, `title`, `detail`, `answers_json`, `recommended`, `holds`, `state` (`open`, `answered`, `done`, `withdrawn`, `dismissed`), `answer`, `snoozed_until`, `dismissal_told`, `created_at`, `settled_at` |                                                                                                                                                                                                      |
| `pm_links`      | `(pm, link_no)`          | `item_no`, `worker_thread_id`, `url`, `kind` (`pr`, `issue`, `url`), `title`                                                                                                                                  | PR and issue URLs reuse upstream's forge parsing for display.                                                                                                                                        |
| `pm_memory`     | `(pm, position)`         | `text`, `created_at`                                                                                                                                                                                          | Forget renumbers, as Ghostex does. Max 60 notes, 600 chars.                                                                                                                                          |
| `pm_reports`    | `report_id`              | `pm`, `worker_thread_id`, `kind`, `dedupe_key` (unique with worker and kind), `message_id`, `line`, `created_at`                                                                                              | One row per delivered worker report; the dedupe key makes delivery idempotent across restarts.                                                                                                       |
| `pm_pages`      | `page_id`                | `pm`, `item_no`, `source_name`, `title`, `html`, `questions_json`, `awaits_seen`, `state` (`open`, `answered`, `seen`, `replaced`, `retired`), `answers_json`, `message_id`, `created_at`                     | Live pages. A new page with the same `source_name` replaces the older one.                                                                                                                           |
| `pm_settings`   | `key`                    | `value_json`                                                                                                                                                                                                  | Environment-wide: `enabled` (default true), `playbook_overrides`, `last_model_selection`. Kept here, not in `ServerSettings`, so upstream's settings schema and `settings.json` never see fork keys. |

Client-only UI state (dock folded, which Work item groups are open, per PM) stays in client storage.

## 5. Server

New code: `apps/server/src/pm/` (service, store, watcher, MCP toolkit, RPC handlers) and
`packages/pm` (the playbook Markdown, the Live page kit, pure logic shared by server and clients:
status derivation, tag parsing, answer message formatting).

### 5.1 PmService

The one service every transport calls (AGENTS.md "Server features are services"). Web, mobile, MCP
tools and the watcher all go through it. Main methods: `create`, `setName`, `setMission`,
`setInstructions`, `remember`, `forget`, `startWorker`, `linkWorker`, `unlinkWorker`,
`resolveWorker`, item and ask operations, `answerAsk`, `snoozeAsk`, `dismissAsk`, `showPage`,
`answerPage`, `status`, `settings`.

### 5.2 Creating a PM

`pm.create({ projectId, modelSelection? })`:

1. Launches a thread through `ThreadLaunchService.launch` (`apps/server/src/orchestration-v2/ThreadLaunchService.ts:223-232`)
   with title "New PM" and the model given, else `pm_settings.last_model_selection`, else
   Claude Opus at high effort. It saves the model as the new `last_model_selection`.
2. Immediately dispatches `thread.metadata.update { title: "New PM" }`, before any message, so the
   thread counts as renamed (see 5.2.1).
3. Inserts the `pm_threads` row with an empty mission.
4. Dispatches the bootstrap message (5.2.2).

The create flow asks for nothing but the model: no name, mission or instructions (user's pick). The
user's first message is the brief, and the PM names itself and sets its mission with
`pm_set_name` / `pm_set_mission` once it knows them. Until then the mission is empty and every
surface shows the PM without one (section 7.8).

#### 5.2.1 The PM's name wins over the auto-title

Upstream generates a title from the first message only when the thread has no deliberate title
(`hasTitleSetBeforeFirstMessage`, `apps/server/src/orchestration-v2/Orchestrator.ts:744-758`),
and that check returns true at once when `thread.titleRenamed === true` (`:748`). A rename sets
`titleRenamed: true` (`:5069`) but does **not** cancel a title generation already in flight, and a
finishing generation overwrites the title and resets `titleRenamed: false` whenever its request id
still matches (`:5401-5407`). So a `pm_set_name` during the PM's first turn would lose the race.

The fix needs no upstream change: step 2 above renames the thread before its first message, so the
generation effect (`:7372-7403`) is never queued for a PM. Every later `pm_set_name` is a plain
`thread.metadata.update { title }`. The user's manual "Regenerate title" still works, because that is
their choice. Test: create a PM, send the first message, assert no `thread-title.generate` effect was
queued, then `pm_set_name` and assert the title.

This is also why "New PM" creates the thread on the server instead of opening a client draft as
"New thread" does: a draft only becomes a thread with its first message, too late to rename first.

#### 5.2.2 How the PM learns its role

There is no per-thread system prompt (section 3). `pm.create` dispatches one `message.dispatch`
(`orchestrationV2.ts:3468-3513`) into the new thread with
`notification: { source: { kind: "system" }, summary: "Project manager setup" }`,
`createdBy: "agent"`, `creationSource: "server"`. Its text tells the model it is a Project Manager
for the project, to call `pm_guide` now, and to reply with one line asking for the brief. This costs
one short turn when the PM is created; the user's first real message then reaches a PM that has read
its playbook. See question Q-B for the alternative.

Every `pm_*` tool result carries a short footer when something needs the PM's attention: the
playbook version changed (call `pm_guide --changes`), asks dismissed since it last heard, and the
open asks list when it changed. This replaces Ghostex's `<ghostex-system>` notes without touching
upstream's message path. The playbook tells the PM to call `pm_status` at the start of every
request and `pm_guide` after a compaction, as Ghostex's does.

### 5.3 Work items, asks and status

Ported from Ghostex (`server/src/coordinators/work.rs`) with the same rules, implemented as pure
functions in `packages/pm` so web, mobile and server derive the same status:

- Shown status, first match wins: Dropped, Done, **Blocked** (an open ask with `holds`; nothing else
  blocks), Needs you (a linked worker waits for input), In progress (a linked worker is running),
  Waiting (the first open wait decides; a `Q` wait clears when the ask settles, a `W` wait when that
  item finishes), then for `moving` items In progress when the PM touched it in its current or
  previous turn, else Not being worked on (or Needs you with an open ask), then Later.
- The "previous turn" floor comes from the PM thread's run history (upstream `run.updated` events),
  not from a new store.
- `now` replaces, never appends. `done` keeps open asks; `drop` withdraws them.
- Ask answers are `"A*,B"` style lists in the tool input (`*` marks the recommended one), stored as JSON.

**Answering:** a dock click calls `pm.ask.answer({ pm, ask, answer })`. PmService records the
answer, then dispatches a user message `W4 Q3: iPhone only` into the PM thread with the normal user
message path (`createdBy: "user"`), which wakes the PM like any message. A second click on a settled
ask is refused. **Dismiss** marks the ask dismissed and sends nothing; the next `pm_*` tool result
tells the PM ("Dismissed by the user since your last message, don't ask again: W7 Q12 "title"").
**Snooze** sets `snoozed_until` from the environment's snooze presets
(`resolveSnoozePresets`, `packages/client-runtime/src/state/threadSettled.ts:347`); the PM is not
told and the ask returns by itself.

### 5.4 The report watcher

`PmReportWatcher` is modelled on `DelegatedTaskQuestionReactor`, which already wakes a parent when a
delegated child waits for input: it subscribes to `engine.streamDomainEvents` with a lock per parent
(`apps/server/src/orchestration-v2/DelegatedTaskQuestionReactor.ts:46-60,250-270`, wired in
`apps/server/src/server.ts:730-735`). Time-based checks run as a `Scheduler` source
(`apps/server/src/scheduling/Scheduler.ts:13-60`, 5 s ticks, with `DueHint` so idle ticks skip SQL),
started with `forkParked` so it waits for startup recovery (`:51`).

| Report                | Detected by                                                                                                                                                                                                                | Then                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finished              | `run.updated` with `completed` on a linked worker (`orchestrationV2.ts:682-693`)                                                                                                                                           | Report with the worker's final assistant message, cut at 12,000 chars with a pointer to `t3_thread_read`.                                                                                            |
| Waiting for an answer | Worker shell gets a `pendingRuntimeRequest` (approval or user input, `:2262-2270`)                                                                                                                                         | Report with the request summary. Dedupe by request id.                                                                                                                                               |
| Quiet for 8 min       | Worker run is running and its newest event is older than 8 min (scheduler sweep)                                                                                                                                           | Nudge the worker once (`"T3: no new output from you for 8 minutes. Still working? Say what you're waiting on, or carry on."`), then report. Re-report every 8 min after that, without nudging again. |
| Stopped mid-turn      | `run.updated` with `interrupted`, `failed` or `cancelled` that the PM did not request                                                                                                                                      | Report at once.                                                                                                                                                                                      |
| Idle while owing work | A worker whose last report was Stopped or Restarted, still idle 10 min later, its item still open                                                                                                                          | Nudge once with "carry on", then report.                                                                                                                                                             |
| Restarted             | At startup, workers whose runs `ProviderRuntimeRecoveryService` interrupted (`apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.ts:688`) and `RestartContinuation` re-prompted (`RestartContinuation.ts:38`) | Informational report; the PM does nothing unless a later report says it failed.                                                                                                                      |

**Delivery** reuses the mechanism behind delegated completion delivery
(`ProviderContinuationService.ts:173-193`): a `message.dispatch` into the PM thread with
`dispatchMode: { type: "queue_after_active" }`, `createdBy: "agent"`, `creationSource: "server"`,
`notification: { source: { kind: "system" }, summary: "Report from <worker>: <kind>" }` and
`senderThreadId` set to the worker (which upstream already renders as a "from thread" link,
`apps/web/src/components/chat/TimelineUserMessageRow.tsx:471`). The queued message starts the PM's
next turn. The report row is written in `pm_reports` before the dispatch, and the dispatch uses a
command id derived from the report id, so a retry or a restart never delivers twice.

**Why not `delegate_task` itself:** delegated children are `subagent` lineage and hidden from every
thread list (`isListedThreadLineage`, `orchestrationV2.ts:178`), their completion text points the
parent at `task_status`, and a delegated task cannot adopt an existing thread. The requirements
need workers to show as normal threads when PMs are off (mockup 06) and need `pm_worker_link` to
adopt a thread the user mentions. So workers are ordinary threads started with
`ThreadLaunchService.launch` (the same path as `t3_thread_launch`), linked in `pm_workers`, and the
watcher reuses the delivery path, not the task records.

**Restart:** on startup the watcher reconciles every linked, unresolved worker of every unarchived
PM from its thread shell (`status`, `latestRunCompletedAt`, `pendingRuntimeRequest`) against
`pm_workers.last_report_*` and `pm_reports`, so a worker that finished while the server was down is
reported once. It does the same when the setting is turned back on or a PM is unarchived.

**Skips:** archived PMs, deleted PMs, resolved workers, and everything while the setting is off.

### 5.5 Worker briefs

`pm_worker_start({ title, brief, item?, model?, effort?, workspace? })` launches the worker with
`ThreadLaunchService.launch` and `initialMessage` = the brief plus a footer, the port of Ghostex's
`thread_brief` (`Ghostex/server/src/coordinators/brief.rs:166`): "You are a worker thread started by
the T3 Code project manager <name>", the mission, the standing instructions, and the reporting rules
(the final message is the report; never message the PM thread; ask decisions in the final report; no
merge, push or destructive commands unless asked; stop background jobs before reporting; marked
sections; screenshots for UI work). Then it inserts the `pm_workers` row and returns the thread id.
Model choice follows the playbook (Opus/high for substantial work, Sonnet/high for small work); the
PM never switches a running worker's model.

### 5.6 MCP tools

Registered as a separate toolkit layer composed in `server.ts` next to upstream's
(`McpHttpServer.layerMcpTransport(Layer.mergeAll(McpHttpServer.layerTools, McpHttpServer.layerToolSearch, Pm.layerMcp))`),
through `toolkitRegistration` (`apps/server/src/mcp/McpHttpServer.ts:1280`) so the
`t3code/no-raw-mcp-registration` rule holds and upstream's context-budget test on `layerTools` is
unchanged. Visibility: `McpServer.visibility(effect)` provided to the PM toolkit only
(`.repos/effect/.../ai/McpServer.ts:540-594`) checks that the calling thread
(`McpInvocationContext`, per-thread credential at `ProviderSessionManager.ts:629`) has a
`pm_threads` row and the setting is on. Other threads never see the tools; a call is refused. When a
running thread gains or loses PM status, the server sends `notifications/tools/list_changed` as
`McpHttpServer.ts:1440` does.

| Tool                                                                                                                             | Does                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pm_guide({ changes? })`                                                                                                         | Returns the playbook, then the user's overrides. `changes` returns only what changed since the version this PM last read (paragraph diff).                          |
| `pm_status()`                                                                                                                    | Name, mission, instructions, memory, items with derived status, open asks, workers with state and last report.                                                      |
| `pm_set_name({ name })`                                                                                                          | Renames the PM thread (5.2.1).                                                                                                                                      |
| `pm_set_mission({ mission })`, `pm_set_instructions({ instructions })`                                                           | The PM sets its own mission once it knows it; instructions only when the user asks.                                                                                 |
| `pm_remember({ text })`, `pm_forget({ number })`                                                                                 | Only after the user confirms (playbook rule).                                                                                                                       |
| `pm_playbook_override({ op: "list" \| "add" \| "replace" \| "remove", ... })`                                                    | Environment-wide overrides for every PM, after the user confirms.                                                                                                   |
| `pm_worker_start(...)`                                                                                                           | Section 5.5.                                                                                                                                                        |
| `pm_worker_link({ thread, item? })`                                                                                              | Adopts an existing thread in the same project that the user mentioned. The only way to link (no link UI).                                                           |
| `pm_worker_unlink({ thread })`, `pm_worker_resolve({ thread })`                                                                  | Unlink returns it to the normal list; resolve marks it done and stops watching.                                                                                     |
| `pm_item_add({ title, thread? })`, `pm_item_update({ item, now?, step?, step_done?, wait?, status?, title? })`, `pm_item_list()` | Work items. `status` takes `done` (with the line worth keeping), `drop`, `later`, `restore`. `now`/`wait` refuse lines that hand work to the user, as Ghostex's do. |
| `pm_ask({ item?, title, detail, answers?, recommended?, holds? })`                                                               | Returns the Q tag.                                                                                                                                                  |
| `pm_ask_done({ tag })`, `pm_ask_withdraw({ tag })`, `pm_next_tag()`                                                              |                                                                                                                                                                     |
| `pm_link_add({ item?, thread?, url })`                                                                                           | Links an issue or PR.                                                                                                                                               |
| `pm_page_show({ html, title, item?, source_name })`                                                                              | Publishes a Live page (section 5.7).                                                                                                                                |
| `pm_page_retire({ page })`                                                                                                       | Retires a page and withdraws its questions.                                                                                                                         |

Healing uses upstream's tools unchanged: `t3_thread_read`, `t3_thread_send`, `t3_thread_interrupt`
(`apps/server/src/mcp/toolkits/orchestrator/tools.ts:75-351`).

**Which providers can be a PM:** any provider whose adapter gives the thread T3's MCP server: Claude,
Codex, Cursor, OpenCode, Pi, Muse, and the ACP family (Grok, Kiro, fx, Antigravity, ACP Registry)
through `provider-acp`. The create picker lists the others as unavailable with the reason, not
hidden (mockup 02). No adapter changes. Workers can be any provider.

### 5.7 Live pages

`pm_page_show` stores the page in `pm_pages` (the PM passes HTML; local images must already be
inlined, because the page travels over the WebSocket to remote clients). The server wraps it with
the kit (CSS and script) and a content-security policy `<meta>` like Ghostex's
(`Ghostex/server/src/visual_pages/prepare.rs:35`: no `connect-src` to other origins, `frame-src
'none'`, `form-action 'none'`). It then dispatches a message into the PM thread carrying the page id
so the timeline shows the page card, and the page joins the dock while it waits.

- **Delivery to clients:** `pm.page.get({ pageId })` returns the prepared HTML through the same
  WebSocket as everything else, so it works on app.t3.codes, desktop, mobile, Tailscale and T3
  Connect with no new HTTP route.
- **Sandbox:** web renders it in an iframe with `srcdoc` and
  `sandbox="allow-scripts allow-forms allow-popups"` (no `allow-same-origin`, so an opaque origin),
  matching upstream's visual replies (`apps/web/src/components/files/BrowserDocumentFrame.tsx:269`).
  Mobile uses a `WebView` with the HTML source, like `HtmlRenderWebView.tsx`.
- **Answers:** the kit's Send posts `{ type: "pm.page.submit", answers }` to the parent with
  `postMessage`. The PM frame checks `event.source` is its own iframe and calls
  `pm.page.answer({ pageId, answers })`. PmService records them (first submission wins, 64 KiB
  max) and dispatches a user message in Ghostex's format,
  `<pm-page-answers page="id" title="..." tags="Q4">{json}</pm-page-answers>`, which the timeline
  renders as a compact answers card. Pages without questions end with "Reply about this page" and
  "Mark as seen", which send `{ seen: true, reply }`.
- **Kit:** ported from Ghostex (`Ghostex/server/src/visual_pages/kit.rs`, `KIT_STYLE` about 34 KB
  and `KIT_SCRIPT` about 85 KB, plus `theme.rs` tokens). Ghostex is MIT-licensed, so the fork vendors
  it into `packages/pm/kit/` with the copyright notice. Server drafts (`PAGE_API`) are left out of v1.
- **Not upstream's `html_render`:** its bootstrap only posts size, link, image and key messages
  (`packages/shared/src/htmlRender.ts:417`), and adding an answer channel would edit it and both of
  upstream's frames. A PM-owned frame needs no upstream touch.

### 5.8 RPC: `pm.*`

New file `packages/contracts/src/pm.ts` declares `PmRpcGroup`:

| Method                                                                                          | Kind            | Scope                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pm.subscribe({ projectId? })`                                                                  | stream          | read. Pushes PM summaries for the sidebar: which threads are PMs, mission, counts (open items, open asks, workers, running workers), row state, worker ids. Small by design (AGENTS.md performance rule). |
| `pm.subscribeThread({ pm })`                                                                    | stream          | read. Full detail for one open PM: items, steps, asks, workers, memory, pages. Sent only while the PM view is open.                                                                                       |
| `pm.create`, `pm.setMission`, `pm.setInstructions`, `pm.remember`, `pm.forget`, `pm.editMemory` | command         | write                                                                                                                                                                                                     |
| `pm.ask.answer`, `pm.ask.snooze`, `pm.ask.wake`, `pm.ask.dismiss`, `pm.ask.undoDismiss`         | command         | write                                                                                                                                                                                                     |
| `pm.page.get`, `pm.page.answer`, `pm.page.markSeen`                                             | query / command | read / write                                                                                                                                                                                              |
| `pm.settings.get`, `pm.settings.set`                                                            | query / command | read / admin for overrides and the switch                                                                                                                                                                 |

Edits made in the panel reach the PM as a labelled user message ("Mission changed: ...",
"Memory note 4 added: ..."), as mockup 05 shows, so the change is in the thread's history and the
PM's next turn knows.

Wiring (each a marked one-liner): merge `PmRpcGroup` into `WsRpcGroup`
(`packages/contracts/src/rpc.ts:2322-2362`); spread `PM_RPC_SCOPES` into `RPC_REQUIRED_SCOPES`
(`apps/server/src/auth/RpcAuthorization.ts:44-241`, which throws for any method without a scope,
`:243-246`) and into the instrumentation map (`apps/server/src/observability/RpcInstrumentation.ts:257`);
spread the client-guarded subset into `CLIENT_GUARDED_RPC_SCOPES`
(`packages/contracts/src/clientRpcPermissions.ts:18-92`); in `apps/server/src/ws.ts` filter `pm.`
out of the catch-all group (`:720-745`) and add `PmGroup.toHandlers(...)` (`:3618-3619`).

Clients find out a server has PMs from a new optional capability, `pm: true`, in
`ExecutionEnvironmentCapabilities` (`packages/contracts/src/environment.ts:86`, set in
`apps/server/src/environment/ServerEnvironment.ts:269`). Fork clients hide all PM UI on upstream
servers. Upstream clients ignore the optional key.

### 5.9 The off switch

`pm_settings.enabled`, default **on**, per environment, shown on the PM Settings page (7.7). Off:

- MCP visibility hides every `pm_*` tool; the watcher stops; `pm.*` commands other than settings are
  refused; `pm.subscribe` sends `enabled: false`.
- Clients drop every PM surface: no badge, no nesting, no dock, no PM sections, no "New PM". PM
  threads show as ordinary threads and workers return to the normal list, because nothing upstream
  was changed for them.
- Nothing is deleted. Turning it back on restores everything from `pm_*` and the watcher reconciles.

## 6. Lifecycle

- **Rename:** upstream's rename (also `pm_set_name`).
- **Archive:** upstream's archive. The watcher skips archived PMs and their asks leave the dock.
  Unarchive (Settings, Archived threads) re-arms it by reconciling.
- **Delete:** upstream's delete. The PM service watches `thread.deleted` and removes that PM's
  `pm_*` rows; its workers stay as normal threads (they are not lineage children). If a worker is
  deleted or archived, its `pm_workers` row is marked resolved and its item says nobody is on it.
- **Unlink / link:** only through the PM's tools, at the user's request in chat.

## 7. Clients

Each touch below is one marked line or a small marked block calling into `apps/web/src/pm/**` or
`apps/mobile/src/pm/**`. Shared logic (status derivation, counts, row state, answer formatting) lives
in `packages/pm` and a small PM state module in `packages/client-runtime` fed by `pm.subscribe`.

Each surface is its own row so a future cut removes one row and its component.

### 7.1 Sidebar (web, desktop)

| Piece                                           | Hook point                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hide workers from the top-level list            | `isShownUnderParent` (`packages/client-runtime/src/state/threadShell.ts:66-71`): `\|\| isPmWorker(ref)`. One line; delegated subagents are already hidden there.                                                                                                                                             |
| Nest workers under their PM, both modes         | After `items.push(renderThreadRow(...))` in `apps/web/src/components/Sidebar.tsx:3549`, push `<PmWorkerRows>`. Keep their keys out of `sortableIds` (`:3395`). Keyboard tree navigation works by giving rows `data-sidebar-parent` (`apps/web/src/lib/sidebarTree.ts:78-136`). Folding is remembered per PM. |
| PM badge after the project name, unified card   | `SidebarThreadRow.tsx:1581-1589`: the name span gets `min-w-0 truncate`, then `<PmBadge>`.                                                                                                                                                                                                                   |
| Line 3 counts ("5 items · 1 ask · 4 workers")   | The `metaLine` ternary (`SidebarThreadRow.tsx:1276`) gets a PM branch, and `metaLineEmpty` (`:1267-1273`) is false for PMs so the card keeps 78px.                                                                                                                                                           |
| Row state (N running, Needs you, Blocked, Idle) | The `topStatus` block (`SidebarThreadRow.tsx:783-800`): a PM whose own turn is not running shows the PM state. Order: Blocked over Needs you over N running over Idle.                                                                                                                                       |
| Mission in the hover card                       | One line after the project row in `SidebarThreadTooltip` (`SidebarThreadRow.tsx:306-311`): `<PmHoverRows>`, which shows the mission and the counts, or nothing for non-PMs.                                                                                                                                  |
| Grouped mode: PMs first in their folder         | In `groupSidebarThreadsByProject` (`Sidebar.tsx:533-552`), a stable sort that puts PMs first.                                                                                                                                                                                                                |
| Grouped mode: "New PM" hover button             | `SidebarProjectFolderHeader.tsx:118-131`, a second button left of New thread.                                                                                                                                                                                                                                |
| Folder context menu "New PM"                    | `handleProjectFolderContextMenu` (`Sidebar.tsx:1273-1283` items, `:1291` switch).                                                                                                                                                                                                                            |

### 7.2 Creating a PM

| Entry point                                              | Hook point                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread row menu "New PM in <project>" (unified mode)     | `threadActionMenu.logic.ts:226-236` (next to Filter by project) plus a case in both handlers (`Sidebar.tsx:2717`, `apps/web/src/hooks/useThreadActionMenu.ts:198-343`).                                                                                                                                                                                 |
| Command palette "New PM in <current>" and "New PM in..." | `CommandPalette.tsx:1346-1382`, reusing `buildNewThreadInProjectItems` (`CommandPaletteProjectItems.tsx:77-103`) with a PM prefix.                                                                                                                                                                                                                      |
| Keybinding `mod+alt+m` (kept)                            | Command id in `packages/contracts/src/keybindings.ts:105-108`, default in `packages/shared/src/keybindings.ts:112-116`, label in `KeybindingsSettings.logic.ts:454-457`, handler registered with `registerCommands` (`apps/web/src/shortcuts/dispatcher.ts:131`) from one line next to `appInit.tsx:284`. `mod+alt+m` is unused in upstream's defaults. |
| The create step                                          | No dialog: every entry point calls `pm.create` with the last model and opens the new PM. Its composer's model picker (upstream's) changes the model. The bootstrap reply asks for the brief. If the user wants a picker first, a small model-only popover is the fallback (Q-C).                                                                        |

### 7.3 PM thread view: dock above the composer

`<PmComposerDock>` mounted in upstream's Dock at `apps/web/src/components/chat/ChatComposer.tsx:3478-3512`,
after the banner stack (`:3480`). Ghostex's look and rules (`Ghostex/packages/gx-chat-core/src/extras/work_cards.rs:613-858`):
a count bar that folds it, then up to 4 rows: Needs you (asks, then pages to answer, newest first,
rows older than a day sink), Blocked items not already shown by a holding ask, then what the PM's
newest turn finished (gone after the next turn or on close). "N more need you" past 4. Hover shows
`...` with Snooze (upstream presets), Dismiss (toast with Undo through `toastManager.add` with
`actionProps`), Show in the chat, Copy as "W4 Q3". A folded "Snoozed" line at the bottom with Wake.
Answers are one click; the recommended one has a star. The dock hides itself while upstream shows a
blocking question drawer (`hasBlockingComposerTopDrawer`, `:2631`).

### 7.4 Details panel: PM sections

In `apps/web/src/components/chat/ThreadDetailsPanel.tsx`: for a PM, the `show` object (`:167-179`)
hides `branch`, `pullRequests` and `git`, and `<PmDetailsSections>` mounts before
`ThreadServersPanel` (`:267`). Sections, each hideable from "Choose what to show"
(ids added to `threadDetailsItems.ts:5-30` only when the thread is a PM):

- **Project manager:** mission and standing instructions, with the pencil that edits both in place (kept).
- **Work items:** groups in Ghostex's order (Needs you, Blocked, In progress, Not being worked on,
  Waiting, Later, Done). **Only In progress and Blocked start expanded**; the user's folds are
  remembered per PM. An item opens in place: now line, steps, links, its asks.
- **Workers:** each linked worker with its W item, state and last report line; opens the thread (kept).
- **Memory:** numbered notes with hover edit and delete, and + to add (kept).

### 7.5 Timeline cards

Upstream's timeline has no plugin hook; each card is a row kind (`MessagesTimeline.logic.ts:~540-690`,
render switch `MessagesTimeline.tsx:1684-1712`). The fork adds one marked check in the render switch:
when a message id belongs to a PM report, page or answers message (known from `pm.subscribeThread`),
render `<PmTimelineCard>` instead. Without the fork (or with the setting off) those messages still
render as upstream's notification rows and user messages, so nothing is lost.

- **Worker report:** one line, "Report from <worker>", the pill (Finished, Waiting for an answer,
  Quiet for 8 min, Idle while owing work, Stopped mid-turn, Restarted), opens to the full report.
- **Live page card:** file bar, preview, title, Open; Answered pill once answered.
- **Answers card:** compact list of the answers sent.
- The PM's marked-section replies are ordinary Markdown; section label colours are a CSS rule scoped
  to PM threads.

### 7.6 Live page window

`<PmPageWindow>` mounted next to `ThreadPreviewMiniPlayer`, the existing floating panel over the
chat (`apps/web/src/components/ChatView.tsx:3972-3977`). It is sized to the chat area, movable and
resizable, has the 36px drag band and the three round buttons, and stays while the user chats. The
desktop app uses the same in-app panel; a real child window is left out of v1. The `...` menu keeps
Snooze, Export page and Open in browser; Star and Import answers are left out of v1.

### 7.7 Settings

A fork-only page `/settings/project-managers` (kept, user's pick): new route file
`apps/web/src/routes/_chat.settings.project-managers.tsx`, plus marked entries in
`settingsSearch.ts` (`SettingsPath` union `:20-43`, labels `:96-120`, nav groups `:132-175`, search
entries `:490-503`) and an icon in `SettingsSidebarNav.tsx:89-115`. Contents: the
"Project Managers (t3code-pm)" switch, the shipped playbook (version and View), and the playbook
overrides editor (kept). The default-model row is cut (user's pick): create remembers the last model.
Archived threads (`ArchivedThreadsPanel.tsx`) gets a marked line for the PM badge and worker count.

### 7.8 A PM with no mission yet

Until `pm_set_mission` runs: the hover card shows no mission row, only counts; the Project manager
section shows "No mission yet. The PM sets it once it knows the brief." with the pencil still
available; the sidebar title is "New PM" until `pm_set_name`.

### 7.9 PM row menu

Upstream's thread menu with PM wording where the item acts on the PM (Pin PM, Rename PM, Archive
PM, Delete PM...) plus "Edit mission..." (kept, user's pick). Built in
`threadActionMenu.logic.ts:144-310` from the thread's PM flag. Delete's confirmation says the
workers stay as normal threads. No Link or Unlink items anywhere (user's decision).

### 7.10 Mobile (iOS, Android)

| Piece                                                     | Hook point                                                                                                                                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hide workers, nest up to two under the PM then "N more"   | `apps/mobile/src/features/threads/threadListV2.ts:384` (filter) and the items builder `buildThreadListV2ListItems` (`:581`). Mobile filters with `isListedThreadLineage` only, so it needs its own marked line.                                  |
| PM badge, counts line                                     | `ThreadListV2Row` in `thread-list-v2-items.tsx`: badge on line 1 (`:1367-1484`), counts as a row before line 2 (`:1496`).                                                                                                                        |
| Row long-press                                            | Upstream's long-press is a plain action menu with no preview (`:1784-1791`), so the mission shows as the first, disabled menu row instead of a preview. Menu actions get "Edit mission" and the PM wording (`:1098-1235`).                       |
| Dock above the composer                                   | `<PmDock>` after `ThreadSideChatsRow` in `ThreadDetailScreen.tsx` (around `:1733`). Counts only plus its first row on narrow screens.                                                                                                            |
| PM sheet with tabs (kept: Work, Workers, Mission, Memory) | A header action in `ThreadRouteScreen.tsx:1033` opens a native form sheet route declared with `sheetRoute` (`features/layout/route-options.ts:98`) in `Stack.tsx`, built like `ThreadAgentsSheet.tsx`. Opens at half height.                     |
| New PM                                                    | The Android FAB is a single button with no menu (`features/home/AndroidHomeFab.android.tsx:26-80`): add a long-press menu with "New PM". iOS and Android: "New PM" in the project's menu in the new-task flow. No form: same `pm.create` as web. |
| Live pages                                                | Full-height sheet with a `WebView` (like `HtmlRenderWebView.tsx`), `onMessage` bridge to `pm.page.answer`.                                                                                                                                       |

### 7.11 Notifications

Upstream pushes go only through the hosted relay, carry title, body and a deep link, and have no
action buttons on either platform (`infra/relay/src/agentActivity/ApnsClient.ts:218-233`;
`apps/mobile/src/features/agent-awareness/notificationNavigation.ts:21-41`; Android
`AgentNotifications.kt:313-314`). Answer buttons on the notification (mockup 07) would need relay,
JS and native changes, and the fork APK cannot get hosted pushes anyway (section 9). v1 therefore
relies on what exists: the PM ends its turn after asking, so the existing completion push and the
desktop/web in-app notifications fire with the PM's reply (whose last section names the ask). Tapping
opens the PM, where the dock answers it. Notification answer buttons are out of v1 (Q-D).

### 7.12 Languages

All new strings use `gt-react` / `gt-react-native` directly (`docs/internals/i18n.md`), under
`apps/{web,mobile}/src/pm/**` which `gt.config.json` already scans. Run `vp run i18n:generate` in
both apps, translate by hand in every catalog, keep `vp run i18n:check` green.

## 8. Hit every surface

| Surface          | Decision                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry points     | Sidebar folder and row menus, command palette, keybinding, mobile FAB and new-task flow. Agents reach everything through `pm_*` tools; scheduled tasks can message a PM like any thread. |
| Clients          | Web (local and app.t3.codes builds of the fork), desktop, mobile. Upstream clients talking to a fork server see plain threads.                                                           |
| Providers        | Any provider with T3's MCP tools can be a PM (5.6). Workers: any provider.                                                                                                               |
| Reverse states   | Snooze/Wake, Dismiss/Undo, Archive/Unarchive, setting off/on, unlink through the PM.                                                                                                     |
| Connection modes | Everything travels over `pm.*` RPC and existing messages; pages go over the WebSocket. Works locally, over Tailscale and over T3 Connect when the client can sign in (section 9).        |
| Docs             | `README-PM.md` (fork-only) per requirement 8. No upstream doc changes.                                                                                                                   |

## 9. Distribution: trying the fork, including an Android APK

### 9.1 Identity so the fork sits beside official T3 Code

**Android APK** (all in `apps/mobile/app.config.ts`; `android/` is generated, not committed,
`apps/mobile/.gitignore:40-41`):

- Add a fourth variant `pm` to `VARIANT_CONFIG` (`app.config.ts:80-105`) and `resolveAppVariant`
  (`:107-118`): app name "T3 Code PM", scheme `t3code-pm`, package and bundle id
  `com.<you>.t3codepm`, own icon tint.
- Build with `T3CODE_MOBILE_UPDATES_ENABLED=0` (`:248-253`). Otherwise the app checks T3's EAS update
  channel (`updates.url` `u.expo.dev/d763fcb8-...`, `:250`) and could load upstream's JavaScript
  whenever its runtime fingerprint matches. Drop or replace `owner: "pingdotgg"` (`:495`) and the EAS
  `projectId` (`:491`).
- Leave `T3CODE_ANDROID_GOOGLE_SERVICES_FILE` unset (`:302-304`): pushes come from T3's relay with
  T3's Firebase project (`infra/relay/src/worker.ts:158-163`), which cannot deliver to another package.
- **Build path: local Gradle, not EAS.** EAS signing uses T3's remote credentials
  (`apps/mobile/eas.json:4`, no `credentials.json` in the repo). Locally:
  `APP_VARIANT=pm T3CODE_MOBILE_UPDATES_ENABLED=0 npx expo prebuild --clean --platform android`
  in `apps/mobile`, then `./gradlew assembleRelease` in `apps/mobile/android`, signed with your own
  keystore (`keytool -genkeypair ...`, wired into `android/app/build.gradle` or a small config
  plugin so prebuild keeps it). The existing `android:prod` script (`apps/mobile/package.json:20-23`)
  shows the prebuild step. `vp run mobile:install` is not a tester path: it builds the development
  client that needs Metro (`scripts/mobile-native-client.ts:216,769`).
- Android App Links to `app.t3.codes` will not verify for the fork package (`app.config.ts:317-324`);
  pairing still works by QR or pasted URL.

**Desktop:**

- **T3 home (critical):** the desktop app defaults to `~/.t3` (`apps/desktop/src/app/DesktopStatePaths.ts:18-20`),
  the developer's real data. The fork defaults to `~/.t3-pm`. `T3CODE_HOME` still overrides it
  (`apps/desktop/src/app/DesktopConfig.ts:40`). Running both apps on one home is refused anyway
  (`apps/desktop/src/backend/DesktopHomeOwner.ts:99-112`). To try the fork on real data, copy
  `statev2.sqlite` into `~/.t3-pm/userdata` while the official app is closed; the fork adds `pm_*`
  tables, which upstream ignores.
- Electron profile folder `t3code-v2` (`apps/desktop/src/app/DesktopUserData.ts:42-45`) becomes
  `t3code-pm`, which also separates the single-instance lock.
- `appId` (`scripts/build-desktop-artifact.ts:66`), `productName` (`apps/desktop/package.json:47`),
  URL scheme `t3code` (`apps/desktop/src/electron/ElectronProtocol.ts:16-17`, and the trusted
  desktop origin in `apps/server/src/httpCors.ts:13`), `appUserModelId` and the Linux window class
  get fork values from one fork identity module.
- Updates: the feed comes from `T3CODE_DESKTOP_UPDATE_REPOSITORY` or `GITHUB_REPOSITORY`
  (`scripts/build-desktop-artifact.ts:2729-2753`); set it to the fork's GitHub repo or leave it unset
  (the app then says no update feed is configured).
- **Server self-update must not pull upstream:** it looks up the public `t3` package on npm
  (`apps/server/src/cloud/npmRelease.ts:66`), which would replace the fork with upstream. The fork
  turns that path off.
- Build unsigned (the default, `T3CODE_DESKTOP_SIGNED` off, `scripts/build-desktop-artifact.ts:1657`):
  `vp run dist:desktop:dmg:arm64`, `vp run dist:desktop:linux` or `vp run dist:desktop:win`. macOS
  testers right-click, Open the first time.

### 9.2 Does the fork work over T3 Connect?

| Question                                                                          | Verdict                                                                                                                                                                                                                                     | Evidence                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the relay pass `pm.*` RPC methods?                                           | **Yes, it never sees them.** After bootstrap, clients talk to the environment through its tunnel hostname; the relay does not proxy HTTP or WebSocket sessions.                                                                             | `docs/internals/t3-connect.md:3-6`; `infra/relay/README.md:10-13`. The only method gate is the server's own scope map (`apps/server/src/auth/RpcAuthorization.ts:241-246`), which the fork extends (5.8).                   |
| Can a fork **server** link to the hosted T3 Connect?                              | **Yes, likely.** The server links through the CLI's public OAuth client with a loopback redirect (`http://127.0.0.1:34338/callback`) or the device-code flow; nothing checks the server's build, and the public ids ship in `.env.example`. | `docs/operations/connect-setup.md:41-42`; `apps/server/src/cloud/publicConfig.ts:23,175-225`; `docs/internals/t3-connect.md:222-227`; `.env.example:9-11`.                                                                  |
| Does the relay check app attestation, package names or origins?                   | **No.** It checks Clerk token audience and validity only; CORS is open.                                                                                                                                                                     | `infra/relay/src/http/Api.ts:134-139,1693-1752`.                                                                                                                                                                            |
| Can the fork **APK** sign in to the hosted T3 Connect?                            | **No.** Clerk's Android sign-in uses `clerk://<applicationId>.callback`, which must be on T3's Clerk allow-list; only T3's Clerk admin can add it.                                                                                          | `docs/operations/connect-setup.md:78-88`; `docs/operations/android-notifications.md:45-53`. Unknown: whether email-code sign-in, which needs no redirect, is enabled on T3's instance (dashboard setting, not in the repo). |
| Can the fork **desktop** app sign in?                                             | **No** with its own scheme: Clerk allow-lists `t3code://app/` only.                                                                                                                                                                         | `docs/operations/connect-setup.md:63-74`.                                                                                                                                                                                   |
| Can upstream's app.t3.codes or official apps reach a fork server over T3 Connect? | **Yes**, while the fork keeps protocol version 2; they show PMs as plain threads.                                                                                                                                                           | `apps/server/src/ws.ts:799-804,3651-3660`; `packages/client-runtime/src/connection/compatibility.ts:13-40`.                                                                                                                 |
| Hosted pushes to the fork APK?                                                    | **No.** They come from T3's relay with T3's Firebase project.                                                                                                                                                                               | `infra/relay/src/worker.ts:158-163`; `docs/operations/android-notifications.md:3`.                                                                                                                                          |
| Full fork server plus fork APK over Connect                                       | **Only with a self-hosted relay and your own Clerk instance** (the relay is in `infra/relay`, deployed with Alchemy; needs Cloudflare, PlanetScale, Clerk and optionally APNs/FCM).                                                         | `infra/relay/README.md:77-116`; `docs/operations/connect-setup.md:9-31`.                                                                                                                                                    |

**Bottom line:** T3 Connect is not the path for the fork APK. Tailscale (or LAN) pairing is.

### 9.3 What a tester does (Tailscale)

1. Install Tailscale on the computer and the phone, signed in to the same tailnet.
2. Install the fork desktop app (it uses `~/.t3-pm`) and open a project.
3. In the fork desktop app, Settings, Sharing & access: turn on **Network access**
   (`serverExposureMode`, `apps/desktop/src/settings/DesktopAppSettings.ts:35,76`); the app restarts.
   Optionally turn on **Tailscale HTTPS** (`tailscaleServeEnabled`, `:36,77`), which needs MagicDNS and
   HTTPS certificates on the tailnet (`docs/user/remote-access.md:199-211`).
4. In the same page, create a pairing link; it shows a QR code.
5. Install the fork APK (allow installs from unknown sources), open it, Settings, Environments, Add
   environment, and scan the QR (`apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx`).
   Plain `http://100.x` addresses are allowed (`apps/mobile/plugins/withAndroidNetworkSecurityConfig.cjs:7-15`).

Without the desktop app: `t3 serve --tailscale-serve` (or `--lan`) and `t3 pair` from the fork's
CLI build (`apps/server/src/cli/pair.ts:519-537`; `docs/user/remote-access.md:99-113,211-223`), or
from a checkout `vp run dev --share` and the `pairingUrl:` line it prints. A browser on the tailnet
can open the same pairing URL to use the fork's web client.

## 10. Test plan

Following AGENTS.md: test what can break, at the lowest layer that fails, no sleeps (drain the
effect worker, `TestClock` for the watcher's minutes).

- **Storage and migrations** (`apps/server/src/pm/PmStore.test.ts`): the PM ledger runs on a fresh
  database and on an upstream database; ids never collide with upstream's ledger; an upstream build's
  migrator opens a fork database (`assertV2MigrationsCanRun` passes) and ignores `pm_*`.
- **Each `pm_*` tool** (`PmMcp.test.ts`): happy path and refusal; tools invisible to a non-PM thread
  and with the setting off.
- **Q and W numbering**: counters never reuse a number after withdraw, drop, delete or restart.
- **Status derivation** (`packages/pm` unit tests, table-driven): Blocked only with a holding ask,
  waits clearing on Q and W, Not being worked on after the turn floor.
- **Report watcher** (`PmReportWatcher.test.ts`, `TestClock`): finished, waiting, quiet (nudge
  once, re-report), stopped, idle owing work, restarted; dedupe across a simulated restart; nothing
  while archived or off.
- **Title race**: no `thread-title.generate` effect for a PM; `pm_set_name` wins.
- **Answers**: `pm.ask.answer` records and sends exactly one `W<n> Q<n>: ...` message; a second
  answer is refused; dismiss shows in the next tool result once.
- **Live pages**: `pm.page.answer` first submission wins, size cap, answers message format.
- **Compatibility**: fork opens upstream data; upstream opens fork data; setting off leaves
  upstream behaviour unchanged (sidebar logic and server tests run green with the PM layer present
  and off).
- **Logic beside components** (`*.logic.test.ts`): sidebar worker nesting and hiding, row state order,
  dock row ordering. One browser test only for the Live page iframe bridge (real `postMessage`).
- **Real pass** with the free Replay (dev) provider, per requirement 8: two PMs in one project, one
  starts two workers, a report arrives, an ask is answered, the server restarts, everything is
  still there; screenshots of each step.

## 11. Upstream files touched

Every touch is marked `// t3code-pm:` and calls into fork code. Estimates in changed lines.

**Server**

| File                                                  | Reason                                               | Lines |
| ----------------------------------------------------- | ---------------------------------------------------- | ----- |
| `apps/server/src/server.ts`                           | Compose the PM layer (service, watcher, MCP toolkit) | 3     |
| `apps/server/src/ws.ts`                               | Route `pm.*` to `PmGroup` handlers                   | 3     |
| `apps/server/src/auth/RpcAuthorization.ts`            | Spread `PM_RPC_SCOPES`                               | 1     |
| `apps/server/src/observability/RpcInstrumentation.ts` | Spread PM instrumentation entries                    | 1     |
| `apps/server/src/environment/ServerEnvironment.ts`    | Advertise `pm: true`                                 | 1     |
| `apps/server/src/cloud/npmRelease.ts`                 | Turn off self-update to upstream's npm `t3`          | 2     |
| `apps/server/src/httpCors.ts`                         | Trust the fork's desktop scheme                      | 1     |

**Contracts and shared**

| File                                               | Reason                                  | Lines |
| -------------------------------------------------- | --------------------------------------- | ----- |
| `packages/contracts/src/rpc.ts`                    | Merge `PmRpcGroup`                      | 2     |
| `packages/contracts/src/environment.ts`            | Optional `pm` capability                | 1     |
| `packages/contracts/src/clientRpcPermissions.ts`   | Spread client-guarded PM scopes         | 1     |
| `packages/contracts/src/keybindings.ts`            | `pm.new` command id                     | 1     |
| `packages/shared/src/keybindings.ts`               | Default `mod+alt+m`                     | 1     |
| `packages/client-runtime/src/state/threadShell.ts` | Hide PM workers in `isShownUnderParent` | 1     |

**Web and desktop renderer**

| File                                                             | Reason                                                             | Lines |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ----- |
| `apps/web/src/components/Sidebar.tsx`                            | Worker rows, PMs first in folders, folder menu item, row menu case | 8     |
| `apps/web/src/components/sidebar/SidebarThreadRow.tsx`           | Badge, counts line, row state, hover rows                          | 8     |
| `apps/web/src/components/sidebar/SidebarProjectFolderHeader.tsx` | New PM hover button                                                | 2     |
| `apps/web/src/components/threadActionMenu.logic.ts`              | New PM item, Edit mission, PM wording                              | 6     |
| `apps/web/src/hooks/useThreadActionMenu.ts`                      | Handle the new items                                               | 3     |
| `apps/web/src/components/CommandPalette.tsx`                     | New PM items                                                       | 3     |
| `apps/web/src/components/settings/KeybindingsSettings.logic.ts`  | Keybinding label                                                   | 1     |
| `apps/web/src/appInit.tsx`                                       | Register PM commands                                               | 1     |
| `apps/web/src/components/chat/ThreadDetailsPanel.tsx`            | Hide git sections, mount PM sections                               | 3     |
| `apps/web/src/components/chat/threadDetailsItems.ts`             | PM section ids                                                     | 2     |
| `apps/web/src/components/chat/ChatComposer.tsx`                  | Mount the dock                                                     | 1     |
| `apps/web/src/components/ChatView.tsx`                           | Mount the Live page window                                         | 1     |
| `apps/web/src/components/chat/MessagesTimeline.tsx`              | PM timeline cards                                                  | 3     |
| `apps/web/src/components/settings/settingsSearch.ts`             | PM Settings page path, label, nav, search                          | 5     |
| `apps/web/src/components/settings/SettingsSidebarNav.tsx`        | PM Settings icon                                                   | 1     |
| `apps/web/src/components/settings/ArchivedThreadsPanel.tsx`      | PM badge on archived PMs                                           | 1     |

**Mobile**

| File                                                        | Reason                        | Lines |
| ----------------------------------------------------------- | ----------------------------- | ----- |
| `apps/mobile/app.config.ts`                                 | `pm` variant identity         | 10    |
| `apps/mobile/src/features/threads/threadListV2.ts`          | Hide and nest workers         | 3     |
| `apps/mobile/src/features/threads/thread-list-v2-items.tsx` | Badge, counts, menu items     | 5     |
| `apps/mobile/src/features/threads/ThreadDetailScreen.tsx`   | Dock                          | 1     |
| `apps/mobile/src/features/threads/ThreadRouteScreen.tsx`    | PM sheet header action        | 2     |
| `apps/mobile/src/Stack.tsx`                                 | PM sheet and Live page routes | 4     |
| `apps/mobile/src/features/home/AndroidHomeFab.android.tsx`  | Long-press "New PM"           | 3     |

**Desktop shell and build**

| File                                            | Reason                       | Lines |
| ----------------------------------------------- | ---------------------------- | ----- |
| `apps/desktop/src/app/DesktopStatePaths.ts`     | Default home `~/.t3-pm`      | 1     |
| `apps/desktop/src/app/DesktopUserData.ts`       | Profile folder `t3code-pm`   | 1     |
| `apps/desktop/src/electron/ElectronProtocol.ts` | Scheme `t3code-pm`           | 1     |
| `apps/desktop/package.json`                     | Product name                 | 1     |
| `scripts/build-desktop-artifact.ts`             | `appId`, scheme, Linux class | 4     |

Plus generated i18n catalogs (`apps/{web,mobile}/src/i18n/translations/*.json`), which change with
every string. 41 upstream files, about 105 changed lines. Line
numbers are from the research pass; implementation re-checks each before editing.

Fork-only files (no upstream conflict): `apps/server/src/pm/**`, `apps/web/src/pm/**`,
`apps/mobile/src/pm/**`, `packages/pm/**`, `packages/contracts/src/pm.ts`,
`apps/web/src/routes/_chat.settings.project-managers.tsx`, `README-PM.md`, `scripts/sync-upstream.sh`.

## 12. Left out of v1

Notification answer buttons, Live page drafts on the server, a real desktop child window for pages,
Star and Import answers, `release`/`ota`/`rebuild` waits, hosted T3 Connect sign-in for fork apps,
a per-thread system prompt.

## 13. Open questions

- **Q-A, the goal's name.** "Mission" keeps it apart from upstream's `/goal`. Alternatives: "Brief",
  "Objective". Recommended: Mission.
- **Q-B, how the PM learns its role.** A setup turn on create (5.2.2, recommended: works with every
  provider, costs one short turn), or prepend the role to the user's first message (touches
  upstream's send path).
- **Q-C, New PM with no dialog.** Create at once with the last model and change the model in the
  composer (recommended), or a model-only popover first.
- **Q-D, notification answer buttons.** Leave out of v1 (recommended); they need relay, mobile JS
  and native changes and a self-hosted relay for the fork APK.
- **Q-E, fork default home.** `~/.t3-pm` for desktop and CLI (recommended), or share `~/.t3` with
  the official app (never at the same time; the official app could later be confused by fork data).
