import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ModelSelection,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type OrchestrationV2LinkOrigin,
  type OrchestrationV2Notification,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type OrchestrationV2ThreadShell,
  PmError,
  type PmReportKind,
  type PmSettings,
  type PmSubscribeEvent,
  type PmSummary,
  type PmThreadDetail,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import {
  derivePmItemStatus,
  diffPmParagraphs,
  formatAskTag,
  formatItemTag,
  formatPmAnswerMessage,
  handsWorkToUser,
  isOpenWait,
  parseAskTag,
  parsePmAnswers,
  parsePmWait,
  PM_PLAYBOOK_VERSION,
  type PmShownItemStatus,
  type PmWaitOn,
  type PmWorkerState,
} from "@t3tools/pm";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  type PmAskRow,
  type PmItemRow,
  type PmReportRow,
  PmStore,
  type PmThreadRow,
  type PmWaitRow,
  type PmWorkerRow,
} from "./PmStore.ts";
import {
  composeGuide,
  linkKind,
  MEMORY_LIMIT,
  MEMORY_TEXT_LIMIT,
  PAGE_ANSWERS_LIMIT,
  PAGE_HTML_LIMIT,
  pageAnswersMessage,
  PM_NEW_TITLE,
  PM_SETUP_MESSAGE,
  preparePage,
  workerBrief,
} from "./PmText.ts";
import { pmVisibility } from "./PmVisibility.ts";

const DEFAULT_PM_MODEL: ModelSelection = {
  instanceId: "claudeAgent" as ModelSelection["instanceId"],
  model: "claude-opus-5-5" as ModelSelection["model"],
  options: [{ id: "effort", value: "high" }],
};

const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelection);
const encodeModelSelection = Schema.encodeEffect(ModelSelection);

const invalid = (message: string) => new PmError({ code: "invalid_request", message });
const notFound = (message: string) => new PmError({ code: "not_found", message });
const conflict = (message: string) => new PmError({ code: "conflict", message });
const unavailable = (message: string) => () => new PmError({ code: "unavailable", message });

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
/** Unique enough for ids that also carry the PM or worker they belong to. */
const newId = Effect.gen(function* () {
  const ms = yield* Clock.currentTimeMillis;
  const salt = yield* Random.nextIntBetween(0, 2 ** 31);
  return `${ms.toString(36)}${salt.toString(36).padStart(6, "0")}`;
});
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const RUNNING_STATUSES = new Set(["preparing", "queued", "starting", "running"]);

function workerStateOf(
  worker: Pick<PmWorkerRow, "resolvedAt">,
  shell: OrchestrationV2ThreadShell | null,
): PmWorkerState {
  if (worker.resolvedAt !== null || shell === null) return "resolved";
  if (shell.pendingRuntimeRequest !== null || shell.status === "waiting") return "waiting";
  if (RUNNING_STATUSES.has(shell.status)) return "running";
  return "idle";
}

const waitOf = (wait: PmWaitRow): PmWaitOn =>
  wait.onKind === "text"
    ? { kind: "text", text: wait.onRef }
    : wait.onKind === "item"
      ? { kind: "item", itemNo: Number(wait.onRef) }
      : { kind: "ask", askNo: Number(wait.onRef) };

const askSettled = (ask: PmAskRow | undefined) => ask !== undefined && ask.state !== "open";
const itemClosed = (item: PmItemRow | undefined) =>
  item !== undefined && (item.status === "finished" || item.status === "dropped");

export interface PmToolResult {
  readonly result: string;
  readonly notes?: ReadonlyArray<string>;
}

export interface StartWorkerInput {
  readonly title: string;
  readonly brief: string;
  readonly item?: string | number | undefined;
  readonly modelSelection?: ModelSelection | undefined;
  readonly workspaceStrategy?: OrchestrationV2ThreadLaunchWorkspaceStrategy | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly linkOrigin?: OrchestrationV2LinkOrigin | undefined;
}

export interface ItemUpdateInput {
  readonly item: string | number;
  readonly title?: string | undefined;
  readonly now?: string | undefined;
  readonly step?: string | undefined;
  readonly chore?: boolean | undefined;
  readonly stepDone?: number | undefined;
  readonly wait?: string | undefined;
  readonly status?: "done" | "drop" | "later" | "restore" | undefined;
  readonly done?: string | undefined;
  readonly reason?: string | undefined;
}

export interface AskInput {
  readonly item?: string | number | undefined;
  readonly title: string;
  readonly detail: string;
  readonly answers?: string | undefined;
  readonly recommended?: string | undefined;
  readonly holds?: boolean | undefined;
}

export interface ReportInput {
  readonly pmThreadId: string;
  readonly workerThreadId: string;
  readonly kind: PmReportKind;
  readonly dedupeKey: string;
  readonly line: string;
  readonly text: string;
  readonly summary: string;
}

const make = Effect.gen(function* () {
  const store = yield* PmStore;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const changes = yield* PubSub.unbounded<string>();

  const readEnabled = store
    .getSetting("enabled")
    .pipe(Effect.map((value) => (typeof value === "boolean" ? value : true)));
  const enabled = yield* Ref.make(yield* readEnabled.pipe(Effect.orElseSucceed(() => true)));
  pmVisibility.reset(
    yield* Ref.get(enabled),
    (yield* store.listPms().pipe(Effect.orElseSucceed(() => []))).map((pm) => pm.threadId),
  );

  const changed = (pm: string) => PubSub.publish(changes, pm).pipe(Effect.asVoid);

  const isEnabled = Ref.get(enabled);
  const requireEnabled = Effect.flatMap(isEnabled, (on) =>
    on
      ? Effect.void
      : Effect.fail(
          new PmError({
            code: "disabled",
            message: "Project Managers (t3code-pm) are turned off in Settings.",
          }),
        ),
  );

  const requirePm = Effect.fn("PmService.requirePm")(function* (pm: string) {
    yield* requireEnabled;
    const row = yield* store.getPm(pm);
    if (row === null) return yield* notFound(`Thread ${pm} is not a project manager.`);
    return row;
  });

  const shellOf = (threadId: string) =>
    threads
      .getThreadShell(ThreadId.make(threadId))
      .pipe(Effect.mapError(unavailable(`Could not read thread ${threadId}.`)));

  const dispatchMessage = Effect.fn("PmService.dispatchMessage")(function* (input: {
    readonly threadId: string;
    readonly key: string;
    readonly text: string;
    readonly createdBy: OrchestrationV2Actor;
    readonly creationSource?: OrchestrationV2CreationSource;
    readonly notification?: OrchestrationV2Notification;
    readonly senderThreadId?: string;
  }) {
    const messageId = MessageId.make(`message:pm:${input.key}`);
    yield* threads
      .dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`command:pm:${input.key}`),
        threadId: ThreadId.make(input.threadId),
        messageId,
        text: input.text,
        attachments: [],
        dispatchMode: { type: "queue_after_active" },
        createdBy: input.createdBy,
        creationSource: input.creationSource ?? "server",
        ...(input.notification === undefined ? {} : { notification: input.notification }),
        ...(input.senderThreadId === undefined
          ? {}
          : { senderThreadId: ThreadId.make(input.senderThreadId) }),
      })
      .pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("PM message dispatch failed", { threadId: input.threadId, cause }),
        ),
        Effect.mapError(unavailable(`Could not send a message to thread ${input.threadId}.`)),
      );
    return messageId;
  });

  /** A panel edit reaches the PM as a labelled user message, so its next turn knows. */
  const tellPm = Effect.fn("PmService.tellPm")(function* (pm: string, text: string) {
    return yield* dispatchMessage({
      threadId: pm,
      key: `user-edit:${yield* newId}`,
      text,
      createdBy: "user",
    });
  });

  const parseItemRef = Effect.fn("PmService.parseItemRef")(function* (
    pm: string,
    value: string | number | undefined,
  ) {
    if (value === undefined) return null;
    const itemNo =
      typeof value === "number"
        ? value
        : /^\s*w?\d+\s*$/i.test(value)
          ? Number(value.replace(/\D/g, ""))
          : NaN;
    if (!Number.isSafeInteger(itemNo) || itemNo < 1)
      return yield* invalid(`"${value}" is not a work item tag such as W3.`);
    const item = yield* store.getItem(pm, itemNo);
    if (item === null) return yield* notFound(`There is no ${formatItemTag(itemNo)}.`);
    return item;
  });

  const askRef = Effect.fn("PmService.askRef")(function* (pm: string, tag: string | number) {
    const askNo = parseAskTag(tag);
    if (askNo === null) return yield* invalid(`"${tag}" is not a question tag such as Q3.`);
    const ask = yield* store.getAsk(pm, askNo);
    if (ask === null) return yield* notFound(`There is no ${formatAskTag(askNo)}.`);
    return ask;
  });

  const askLabel = (ask: PmAskRow) =>
    `${ask.itemNo === null ? "" : `${formatItemTag(ask.itemNo)} `}${formatAskTag(ask.askNo)} "${ask.title}"`;

  const openAsksLine = (asks: ReadonlyArray<PmAskRow>) =>
    asks
      .filter((ask) => ask.state === "open")
      .map(askLabel)
      .join(", ");

  const guideText = Effect.gen(function* () {
    const overrides = yield* playbookOverrides;
    return composeGuide(overrides);
  });

  const playbookOverrides = store
    .getSetting("playbook_overrides")
    .pipe(
      Effect.map((value) =>
        Array.isArray(value)
          ? value.filter((rule): rule is string => typeof rule === "string")
          : [],
      ),
    );

  /** What T3 Code tells the PM under a tool result: the port of Ghostex's system notes. */
  const notesFor = Effect.fn("PmService.notesFor")(function* (pm: PmThreadRow) {
    const notes: Array<string> = [];
    const guide = yield* guideText;
    if (pm.guideTextRead === null)
      notes.push("Call pm_guide before your next reply: it is your playbook.");
    else if (pm.guideTextRead !== guide)
      notes.push("Your playbook changed: call pm_guide with changes: true.");
    const asks = yield* store.listAsks(pm.threadId);
    const dismissed = asks.filter((ask) => ask.state === "dismissed" && !ask.dismissalTold);
    if (dismissed.length > 0) {
      notes.push(
        `Dismissed by the user since your last message, don't ask again: ${dismissed.map(askLabel).join(", ")}`,
      );
      yield* Effect.forEach(
        dismissed,
        (ask) => store.updateAsk(pm.threadId, ask.askNo, { dismissal_told: 1 }),
        { discard: true },
      );
    }
    const open = openAsksLine(asks);
    if (open !== pm.openAsksTold) {
      if (open.length > 0) notes.push(`Still open for the user: ${open}`);
      yield* store.updatePm(pm.threadId, { open_asks_told: open });
    }
    return notes;
  });

  /** Runs a PM tool: refuses non-PMs and appends the notes. */
  const tool = Effect.fn("PmService.tool")(function* (
    pmThreadId: string,
    run: (pm: PmThreadRow) => Effect.Effect<string, PmError>,
  ) {
    const pm = yield* requirePm(pmThreadId);
    const result = yield* run(pm);
    const fresh = (yield* store.getPm(pmThreadId)) ?? pm;
    const notes = yield* notesFor(fresh);
    yield* changed(pmThreadId);
    return (notes.length === 0 ? { result } : { result, notes }) satisfies PmToolResult;
  });

  /** The PM's own ask changes are not news to it. */
  const syncOpenAsksTold = (pm: string) =>
    store
      .listAsks(pm)
      .pipe(Effect.flatMap((asks) => store.updatePm(pm, { open_asks_told: openAsksLine(asks) })));

  const lastModelSelection = store
    .getSetting("last_model_selection")
    .pipe(
      Effect.flatMap((value) =>
        value === undefined
          ? Effect.undefined
          : decodeModelSelection(value).pipe(Effect.orElseSucceed(() => undefined)),
      ),
    );

  const create = Effect.fn("PmService.create")(function* (input: {
    readonly projectId: ProjectId;
    readonly modelSelection?: ModelSelection | undefined;
    readonly createdBy: OrchestrationV2Actor;
    readonly creationSource: OrchestrationV2CreationSource;
  }) {
    yield* requireEnabled;
    const modelSelection = input.modelSelection ?? (yield* lastModelSelection) ?? DEFAULT_PM_MODEL;
    const encoded = yield* encodeModelSelection(modelSelection).pipe(
      Effect.mapError(() => invalid("That model selection is not valid.")),
    );
    yield* store.setSetting("last_model_selection", encoded);
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(unavailable("Could not read the server settings.")),
    );
    const id = yield* newId;
    const threadId = ThreadId.make(`pm-${id}`);
    const at = yield* nowIso;
    // The row first, so the setup turn's tool calls already find a PM.
    yield* store.insertPm({ threadId, projectId: input.projectId, createdAt: at });
    yield* launches
      .launch({
        commandId: CommandId.make(`command:pm-create:${id}`),
        threadId,
        projectId: input.projectId,
        title: PM_NEW_TITLE,
        generateTitle: false,
        modelSelection,
        runtimeMode: resolveProjectSettings(settings, input.projectId).settings.defaultRuntimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        workspaceStrategy: { type: "root" },
        createdBy: input.createdBy,
        creationSource: input.creationSource,
      })
      .pipe(
        Effect.tapError(() => store.deletePm(threadId).pipe(Effect.ignore)),
        Effect.mapError(
          (cause) =>
            new PmError({
              code: "unavailable",
              message: `Could not create the PM: ${cause.message}`,
            }),
        ),
      );
    pmVisibility.add(threadId);
    // A deliberate title before any message, so upstream never queues a title generation that
    // would later overwrite the PM's own `pm_set_name`.
    yield* threads
      .dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make(`command:pm-title:${id}`),
        threadId,
        title: PM_NEW_TITLE,
      })
      .pipe(Effect.mapError(unavailable("Could not name the new PM.")));
    yield* dispatchMessage({
      threadId,
      key: `setup:${id}`,
      text: PM_SETUP_MESSAGE,
      createdBy: "agent",
      notification: {
        source: { kind: "system" },
        outcome: "updated",
        summary: "Project manager setup",
      },
    });
    yield* changed(threadId);
    return { threadId };
  });

  const setName = (pm: string, name: string) =>
    tool(pm, () =>
      Effect.gen(function* () {
        const title = name.trim();
        if (title.length === 0) return yield* invalid("A name needs text.");
        yield* threads
          .dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make(`command:pm-name:${yield* newId}`),
            threadId: ThreadId.make(pm),
            title,
          })
          .pipe(Effect.mapError(unavailable("Could not rename the PM.")));
        return `Renamed to "${title}".`;
      }),
    );

  const setMission = Effect.fn("PmService.setMission")(function* (
    pm: string,
    mission: string,
    from: "pm" | "user",
  ) {
    yield* requirePm(pm);
    yield* store.updatePm(pm, { mission: mission.trim() });
    if (from === "user")
      yield* tellPm(
        pm,
        mission.trim().length === 0 ? "Mission cleared." : `Mission changed: ${mission.trim()}`,
      );
    yield* changed(pm);
    return "Mission saved.";
  });

  const setInstructions = Effect.fn("PmService.setInstructions")(function* (
    pm: string,
    instructions: string,
    from: "pm" | "user",
  ) {
    yield* requirePm(pm);
    yield* store.updatePm(pm, { instructions: instructions.trim() });
    if (from === "user")
      yield* tellPm(
        pm,
        instructions.trim().length === 0
          ? "Standing instructions cleared."
          : `Standing instructions changed: ${instructions.trim()}`,
      );
    yield* changed(pm);
    return "Standing instructions saved.";
  });

  const remember = Effect.fn("PmService.remember")(function* (
    pm: string,
    text: string,
    from: "pm" | "user",
  ) {
    yield* requirePm(pm);
    const note = text.trim().replace(/\s+/g, " ");
    if (note.length === 0) return yield* invalid("A memory note needs text.");
    if (note.length > MEMORY_TEXT_LIMIT)
      return yield* invalid(
        `A memory note is one line of at most ${MEMORY_TEXT_LIMIT} characters.`,
      );
    const notes = yield* store.listMemory(pm);
    if (notes.length >= MEMORY_LIMIT)
      return yield* invalid(`Memory is full (${MEMORY_LIMIT} notes). Forget one first.`);
    const at = yield* nowIso;
    yield* store.replaceMemory(pm, [...notes, { text: note, createdAt: at }]);
    const number = notes.length + 1;
    if (from === "user") yield* tellPm(pm, `Memory note ${number} added: ${note}`);
    yield* changed(pm);
    return number;
  });

  const forget = Effect.fn("PmService.forget")(function* (
    pm: string,
    number: number,
    from: "pm" | "user",
  ) {
    yield* requirePm(pm);
    const notes = yield* store.listMemory(pm);
    const target = notes.find((note) => note.position === number);
    if (target === undefined) return yield* notFound(`There is no memory note ${number}.`);
    yield* store.replaceMemory(
      pm,
      notes.filter((note) => note.position !== number),
    );
    if (from === "user") yield* tellPm(pm, `Memory note ${number} removed: ${target.text}`);
    yield* changed(pm);
    return `Forgot note ${number}. Later notes moved up one.`;
  });

  const editMemory = Effect.fn("PmService.editMemory")(function* (
    pm: string,
    number: number,
    text: string,
  ) {
    yield* requirePm(pm);
    const note = text.trim().replace(/\s+/g, " ");
    if (note.length === 0 || note.length > MEMORY_TEXT_LIMIT)
      return yield* invalid(
        `A memory note is one line of at most ${MEMORY_TEXT_LIMIT} characters.`,
      );
    const notes = yield* store.listMemory(pm);
    if (!notes.some((existing) => existing.position === number))
      return yield* notFound(`There is no memory note ${number}.`);
    yield* store.replaceMemory(
      pm,
      notes.map((existing) =>
        existing.position === number ? { ...existing, text: note } : existing,
      ),
    );
    yield* tellPm(pm, `Memory note ${number} changed: ${note}`);
    yield* changed(pm);
  });

  const guide = (pm: string, changesOnly: boolean) =>
    tool(pm, (row) =>
      Effect.gen(function* () {
        const text = yield* guideText;
        yield* store.updatePm(pm, {
          guide_version_read: PM_PLAYBOOK_VERSION,
          guide_text_read: text,
        });
        if (!changesOnly || row.guideTextRead === null) return text;
        const diff = diffPmParagraphs(row.guideTextRead, text);
        if (diff.added.length === 0 && diff.removed.length === 0)
          return "Nothing changed since your last read.";
        return [
          `Playbook version ${PM_PLAYBOOK_VERSION}. Changes since your last read:`,
          ...(diff.added.length === 0 ? [] : ["", "Added or changed:", "", ...diff.added]),
          ...(diff.removed.length === 0 ? [] : ["", "Removed:", "", ...diff.removed]),
        ].join("\n");
      }),
    );

  const playbookOverride = (
    pm: string,
    input: {
      readonly op: "list" | "add" | "replace" | "remove";
      readonly text?: string | undefined;
      readonly number?: number | undefined;
    },
  ) =>
    tool(pm, () =>
      Effect.gen(function* () {
        const overrides = [...(yield* playbookOverrides)];
        const index = (input.number ?? 0) - 1;
        if (input.op !== "list" && input.op !== "add" && (index < 0 || index >= overrides.length))
          return yield* notFound(`There is no override ${input.number ?? "(none given)"}.`);
        const text = input.text?.trim() ?? "";
        if ((input.op === "add" || input.op === "replace") && text.length === 0)
          return yield* invalid("Pass the override's text.");
        if (input.op === "add") overrides.push(text);
        if (input.op === "replace") overrides[index] = text;
        if (input.op === "remove") overrides.splice(index, 1);
        if (input.op !== "list") yield* store.setSetting("playbook_overrides", overrides);
        if (overrides.length === 0) return "No playbook overrides.";
        return overrides.map((rule, position) => `${position + 1}. ${rule}`).join("\n");
      }),
    );

  const itemAdd = (pm: string, input: { title: string; thread?: string | undefined }) =>
    tool(pm, () =>
      Effect.gen(function* () {
        const title = input.title.trim();
        if (title.length === 0) return yield* invalid("A work item needs a title.");
        const itemNo = yield* store.transaction(
          Effect.gen(function* () {
            const allocated = yield* store.allocate(pm, "next_item_no");
            if (allocated === null)
              return yield* notFound(`Thread ${pm} is not a project manager.`);
            yield* store.insertItem(pm, { itemNo: allocated, title, at: yield* nowIso });
            return allocated;
          }),
        );
        if (input.thread !== undefined) {
          const worker = yield* store.getWorker(input.thread);
          if (worker === null || worker.pmThreadId !== pm)
            return yield* invalid(
              `${formatItemTag(itemNo)} was added, but thread ${input.thread} is not your worker. Link it with pm_worker_link first.`,
            );
          yield* store.updateWorker(input.thread, { item_no: itemNo });
        }
        return `Added ${formatItemTag(itemNo)} "${title}".`;
      }),
    );

  const itemUpdate = (pm: string, input: ItemUpdateInput) =>
    tool(pm, () =>
      Effect.gen(function* () {
        const item = yield* parseItemRef(pm, input.item);
        if (item === null) return yield* invalid("Name the work item, such as W3.");
        const tag = formatItemTag(item.itemNo);
        const at = yield* nowIso;
        const done: Array<string> = [];
        if (input.title !== undefined && input.title.trim().length > 0) {
          yield* store.updateItem(pm, item.itemNo, { title: input.title.trim() }, at);
          done.push("renamed");
        }
        if (input.now !== undefined) {
          if (handsWorkToUser(input.now))
            return yield* invalid(
              "A now line is for work you or a worker are doing. What needs the user is a pm_ask.",
            );
          yield* store.updateItem(pm, item.itemNo, { now_line: input.now.trim() || null }, at);
          done.push("now line set");
        }
        if (input.step !== undefined && input.step.trim().length > 0) {
          const stepNo = yield* store.insertStep(pm, {
            itemNo: item.itemNo,
            text: input.step.trim(),
            chore: input.chore === true,
            at,
          });
          yield* store.updateItem(pm, item.itemNo, {}, at);
          done.push(`step ${stepNo} added`);
        }
        if (input.stepDone !== undefined) {
          if (!(yield* store.setStepDone(pm, item.itemNo, input.stepDone)))
            return yield* notFound(`${tag} has no step ${input.stepDone}.`);
          yield* store.updateItem(pm, item.itemNo, {}, at);
          done.push(`step ${input.stepDone} done`);
        }
        if (input.wait !== undefined) {
          const wait = parsePmWait(input.wait);
          if (wait === null)
            return yield* invalid("Say what it waits on: W<n>, Q<n> or a few words.");
          if (wait.kind === "text" && handsWorkToUser(wait.text))
            return yield* invalid("Waiting on the user is a pm_ask, never a wait.");
          yield* store.insertWait(pm, {
            itemNo: item.itemNo,
            onKind: wait.kind,
            onRef:
              wait.kind === "text"
                ? wait.text
                : String(wait.kind === "item" ? wait.itemNo : wait.askNo),
            at,
          });
          yield* store.updateItem(pm, item.itemNo, {}, at);
          done.push("wait set");
        }
        if (input.status === "done") {
          const line = input.done?.trim() ?? "";
          if (line.length === 0)
            return yield* invalid("Pass `done` with the one line worth keeping.");
          yield* store.updateItem(
            pm,
            item.itemNo,
            {
              status: "finished",
              done_line: line,
              now_line: null,
              finished_at: at,
              dropped_at: null,
            },
            at,
          );
          yield* store.clearWaits(pm, item.itemNo, at);
          done.push("done");
        }
        if (input.status === "drop") {
          yield* store.updateItem(
            pm,
            item.itemNo,
            { status: "dropped", now_line: null, dropped_at: at },
            at,
          );
          yield* store.clearWaits(pm, item.itemNo, at);
          const asks = yield* store.listAsks(pm);
          yield* Effect.forEach(
            asks.filter((ask) => ask.itemNo === item.itemNo && ask.state === "open"),
            (ask) => store.settleAsk(pm, ask.askNo, { state: "withdrawn", settled_at: at }),
            { discard: true },
          );
          yield* syncOpenAsksTold(pm);
          done.push("dropped (its open asks withdrawn)");
        }
        if (input.status === "later") {
          yield* store.updateItem(
            pm,
            item.itemNo,
            { status: "later", later_reason: input.reason?.trim() || null },
            at,
          );
          done.push("set aside for later");
        }
        if (input.status === "restore") {
          yield* store.updateItem(
            pm,
            item.itemNo,
            { status: "moving", later_reason: null, finished_at: null, dropped_at: null },
            at,
          );
          done.push("restored");
        }
        if (done.length === 0)
          return yield* invalid("Nothing to update: pass now, step, wait, status or title.");
        return `${tag}: ${done.join(", ")}.`;
      }),
    );

  /** The shown status of every item, from the stored rows and the workers' live state. */
  const deriveItems = Effect.fn("PmService.deriveItems")(function* (pm: PmThreadRow) {
    const [items, steps, waits, asks, workers] = yield* Effect.all([
      store.listItems(pm.threadId),
      store.listSteps(pm.threadId),
      store.listWaits(pm.threadId),
      store.listAsks(pm.threadId),
      store.listWorkers(pm.threadId),
    ]);
    const workerStates = yield* Effect.forEach(workers, (worker) =>
      (worker.resolvedAt !== null ? Effect.succeed(null) : shellOf(worker.workerThreadId)).pipe(
        Effect.orElseSucceed(() => null),
        Effect.map((shell) => ({ worker, shell, state: workerStateOf(worker, shell) })),
      ),
    );
    const itemsByNo = new Map(items.map((item) => [item.itemNo, item]));
    const asksByNo = new Map(asks.map((ask) => [ask.askNo, ask]));
    const floor = pm.previousTurnStartedAt ?? pm.turnStartedAt ?? pm.createdAt;
    const derived = items.map((item) => {
      const itemWaits = waits.filter(
        (wait) => wait.itemNo === item.itemNo && wait.clearedAt === null,
      );
      const ctx = {
        isAskSettled: (askNo: number) => askSettled(asksByNo.get(askNo)),
        isItemClosed: (itemNo: number) => itemClosed(itemsByNo.get(itemNo)),
      };
      const shownStatus = derivePmItemStatus({
        status: item.status,
        waits: itemWaits.map(waitOf),
        asks: asks.filter((ask) => ask.itemNo === item.itemNo),
        workers: workerStates
          .filter((entry) => entry.worker.itemNo === item.itemNo && entry.state !== "resolved")
          .map((entry) => entry.state),
        touchedRecently: item.updatedAt >= floor,
        ...ctx,
      });
      return {
        item,
        shownStatus,
        steps: steps.filter((step) => step.itemNo === item.itemNo),
        waits: waits
          .filter((wait) => wait.itemNo === item.itemNo)
          .map((wait) => ({
            wait,
            open: wait.clearedAt === null && isOpenWait(waitOf(wait), ctx),
          })),
      };
    });
    return { derived, asks, workerStates };
  });

  const STATUS_LABELS: Record<PmShownItemStatus, string> = {
    needs_you: "Needs you",
    blocked: "Blocked",
    in_progress: "In progress",
    not_worked_on: "Not being worked on",
    waiting: "Waiting",
    later: "Later",
    done: "Done",
    dropped: "Dropped",
  };

  const itemLines = (derived: Effect.Success<ReturnType<typeof deriveItems>>["derived"]) =>
    derived
      .filter(({ shownStatus }) => shownStatus !== "dropped")
      .map(({ item, shownStatus, steps, waits }) => {
        const lines = [
          `${formatItemTag(item.itemNo)} ${item.title}: ${STATUS_LABELS[shownStatus]}`,
        ];
        if (item.nowLine) lines.push(`  now: ${item.nowLine}`);
        if (item.doneLine) lines.push(`  done: ${item.doneLine}`);
        if (item.laterReason) lines.push(`  later: ${item.laterReason}`);
        for (const step of steps)
          lines.push(
            `  ${step.done ? "[x]" : "[ ]"} ${step.stepNo}. ${step.text}${step.chore ? " (chore)" : ""}`,
          );
        for (const { wait, open } of waits.filter((entry) => entry.open))
          lines.push(
            `  waits on ${wait.onKind === "item" ? `W${wait.onRef}` : wait.onKind === "ask" ? `Q${wait.onRef}` : wait.onRef}${open ? "" : " (cleared)"}`,
          );
        return lines.join("\n");
      })
      .join("\n");

  const itemList = (pm: string) =>
    tool(pm, (row) =>
      deriveItems(row).pipe(
        Effect.map(({ derived }) =>
          derived.length === 0 ? "No work items yet." : itemLines(derived),
        ),
      ),
    );

  const status = (pm: string) =>
    tool(pm, (row) =>
      Effect.gen(function* () {
        const shell = yield* shellOf(pm);
        const { derived, asks, workerStates } = yield* deriveItems(row);
        const memory = yield* store.listMemory(pm);
        const lines = [
          `Name: ${shell?.title ?? PM_NEW_TITLE}`,
          `Mission: ${row.mission || "(none yet: set it with pm_set_mission once you know the brief)"}`,
          `Standing instructions: ${row.instructions || "(none)"}`,
          "",
          "Memory:",
          ...(memory.length === 0
            ? ["(none)"]
            : memory.map((note) => `${note.position}. ${note.text}`)),
          "",
          "Work items:",
          derived.length === 0 ? "(none)" : itemLines(derived),
          "",
          "Open asks:",
          ...(asks.some((ask) => ask.state === "open")
            ? asks
                .filter((ask) => ask.state === "open")
                .map(
                  (ask) =>
                    `${askLabel(ask)}${ask.holds ? " (holds)" : ""}${ask.snoozedUntil ? ` (snoozed until ${ask.snoozedUntil})` : ""}`,
                )
            : ["(none)"]),
          "",
          "Workers:",
          ...(workerStates.filter((entry) => entry.state !== "resolved").length === 0
            ? ["(none)"]
            : workerStates
                .filter((entry) => entry.state !== "resolved")
                .map(
                  ({ worker, shell: workerShell, state }) =>
                    `- "${workerShell?.title ?? worker.workerThreadId}" (thread ${worker.workerThreadId})${worker.itemNo === null ? "" : ` on ${formatItemTag(worker.itemNo)}`}: ${state}${worker.lastReportKind ? `; last report ${worker.lastReportKind} at ${worker.lastReportAt}: ${worker.lastReportLine ?? ""}` : ""}`,
                )),
        ];
        return lines.join("\n");
      }),
    );

  const ask = (pm: string, input: AskInput) =>
    tool(pm, () =>
      Effect.gen(function* () {
        const title = input.title.trim();
        if (title.length === 0)
          return yield* invalid("An ask needs a title that names its subject.");
        if (/\bQ\d+\b/.test(title)) return yield* invalid("Leave the Q tag out of the title.");
        if (input.detail.trim().length === 0)
          return yield* invalid("An ask always has a detail: what it is about and why you ask.");
        const item = yield* parseItemRef(pm, input.item);
        const parsed = parsePmAnswers(input.answers ?? "", input.recommended);
        const at = yield* nowIso;
        const askNo = yield* store.transaction(
          Effect.gen(function* () {
            const allocated = yield* store.allocate(pm, "next_ask_no");
            if (allocated === null)
              return yield* notFound(`Thread ${pm} is not a project manager.`);
            yield* store.insertAsk(pm, {
              askNo: allocated,
              itemNo: item?.itemNo ?? null,
              title,
              detail: input.detail.trim(),
              answers: parsed.answers,
              recommended: parsed.recommended,
              holds: input.holds === true,
              at,
            });
            if (item !== null) yield* store.updateItem(pm, item.itemNo, {}, at);
            return allocated;
          }),
        );
        yield* syncOpenAsksTold(pm);
        return `Asked ${item === null ? "" : `${formatItemTag(item.itemNo)} `}${formatAskTag(askNo)}. End your turn: the answer arrives as your next message.`;
      }),
    );

  const settleByPm = (pm: string, tag: string | number, state: "done" | "withdrawn") =>
    tool(pm, () =>
      Effect.gen(function* () {
        const target = yield* askRef(pm, tag);
        const settled = yield* store.settleAsk(pm, target.askNo, {
          state,
          settled_at: yield* nowIso,
        });
        if (!settled)
          return yield* conflict(`${formatAskTag(target.askNo)} is already ${target.state}.`);
        yield* syncOpenAsksTold(pm);
        return `${formatAskTag(target.askNo)} ${state === "done" ? "closed as done" : "withdrawn"}.`;
      }),
    );

  const nextTag = (pm: string) =>
    tool(pm, (row) =>
      Effect.succeed(
        `Next free tags: ${formatItemTag(row.nextItemNo)} and ${formatAskTag(row.nextAskNo)}.`,
      ),
    );

  const answerAsk = Effect.fn("PmService.answerAsk")(function* (
    pm: string,
    askNo: number,
    answer: string,
  ) {
    yield* requirePm(pm);
    const target = yield* askRef(pm, askNo);
    const key = `answer:${pm}:${askNo}`;
    const messageId = MessageId.make(`message:pm:${key}`);
    const settled = yield* store.settleAsk(pm, askNo, {
      state: "answered",
      answer: answer.trim(),
      answer_message_id: messageId,
      settled_at: yield* nowIso,
    });
    if (!settled) return yield* conflict(`${formatAskTag(askNo)} was already ${target.state}.`);
    yield* dispatchMessage({
      threadId: pm,
      key,
      text: formatPmAnswerMessage({ itemNo: target.itemNo, askNo, answer: answer.trim() }),
      createdBy: "user",
    });
    yield* changed(pm);
  });

  const snoozeAsk = Effect.fn("PmService.snoozeAsk")(function* (
    pm: string,
    askNo: number,
    until: string | null,
  ) {
    yield* requirePm(pm);
    const target = yield* askRef(pm, askNo);
    if (target.state !== "open")
      return yield* conflict(`${formatAskTag(askNo)} is ${target.state}.`);
    if (until !== null && Number.isNaN(Date.parse(until)))
      return yield* invalid("Snooze needs an ISO time.");
    yield* store.updateAsk(pm, askNo, { snoozed_until: until });
    yield* changed(pm);
  });

  const dismissAsk = Effect.fn("PmService.dismissAsk")(function* (pm: string, askNo: number) {
    yield* requirePm(pm);
    const target = yield* askRef(pm, askNo);
    const settled = yield* store.settleAsk(pm, askNo, {
      state: "dismissed",
      dismissal_told: 0,
      settled_at: yield* nowIso,
    });
    if (!settled) return yield* conflict(`${formatAskTag(askNo)} was already ${target.state}.`);
    yield* changed(pm);
  });

  const undoDismissAsk = Effect.fn("PmService.undoDismissAsk")(function* (
    pm: string,
    askNo: number,
  ) {
    yield* requirePm(pm);
    const target = yield* askRef(pm, askNo);
    if (target.state !== "dismissed")
      return yield* conflict(`${formatAskTag(askNo)} is ${target.state}, not dismissed.`);
    if (target.dismissalTold)
      return yield* conflict(`The PM already heard that ${formatAskTag(askNo)} was dismissed.`);
    yield* store.updateAsk(pm, askNo, { state: "open", settled_at: null });
    yield* changed(pm);
  });

  const startWorker = (pm: string, input: StartWorkerInput) =>
    tool(pm, (row) =>
      Effect.gen(function* () {
        const item = yield* parseItemRef(pm, input.item);
        const pmShell = yield* shellOf(pm);
        if (pmShell === null) return yield* notFound(`Thread ${pm} is gone.`);
        const id = yield* newId;
        const workerThreadId = ThreadId.make(`pm-worker-${id}`);
        const at = yield* nowIso;
        // Linked before launch, so even a turn that ends at once is reported.
        yield* store.upsertWorker({
          workerThreadId,
          pmThreadId: pm,
          itemNo: item?.itemNo ?? null,
          linkedAt: at,
        });
        yield* launches
          .launch({
            commandId: CommandId.make(`command:pm-worker:${id}`),
            threadId: workerThreadId,
            projectId: pmShell.projectId,
            title: input.title.trim(),
            modelSelection: input.modelSelection ?? pmShell.modelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            workspaceStrategy: input.workspaceStrategy ?? { type: "root" },
            initialMessage: {
              messageId: MessageId.make(`message:pm-worker-brief:${id}`),
              senderThreadId: ThreadId.make(pm),
              text: workerBrief({
                brief: input.brief,
                pmTitle: pmShell.title,
                mission: row.mission,
                instructions: row.instructions,
              }),
              attachments: [],
            },
            createdBy: "agent",
            creationSource: "mcp",
            ...(input.linkOrigin === undefined ? {} : { linkOrigin: input.linkOrigin }),
          })
          .pipe(
            Effect.tapError(() => store.deleteWorker(workerThreadId).pipe(Effect.ignore)),
            Effect.mapError(
              (cause) =>
                new PmError({
                  code: "unavailable",
                  message: `The worker did not start: ${cause.message}`,
                }),
            ),
          );
        if (item !== null) yield* store.updateItem(pm, item.itemNo, {}, at);
        return `Started worker "${input.title.trim()}" (thread ${workerThreadId})${item === null ? "" : ` on ${formatItemTag(item.itemNo)}`}. Its report arrives as a message; end your turn.`;
      }),
    );

  const linkWorker = (pm: string, input: { thread: string; item?: string | number | undefined }) =>
    tool(pm, (row) =>
      Effect.gen(function* () {
        if (input.thread === pm) return yield* invalid("A PM cannot be its own worker.");
        if ((yield* store.getPm(input.thread)) !== null)
          return yield* invalid(`Thread ${input.thread} is a project manager, not a worker.`);
        const shell = yield* shellOf(input.thread);
        if (shell === null) return yield* notFound(`There is no thread ${input.thread}.`);
        if (shell.projectId !== row.projectId)
          return yield* invalid(`Thread ${input.thread} is in another project.`);
        const item = yield* parseItemRef(pm, input.item);
        yield* store.upsertWorker({
          workerThreadId: input.thread,
          pmThreadId: pm,
          itemNo: item?.itemNo ?? null,
          linkedAt: yield* nowIso,
        });
        return `Linked "${shell.title}" (thread ${input.thread}) as your worker. Its reports now come to you.`;
      }),
    );

  const requireOwnWorker = Effect.fn("PmService.requireOwnWorker")(function* (
    pm: string,
    thread: string,
  ) {
    const worker = yield* store.getWorker(thread);
    if (worker === null || worker.pmThreadId !== pm)
      return yield* notFound(`Thread ${thread} is not your worker.`);
    return worker;
  });

  const unlinkWorker = (pm: string, thread: string) =>
    tool(pm, () =>
      requireOwnWorker(pm, thread).pipe(
        Effect.andThen(store.deleteWorker(thread)),
        Effect.as(`Unlinked thread ${thread}: it is an ordinary thread again.`),
      ),
    );

  const resolveWorker = (pm: string, thread: string) =>
    tool(pm, () =>
      Effect.gen(function* () {
        const worker = yield* requireOwnWorker(pm, thread);
        if (worker.resolvedAt !== null) return `Thread ${thread} was already resolved.`;
        yield* store.updateWorker(thread, { resolved_at: yield* nowIso });
        return `Resolved thread ${thread}: no more reports from it.`;
      }),
    );

  const linkAdd = (
    pm: string,
    input: {
      item?: string | number | undefined;
      thread?: string | undefined;
      url: string;
      title?: string | undefined;
    },
  ) =>
    tool(pm, () =>
      Effect.gen(function* () {
        const url = input.url.trim();
        if (!/^https?:\/\//.test(url))
          return yield* invalid("Pass the full URL of the issue or PR.");
        const item = yield* parseItemRef(pm, input.item);
        if (input.thread !== undefined) yield* requireOwnWorker(pm, input.thread);
        const linkNo = yield* store.allocate(pm, "next_link_no");
        if (linkNo === null) return yield* notFound(`Thread ${pm} is not a project manager.`);
        const kind = linkKind(url);
        yield* store.insertLink(pm, {
          linkNo,
          itemNo: item?.itemNo ?? null,
          workerThreadId: input.thread ?? null,
          url,
          kind,
          title: input.title?.trim() || null,
        });
        return `Linked ${kind === "url" ? "the page" : `the ${kind === "pr" ? "PR" : "issue"}`} ${url}.`;
      }),
    );

  const pageShow = (
    pm: string,
    input: {
      html: string;
      title: string;
      sourceName: string;
      item?: string | number | undefined;
      questionTags?: ReadonlyArray<string> | undefined;
    },
  ) =>
    tool(pm, (row) =>
      Effect.gen(function* () {
        if (input.html.length > PAGE_HTML_LIMIT)
          return yield* invalid("The page is over 2 MiB. Inline smaller images or split it.");
        if (input.title.trim().length === 0)
          return yield* invalid("A page needs a title that names its subject.");
        const item = yield* parseItemRef(pm, input.item);
        const tags: Array<string> = [];
        for (const tag of input.questionTags ?? []) {
          const askNo = parseAskTag(tag);
          if (askNo === null) return yield* invalid(`"${tag}" is not a question tag such as Q3.`);
          if (askNo < row.nextAskNo || (yield* store.getAsk(pm, askNo)) !== null)
            return yield* conflict(
              `${formatAskTag(askNo)} was already used. Call pm_next_tag for a free one.`,
            );
          tags.push(formatAskTag(askNo));
        }
        // Tags a page uses count as used, so pm_ask never hands them out again.
        const highest = Math.max(0, ...tags.map((tag) => parseAskTag(tag) ?? 0));
        if (highest >= row.nextAskNo)
          yield* Effect.repeat(store.allocate(pm, "next_ask_no"), {
            times: highest - row.nextAskNo,
          });
        const pages = yield* store.listPages(pm);
        yield* Effect.forEach(
          pages.filter(
            (page) =>
              page.sourceName === input.sourceName &&
              (page.state === "open" || page.state === "seen"),
          ),
          (page) => store.updatePage(page.pageId, { state: "replaced" }),
          { discard: true },
        );
        const pageId = `page-${yield* newId}`;
        yield* store.insertPage({
          pageId,
          pmThreadId: pm,
          itemNo: item?.itemNo ?? null,
          sourceName: input.sourceName,
          title: input.title.trim(),
          html: input.html,
          questionTags: tags,
          state: "open",
          messageId: null,
          createdAt: yield* nowIso,
        });
        return `Published page ${pageId} "${input.title.trim()}"${tags.length === 0 ? "" : ` asking ${tags.join(", ")}`}. Its answers arrive as a <pm-page-answers> message.`;
      }),
    );

  const pageRetire = (pm: string, pageId: string) =>
    tool(pm, () =>
      Effect.gen(function* () {
        const page = yield* store.getPage(pageId);
        if (page === null || page.pmThreadId !== pm)
          return yield* notFound(`There is no page ${pageId}.`);
        yield* store.updatePage(pageId, { state: "retired" });
        return `Retired page ${pageId}${page.questionTags.length === 0 ? "" : `; ${page.questionTags.join(", ")} withdrawn`}.`;
      }),
    );

  const requirePage = Effect.fn("PmService.requirePage")(function* (pageId: string) {
    yield* requireEnabled;
    const page = yield* store.getPage(pageId);
    if (page === null) return yield* notFound(`There is no page ${pageId}.`);
    return page;
  });

  const pageGet = Effect.fn("PmService.pageGet")(function* (pageId: string) {
    const page = yield* requirePage(pageId);
    return { pageId, title: page.title, html: preparePage({ title: page.title, html: page.html }) };
  });

  const pageAnswer = Effect.fn("PmService.pageAnswer")(function* (
    pageId: string,
    answers: unknown,
  ) {
    const page = yield* requirePage(pageId);
    const json = yield* encodeJson(answers ?? null).pipe(
      Effect.mapError(() => invalid("The answers are not JSON.")),
    );
    if (json.length > PAGE_ANSWERS_LIMIT) return yield* invalid("The answers are over 64 KiB.");
    const key = `page-answers:${pageId}`;
    const messageId = MessageId.make(`message:pm:${key}`);
    const recorded = yield* store.answerPage(pageId, {
      state: "answered",
      answers_json: json,
      answers_message_id: messageId,
    });
    if (!recorded) return yield* conflict(`Page ${pageId} was already ${page.state}.`);
    yield* dispatchMessage({
      threadId: page.pmThreadId,
      key,
      text: pageAnswersMessage({ pageId, title: page.title, tags: page.questionTags, json }),
      createdBy: "user",
    });
    yield* changed(page.pmThreadId);
  });

  const pageMarkSeen = Effect.fn("PmService.pageMarkSeen")(function* (
    pageId: string,
    reply: string | undefined,
  ) {
    const page = yield* requirePage(pageId);
    const text = reply?.trim() ?? "";
    const key = `page-seen:${pageId}`;
    const recorded = yield* store.answerPage(pageId, {
      state: "seen",
      ...(text.length === 0 ? {} : { answers_message_id: `message:pm:${key}` }),
    });
    if (!recorded) return yield* conflict(`Page ${pageId} was already ${page.state}.`);
    if (text.length > 0)
      yield* dispatchMessage({
        threadId: page.pmThreadId,
        key,
        text: pageAnswersMessage({
          pageId,
          title: page.title,
          tags: page.questionTags,
          json: yield* encodeJson({ seen: true, reply: text }).pipe(Effect.orDie),
        }),
        createdBy: "user",
      });
    yield* changed(page.pmThreadId);
  });

  const detail = Effect.fn("PmService.detail")(function* (pm: string) {
    const row = yield* store.getPm(pm);
    if (row === null || !(yield* isEnabled)) return null;
    const { derived, asks, workerStates } = yield* deriveItems(row);
    const [memory, links, pages, reports] = yield* Effect.all([
      store.listMemory(pm),
      store.listLinks(pm),
      store.listPages(pm),
      store.listReports(pm, 50),
    ]);
    return {
      threadId: ThreadId.make(row.threadId),
      projectId: row.projectId as ProjectId,
      mission: row.mission,
      instructions: row.instructions,
      memory: memory.map((note) => ({
        number: note.position,
        text: note.text,
        createdAt: note.createdAt,
      })),
      items: derived.map(({ item, shownStatus, steps, waits }) => ({
        ...item,
        shownStatus,
        steps: steps.map((step) => ({
          number: step.stepNo,
          text: step.text,
          done: step.done,
          chore: step.chore,
          at: step.at,
        })),
        waits: waits.map(({ wait, open }) => ({
          number: wait.waitNo,
          onKind: wait.onKind,
          onRef: wait.onRef,
          since: wait.since,
          open,
        })),
      })),
      asks: asks.map(({ dismissalTold: _told, answerMessageId, ...askRow }) => ({
        ...askRow,
        answerMessageId: answerMessageId === null ? null : MessageId.make(answerMessageId),
      })),
      workers: workerStates.map(({ worker, state }) => ({
        threadId: ThreadId.make(worker.workerThreadId),
        itemNo: worker.itemNo,
        state,
        linkedAt: worker.linkedAt,
        resolvedAt: worker.resolvedAt,
        lastReportKind: worker.lastReportKind,
        lastReportAt: worker.lastReportAt,
        lastReportLine: worker.lastReportLine,
      })),
      links: links.map((link) => ({
        number: link.linkNo,
        itemNo: link.itemNo,
        workerThreadId: link.workerThreadId === null ? null : ThreadId.make(link.workerThreadId),
        url: link.url,
        kind: link.kind,
        title: link.title,
      })),
      pages: pages.map((page) => ({
        pageId: page.pageId,
        itemNo: page.itemNo,
        sourceName: page.sourceName,
        title: page.title,
        state: page.state,
        questionTags: page.questionTags,
        messageId: page.messageId === null ? null : MessageId.make(page.messageId),
        answersMessageId:
          page.answersMessageId === null ? null : MessageId.make(page.answersMessageId),
        createdAt: page.createdAt,
      })),
      reports: reports.map((report) => ({
        reportId: report.reportId,
        workerThreadId: ThreadId.make(report.workerThreadId),
        kind: report.kind,
        messageId: MessageId.make(report.messageId),
        line: report.line,
        createdAt: report.createdAt,
      })),
    } satisfies PmThreadDetail;
  });

  const summaries = Effect.fn("PmService.summaries")(function* (projectId?: ProjectId) {
    const on = yield* isEnabled;
    if (!on) return { enabled: false, pms: [] } satisfies PmSubscribeEvent;
    const pms = yield* store.listPms(projectId);
    const result: Array<PmSummary> = [];
    for (const row of pms) {
      const { derived, asks, workerStates } = yield* deriveItems(row);
      const live = workerStates.filter((entry) => entry.state !== "resolved");
      const openAsks = asks.filter((entry) => entry.state === "open").length;
      const blocked = derived.some((entry) => entry.shownStatus === "blocked");
      const needsYou = openAsks > 0 || live.some((entry) => entry.state === "waiting");
      const running = live.filter((entry) => entry.state === "running").length;
      result.push({
        threadId: ThreadId.make(row.threadId),
        projectId: row.projectId as ProjectId,
        mission: row.mission,
        openItems: derived.filter(
          (entry) => entry.item.status === "moving" || entry.item.status === "later",
        ).length,
        openAsks,
        workers: live.length,
        runningWorkers: running,
        rowState: blocked ? "blocked" : needsYou ? "needs_you" : running > 0 ? "running" : "idle",
        workerThreadIds: live.map((entry) => ThreadId.make(entry.worker.workerThreadId)),
      });
    }
    return { enabled: true, pms: result } satisfies PmSubscribeEvent;
  });

  const changesStream = Stream.fromPubSub(changes);

  const subscribe = (projectId?: ProjectId) =>
    Stream.concat(
      Stream.fromEffect(summaries(projectId)),
      changesStream.pipe(
        Stream.debounce("100 millis"),
        Stream.mapEffect(() => summaries(projectId)),
      ),
    );

  const subscribeThread = (pm: string) =>
    Stream.concat(
      Stream.fromEffect(detail(pm)),
      changesStream.pipe(
        Stream.filter((id) => id === pm || id === "*"),
        Stream.debounce("100 millis"),
        Stream.mapEffect(() => detail(pm)),
      ),
    );

  const getSettings = Effect.gen(function* () {
    return {
      enabled: yield* isEnabled,
      playbookVersion: PM_PLAYBOOK_VERSION,
      playbookOverrides: yield* playbookOverrides,
    } satisfies PmSettings;
  });

  const setSettings = Effect.fn("PmService.setSettings")(function* (input: {
    readonly enabled?: boolean | undefined;
    readonly playbookOverrides?: ReadonlyArray<string> | undefined;
  }) {
    if (input.playbookOverrides !== undefined)
      yield* store.setSetting(
        "playbook_overrides",
        input.playbookOverrides.map((rule) => rule.trim()).filter((rule) => rule.length > 0),
      );
    if (input.enabled !== undefined) {
      yield* store.setSetting("enabled", input.enabled);
      yield* Ref.set(enabled, input.enabled);
      pmVisibility.setEnabled(input.enabled);
    }
    yield* changed("*");
    return yield* getSettings;
  });

  /** Records the report once, then delivers it once: a retry or a restart never doubles it. */
  const deliverReport = Effect.fn("PmService.deliverReport")(function* (input: ReportInput) {
    const at = yield* nowIso;
    // Readable and stable: the same report always maps to the same row and command.
    const reportId = `report:${input.workerThreadId}:${input.kind}:${input.dedupeKey}`;
    const report = yield* store.claimReport({
      reportId,
      pmThreadId: input.pmThreadId,
      workerThreadId: input.workerThreadId,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      messageId: `message:pm:${reportId}`,
      line: input.line,
      text: input.text,
      summary: input.summary,
      createdAt: at,
    });
    if (report === null || report.deliveredAt !== null) return false;
    yield* redeliver(report);
    return true;
  });

  /** Delivers a claimed report; the command id comes from the report, so a retry is a no-op. */
  const redeliver = Effect.fn("PmService.redeliver")(function* (report: PmReportRow) {
    const at = yield* nowIso;
    yield* dispatchMessage({
      threadId: report.pmThreadId,
      key: report.reportId,
      text: report.text,
      createdBy: "agent",
      senderThreadId: report.workerThreadId,
      notification: { source: { kind: "system" }, outcome: "updated", summary: report.summary },
    });
    yield* store.markReportDelivered(report.reportId, at);
    yield* store.updateWorker(report.workerThreadId, {
      last_report_kind: report.kind,
      last_report_at: at,
      last_report_line: report.line,
    });
    yield* changed(report.pmThreadId);
  });

  const nudgeWorker = (workerThreadId: string, key: string, text: string) =>
    dispatchMessage({ threadId: workerThreadId, key, text, createdBy: "agent" });

  /** The previous-turn floor for item status: shifts when the PM starts a new run. */
  const notePmRun = Effect.fn("PmService.notePmRun")(function* (
    pm: string,
    runId: string,
    at: string,
  ) {
    const row = yield* store.getPm(pm);
    if (row === null || row.turnRunId === runId) return;
    yield* store.updatePm(pm, {
      turn_run_id: runId,
      previous_turn_started_at: row.turnStartedAt,
      turn_started_at: at,
    });
  });

  const forgetThread = Effect.fn("PmService.forgetThread")(function* (threadId: string) {
    if ((yield* store.getPm(threadId)) !== null) {
      yield* store.deletePm(threadId);
      pmVisibility.remove(threadId);
      yield* changed(threadId);
      return;
    }
    const worker = yield* store.getWorker(threadId);
    if (worker !== null && worker.resolvedAt === null) {
      yield* store.updateWorker(threadId, { resolved_at: yield* nowIso });
      yield* changed(worker.pmThreadId);
    }
  });

  return {
    isEnabled,
    changes: changesStream,
    changed,
    create,
    setName,
    setMission,
    setInstructions,
    remember,
    forget,
    editMemory,
    guide,
    playbookOverride,
    status,
    itemAdd,
    itemUpdate,
    itemList,
    ask,
    askDone: (pm: string, tag: string | number) => settleByPm(pm, tag, "done"),
    askWithdraw: (pm: string, tag: string | number) => settleByPm(pm, tag, "withdrawn"),
    nextTag,
    answerAsk,
    snoozeAsk,
    dismissAsk,
    undoDismissAsk,
    startWorker,
    linkWorker,
    unlinkWorker,
    resolveWorker,
    linkAdd,
    pageShow,
    pageRetire,
    pageGet,
    pageAnswer,
    pageMarkSeen,
    detail,
    summaries,
    subscribe,
    subscribeThread,
    getSettings,
    setSettings,
    deliverReport,
    redeliver,
    nudgeWorker,
    notePmRun,
    forgetThread,
    toolResult: tool,
  };
});

export class PmService extends Context.Service<PmService, Effect.Success<typeof make>>()(
  "t3/pm/PmService",
) {}

export const layer = Layer.effect(PmService, make);
