import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";
import { PmError, type PmReportKind } from "@t3tools/contracts";
import type { PmAskState, PmStoredItemStatus } from "@t3tools/pm";

import { runPmMigrations } from "./PmMigrations.ts";

export interface PmThreadRow {
  readonly threadId: string;
  readonly projectId: string;
  readonly mission: string;
  readonly instructions: string;
  readonly nextItemNo: number;
  readonly nextAskNo: number;
  readonly guideVersionRead: number | null;
  readonly guideTextRead: string | null;
  readonly openAsksTold: string;
  readonly turnRunId: string | null;
  readonly turnStartedAt: string | null;
  readonly previousTurnStartedAt: string | null;
  readonly createdAt: string;
}

export interface PmWorkerWatch {
  /** The run a quiet streak belongs to; a new run starts a new streak. */
  readonly quietRunId?: string;
  readonly quietRound?: number;
  readonly nudgedRunId?: string;
  readonly idleNudgedFor?: string;
}

export interface PmWorkerRow {
  readonly workerThreadId: string;
  readonly pmThreadId: string;
  readonly itemNo: number | null;
  readonly linkedAt: string;
  readonly resolvedAt: string | null;
  readonly lastReportKind: PmReportKind | null;
  readonly lastReportAt: string | null;
  readonly lastReportLine: string | null;
  readonly watch: PmWorkerWatch;
}

export interface PmItemRow {
  readonly itemNo: number;
  readonly title: string;
  readonly status: PmStoredItemStatus;
  readonly laterReason: string | null;
  readonly nowLine: string | null;
  readonly doneLine: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
  readonly droppedAt: string | null;
}

export interface PmStepRow {
  readonly itemNo: number;
  readonly stepNo: number;
  readonly text: string;
  readonly done: boolean;
  readonly chore: boolean;
  readonly at: string;
}

export interface PmWaitRow {
  readonly itemNo: number;
  readonly waitNo: number;
  readonly onKind: "item" | "ask" | "text";
  readonly onRef: string;
  readonly since: string;
  readonly clearedAt: string | null;
}

export interface PmAskRow {
  readonly askNo: number;
  readonly itemNo: number | null;
  readonly title: string;
  readonly detail: string;
  readonly answers: ReadonlyArray<string>;
  readonly recommended: string | null;
  readonly holds: boolean;
  readonly state: PmAskState;
  readonly answer: string | null;
  readonly snoozedUntil: string | null;
  readonly dismissalTold: boolean;
  readonly answerMessageId: string | null;
  readonly createdAt: string;
  readonly settledAt: string | null;
}

export interface PmLinkRow {
  readonly linkNo: number;
  readonly itemNo: number | null;
  readonly workerThreadId: string | null;
  readonly url: string;
  readonly kind: "pr" | "issue" | "url";
  readonly title: string | null;
}

export interface PmMemoryRow {
  readonly position: number;
  readonly text: string;
  readonly createdAt: string;
}

export interface PmReportRow {
  readonly reportId: string;
  readonly pmThreadId: string;
  readonly workerThreadId: string;
  readonly kind: PmReportKind;
  readonly dedupeKey: string;
  readonly messageId: string;
  readonly line: string;
  readonly text: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
}

export interface PmPageRow {
  readonly pageId: string;
  readonly pmThreadId: string;
  readonly itemNo: number | null;
  readonly sourceName: string;
  readonly title: string;
  readonly html: string;
  readonly questionTags: ReadonlyArray<string>;
  readonly state: "open" | "answered" | "seen" | "replaced" | "retired";
  readonly answersJson: string | null;
  readonly messageId: string | null;
  readonly answersMessageId: string | null;
  readonly createdAt: string;
}

type Row = Record<string, unknown>;
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const parseJson = <A>(value: unknown, fallback: A): A => {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as A;
  } catch {
    return fallback;
  }
};

const toPm = (row: Row): PmThreadRow => ({
  threadId: String(row.thread_id),
  projectId: String(row.project_id),
  mission: String(row.mission),
  instructions: String(row.instructions),
  nextItemNo: Number(row.next_item_no),
  nextAskNo: Number(row.next_ask_no),
  guideVersionRead: num(row.guide_version_read),
  guideTextRead: str(row.guide_text_read),
  openAsksTold: String(row.open_asks_told ?? ""),
  turnRunId: str(row.turn_run_id),
  turnStartedAt: str(row.turn_started_at),
  previousTurnStartedAt: str(row.previous_turn_started_at),
  createdAt: String(row.created_at),
});

const toWorker = (row: Row): PmWorkerRow => ({
  workerThreadId: String(row.worker_thread_id),
  pmThreadId: String(row.pm_thread_id),
  itemNo: num(row.item_no),
  linkedAt: String(row.linked_at),
  resolvedAt: str(row.resolved_at),
  lastReportKind: str(row.last_report_kind) as PmReportKind | null,
  lastReportAt: str(row.last_report_at),
  lastReportLine: str(row.last_report_line),
  watch: parseJson<PmWorkerWatch>(row.watch_json, {}),
});

const toItem = (row: Row): PmItemRow => ({
  itemNo: Number(row.item_no),
  title: String(row.title),
  status: String(row.status) as PmStoredItemStatus,
  laterReason: str(row.later_reason),
  nowLine: str(row.now_line),
  doneLine: str(row.done_line),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  finishedAt: str(row.finished_at),
  droppedAt: str(row.dropped_at),
});

const toStep = (row: Row): PmStepRow => ({
  itemNo: Number(row.item_no),
  stepNo: Number(row.step_no),
  text: String(row.text),
  done: Number(row.done) === 1,
  chore: Number(row.chore) === 1,
  at: String(row.at),
});

const toWait = (row: Row): PmWaitRow => ({
  itemNo: Number(row.item_no),
  waitNo: Number(row.wait_no),
  onKind: String(row.on_kind) as PmWaitRow["onKind"],
  onRef: String(row.on_ref),
  since: String(row.since),
  clearedAt: str(row.cleared_at),
});

const toAsk = (row: Row): PmAskRow => ({
  askNo: Number(row.ask_no),
  itemNo: num(row.item_no),
  title: String(row.title),
  detail: String(row.detail),
  answers: parseJson<ReadonlyArray<string>>(row.answers_json, []),
  recommended: str(row.recommended),
  holds: Number(row.holds) === 1,
  state: String(row.state) as PmAskState,
  answer: str(row.answer),
  snoozedUntil: str(row.snoozed_until),
  dismissalTold: Number(row.dismissal_told) === 1,
  answerMessageId: str(row.answer_message_id),
  createdAt: String(row.created_at),
  settledAt: str(row.settled_at),
});

const toLink = (row: Row): PmLinkRow => ({
  linkNo: Number(row.link_no),
  itemNo: num(row.item_no),
  workerThreadId: str(row.worker_thread_id),
  url: String(row.url),
  kind: String(row.kind) as PmLinkRow["kind"],
  title: str(row.title),
});

const toMemory = (row: Row): PmMemoryRow => ({
  position: Number(row.position),
  text: String(row.text),
  createdAt: String(row.created_at),
});

const toReport = (row: Row): PmReportRow => ({
  reportId: String(row.report_id),
  pmThreadId: String(row.pm_thread_id),
  workerThreadId: String(row.worker_thread_id),
  kind: String(row.kind) as PmReportKind,
  dedupeKey: String(row.dedupe_key),
  messageId: String(row.message_id),
  line: String(row.line),
  text: String(row.text),
  summary: String(row.summary),
  createdAt: String(row.created_at),
  deliveredAt: str(row.delivered_at),
});

const toPage = (row: Row): PmPageRow => ({
  pageId: String(row.page_id),
  pmThreadId: String(row.pm_thread_id),
  itemNo: num(row.item_no),
  sourceName: String(row.source_name),
  title: String(row.title),
  html: String(row.html),
  questionTags: parseJson<ReadonlyArray<string>>(row.question_tags_json, []),
  state: String(row.state) as PmPageRow["state"],
  answersJson: str(row.answers_json),
  messageId: str(row.message_id),
  answersMessageId: str(row.answers_message_id),
  createdAt: String(row.created_at),
});

export type PmItemPatch = Partial<{
  title: string;
  status: PmStoredItemStatus;
  later_reason: string | null;
  now_line: string | null;
  done_line: string | null;
  finished_at: string | null;
  dropped_at: string | null;
}>;

export type PmAskPatch = Partial<{
  state: PmAskState;
  answer: string | null;
  snoozed_until: string | null;
  dismissal_told: number;
  answer_message_id: string | null;
  settled_at: string | null;
}>;

export type PmThreadPatch = Partial<{
  mission: string;
  instructions: string;
  guide_version_read: number;
  guide_text_read: string;
  open_asks_told: string;
  turn_run_id: string | null;
  turn_started_at: string | null;
  previous_turn_started_at: string | null;
}>;

export type PmWorkerPatch = Partial<{
  item_no: number | null;
  resolved_at: string | null;
  last_report_kind: PmReportKind;
  last_report_at: string;
  last_report_line: string;
  watch_json: string;
}>;

export type PmPagePatch = Partial<{
  state: PmPageRow["state"];
  answers_json: string;
  message_id: string;
  answers_message_id: string;
}>;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runPmMigrations().pipe(Effect.orDie);

  const fail = (operation: string) => (cause: SqlError.SqlError) =>
    Effect.logWarning("PM storage failed", { operation, cause }).pipe(
      Effect.andThen(
        Effect.fail(
          new PmError({ code: "unavailable", message: `PM storage failed (${operation}).` }),
        ),
      ),
    );
  const run = <A>(operation: string, effect: Effect.Effect<A, SqlError.SqlError>) =>
    effect.pipe(Effect.catch(fail(operation)));
  const rows = (operation: string, effect: Effect.Effect<ReadonlyArray<Row>, SqlError.SqlError>) =>
    run(operation, effect);
  const first = <A>(
    operation: string,
    effect: Effect.Effect<ReadonlyArray<Row>, SqlError.SqlError>,
    map: (row: Row) => A,
  ) => run(operation, effect).pipe(Effect.map((found) => (found[0] ? map(found[0]) : null)));
  const exec = (operation: string, effect: Effect.Effect<unknown, SqlError.SqlError>) =>
    run(operation, effect).pipe(Effect.asVoid);

  return {
    transaction: <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | PmError, R> =>
      sql
        .withTransaction(effect)
        .pipe(
          Effect.catchIf(
            (error): error is SqlError.SqlError => SqlError.isSqlError(error),
            fail("transaction"),
          ),
        ),

    getSetting: (key: string) =>
      first(
        "getSetting",
        sql`SELECT value_json FROM pm_settings WHERE key = ${key}`,
        (row) => row.value_json as string,
      ).pipe(
        Effect.map((value) =>
          value === null ? undefined : (parseJson(value, undefined) as unknown),
        ),
      ),
    setSetting: (key: string, value: unknown) =>
      exec(
        "setSetting",
        sql`INSERT INTO pm_settings (key, value_json) VALUES (${key}, ${JSON.stringify(value)})
            ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
      ),

    insertPm: (input: { threadId: string; projectId: string; createdAt: string }) =>
      exec(
        "insertPm",
        sql`INSERT OR IGNORE INTO pm_threads ${sql.insert({
          thread_id: input.threadId,
          project_id: input.projectId,
          created_at: input.createdAt,
        })}`,
      ),
    getPm: (threadId: string) =>
      first("getPm", sql`SELECT * FROM pm_threads WHERE thread_id = ${threadId}`, toPm),
    listPms: (projectId?: string) =>
      rows(
        "listPms",
        projectId === undefined
          ? sql`SELECT * FROM pm_threads ORDER BY created_at`
          : sql`SELECT * FROM pm_threads WHERE project_id = ${projectId} ORDER BY created_at`,
      ).pipe(Effect.map((found) => found.map(toPm))),
    updatePm: (threadId: string, patch: PmThreadPatch) =>
      Object.keys(patch).length === 0
        ? Effect.void
        : exec(
            "updatePm",
            sql`UPDATE pm_threads SET ${sql.update(patch)} WHERE thread_id = ${threadId}`,
          ),
    /** Counters only go up, so a number always means one item or ask. */
    allocate: (threadId: string, counter: "next_item_no" | "next_ask_no" | "next_link_no") =>
      first(
        "allocate",
        sql`UPDATE pm_threads SET ${sql(counter)} = ${sql(counter)} + 1
            WHERE thread_id = ${threadId} RETURNING ${sql(counter)} - 1 AS allocated`,
        (row) => Number(row.allocated),
      ),
    deletePm: (threadId: string) =>
      Effect.forEach(
        [
          "pm_threads",
          "pm_items",
          "pm_item_steps",
          "pm_item_waits",
          "pm_asks",
          "pm_links",
          "pm_memory",
          "pm_reports",
          "pm_pages",
        ],
        (table) =>
          exec(
            "deletePm",
            table === "pm_threads"
              ? sql`DELETE FROM pm_threads WHERE thread_id = ${threadId}`
              : sql`DELETE FROM ${sql(table)} WHERE pm_thread_id = ${threadId}`,
          ),
        { discard: true },
      ).pipe(
        // Its workers stay as ordinary threads; only the link goes.
        Effect.andThen(
          exec("deletePm", sql`DELETE FROM pm_workers WHERE pm_thread_id = ${threadId}`),
        ),
      ),

    upsertWorker: (input: {
      workerThreadId: string;
      pmThreadId: string;
      itemNo: number | null;
      linkedAt: string;
    }) =>
      exec(
        "upsertWorker",
        sql`INSERT INTO pm_workers (worker_thread_id, pm_thread_id, item_no, linked_at)
            VALUES (${input.workerThreadId}, ${input.pmThreadId}, ${input.itemNo}, ${input.linkedAt})
            ON CONFLICT (worker_thread_id) DO UPDATE SET
              pm_thread_id = excluded.pm_thread_id,
              item_no = COALESCE(excluded.item_no, pm_workers.item_no),
              linked_at = excluded.linked_at,
              resolved_at = NULL,
              watch_json = '{}'`,
      ),
    getWorker: (workerThreadId: string) =>
      first(
        "getWorker",
        sql`SELECT * FROM pm_workers WHERE worker_thread_id = ${workerThreadId}`,
        toWorker,
      ),
    listWorkers: (pmThreadId?: string) =>
      rows(
        "listWorkers",
        pmThreadId === undefined
          ? sql`SELECT * FROM pm_workers ORDER BY linked_at`
          : sql`SELECT * FROM pm_workers WHERE pm_thread_id = ${pmThreadId} ORDER BY linked_at`,
      ).pipe(Effect.map((found) => found.map(toWorker))),
    updateWorker: (workerThreadId: string, patch: PmWorkerPatch) =>
      exec(
        "updateWorker",
        sql`UPDATE pm_workers SET ${sql.update(patch)} WHERE worker_thread_id = ${workerThreadId}`,
      ),
    updateWatch: (workerThreadId: string, watch: PmWorkerWatch) =>
      exec(
        "updateWatch",
        sql`UPDATE pm_workers SET watch_json = ${JSON.stringify(watch)}
            WHERE worker_thread_id = ${workerThreadId}`,
      ),
    deleteWorker: (workerThreadId: string) =>
      exec("deleteWorker", sql`DELETE FROM pm_workers WHERE worker_thread_id = ${workerThreadId}`),

    insertItem: (pm: string, item: { itemNo: number; title: string; at: string }) =>
      exec(
        "insertItem",
        sql`INSERT INTO pm_items ${sql.insert({
          pm_thread_id: pm,
          item_no: item.itemNo,
          title: item.title,
          status: "moving",
          created_at: item.at,
          updated_at: item.at,
        })}`,
      ),
    getItem: (pm: string, itemNo: number) =>
      first(
        "getItem",
        sql`SELECT * FROM pm_items WHERE pm_thread_id = ${pm} AND item_no = ${itemNo}`,
        toItem,
      ),
    listItems: (pm: string) =>
      rows(
        "listItems",
        sql`SELECT * FROM pm_items WHERE pm_thread_id = ${pm} ORDER BY item_no`,
      ).pipe(Effect.map((found) => found.map(toItem))),
    updateItem: (pm: string, itemNo: number, patch: PmItemPatch, at: string) =>
      exec(
        "updateItem",
        sql`UPDATE pm_items SET ${sql.update({ ...patch, updated_at: at })}
            WHERE pm_thread_id = ${pm} AND item_no = ${itemNo}`,
      ),

    insertStep: (pm: string, step: { itemNo: number; text: string; chore: boolean; at: string }) =>
      first(
        "insertStep",
        sql`INSERT INTO pm_item_steps (pm_thread_id, item_no, step_no, text, chore, at)
            SELECT ${pm}, ${step.itemNo}, COALESCE(MAX(step_no), 0) + 1, ${step.text},
                   ${step.chore ? 1 : 0}, ${step.at}
            FROM pm_item_steps WHERE pm_thread_id = ${pm} AND item_no = ${step.itemNo}
            RETURNING step_no`,
        (row) => Number(row.step_no),
      ),
    setStepDone: (pm: string, itemNo: number, stepNo: number) =>
      run(
        "setStepDone",
        sql`UPDATE pm_item_steps SET done = 1
            WHERE pm_thread_id = ${pm} AND item_no = ${itemNo} AND step_no = ${stepNo}
            RETURNING step_no`,
      ).pipe(Effect.map((found) => found.length > 0)),
    listSteps: (pm: string) =>
      rows(
        "listSteps",
        sql`SELECT * FROM pm_item_steps WHERE pm_thread_id = ${pm} ORDER BY item_no, step_no`,
      ).pipe(Effect.map((found) => found.map(toStep))),

    insertWait: (
      pm: string,
      wait: { itemNo: number; onKind: PmWaitRow["onKind"]; onRef: string; at: string },
    ) =>
      exec(
        "insertWait",
        sql`INSERT INTO pm_item_waits (pm_thread_id, item_no, wait_no, on_kind, on_ref, since)
            SELECT ${pm}, ${wait.itemNo}, COALESCE(MAX(wait_no), 0) + 1, ${wait.onKind},
                   ${wait.onRef}, ${wait.at}
            FROM pm_item_waits WHERE pm_thread_id = ${pm} AND item_no = ${wait.itemNo}`,
      ),
    clearWaits: (pm: string, itemNo: number, at: string) =>
      exec(
        "clearWaits",
        sql`UPDATE pm_item_waits SET cleared_at = ${at}
            WHERE pm_thread_id = ${pm} AND item_no = ${itemNo} AND cleared_at IS NULL`,
      ),
    listWaits: (pm: string) =>
      rows(
        "listWaits",
        sql`SELECT * FROM pm_item_waits WHERE pm_thread_id = ${pm} ORDER BY item_no, wait_no`,
      ).pipe(Effect.map((found) => found.map(toWait))),

    insertAsk: (
      pm: string,
      ask: {
        askNo: number;
        itemNo: number | null;
        title: string;
        detail: string;
        answers: ReadonlyArray<string>;
        recommended: string | null;
        holds: boolean;
        at: string;
      },
    ) =>
      exec(
        "insertAsk",
        sql`INSERT INTO pm_asks ${sql.insert({
          pm_thread_id: pm,
          ask_no: ask.askNo,
          item_no: ask.itemNo,
          title: ask.title,
          detail: ask.detail,
          answers_json: JSON.stringify(ask.answers),
          recommended: ask.recommended,
          holds: ask.holds ? 1 : 0,
          state: "open",
          created_at: ask.at,
        })}`,
      ),
    getAsk: (pm: string, askNo: number) =>
      first(
        "getAsk",
        sql`SELECT * FROM pm_asks WHERE pm_thread_id = ${pm} AND ask_no = ${askNo}`,
        toAsk,
      ),
    listAsks: (pm: string) =>
      rows("listAsks", sql`SELECT * FROM pm_asks WHERE pm_thread_id = ${pm} ORDER BY ask_no`).pipe(
        Effect.map((found) => found.map(toAsk)),
      ),
    updateAsk: (pm: string, askNo: number, patch: PmAskPatch) =>
      exec(
        "updateAsk",
        sql`UPDATE pm_asks SET ${sql.update(patch)} WHERE pm_thread_id = ${pm} AND ask_no = ${askNo}`,
      ),
    /** Settles one open ask; false when it was already settled (a second click). */
    settleAsk: (pm: string, askNo: number, patch: PmAskPatch) =>
      run(
        "settleAsk",
        sql`UPDATE pm_asks SET ${sql.update(patch)}
            WHERE pm_thread_id = ${pm} AND ask_no = ${askNo} AND state = 'open'
            RETURNING ask_no`,
      ).pipe(Effect.map((found) => found.length > 0)),

    insertLink: (
      pm: string,
      link: {
        linkNo: number;
        itemNo: number | null;
        workerThreadId: string | null;
        url: string;
        kind: PmLinkRow["kind"];
        title: string | null;
      },
    ) =>
      exec(
        "insertLink",
        sql`INSERT INTO pm_links ${sql.insert({
          pm_thread_id: pm,
          link_no: link.linkNo,
          item_no: link.itemNo,
          worker_thread_id: link.workerThreadId,
          url: link.url,
          kind: link.kind,
          title: link.title,
        })}`,
      ),
    listLinks: (pm: string) =>
      rows(
        "listLinks",
        sql`SELECT * FROM pm_links WHERE pm_thread_id = ${pm} ORDER BY link_no`,
      ).pipe(Effect.map((found) => found.map(toLink))),

    listMemory: (pm: string) =>
      rows(
        "listMemory",
        sql`SELECT * FROM pm_memory WHERE pm_thread_id = ${pm} ORDER BY position`,
      ).pipe(Effect.map((found) => found.map(toMemory))),
    /** Replaces every note: forget renumbers, as Ghostex does. */
    replaceMemory: (pm: string, notes: ReadonlyArray<{ text: string; createdAt: string }>) =>
      exec("replaceMemory", sql`DELETE FROM pm_memory WHERE pm_thread_id = ${pm}`).pipe(
        Effect.andThen(
          Effect.forEach(
            notes,
            (note, index) =>
              exec(
                "replaceMemory",
                sql`INSERT INTO pm_memory ${sql.insert({
                  pm_thread_id: pm,
                  position: index + 1,
                  text: note.text,
                  created_at: note.createdAt,
                })}`,
              ),
            { discard: true },
          ),
        ),
      ),

    /** Inserts the report once; a second call with the same key returns the stored row. */
    claimReport: (report: Omit<PmReportRow, "deliveredAt">) =>
      exec(
        "claimReport",
        sql`INSERT OR IGNORE INTO pm_reports ${sql.insert({
          report_id: report.reportId,
          pm_thread_id: report.pmThreadId,
          worker_thread_id: report.workerThreadId,
          kind: report.kind,
          dedupe_key: report.dedupeKey,
          message_id: report.messageId,
          line: report.line,
          text: report.text,
          summary: report.summary,
          created_at: report.createdAt,
        })}`,
      ).pipe(
        Effect.andThen(
          first(
            "claimReport",
            sql`SELECT * FROM pm_reports WHERE worker_thread_id = ${report.workerThreadId}
                AND kind = ${report.kind} AND dedupe_key = ${report.dedupeKey}`,
            toReport,
          ),
        ),
      ),
    markReportDelivered: (reportId: string, at: string) =>
      exec(
        "markReportDelivered",
        sql`UPDATE pm_reports SET delivered_at = ${at} WHERE report_id = ${reportId}`,
      ),
    listReports: (pm: string, limit: number) =>
      rows(
        "listReports",
        sql`SELECT * FROM pm_reports WHERE pm_thread_id = ${pm}
            ORDER BY created_at DESC LIMIT ${limit}`,
      ).pipe(Effect.map((found) => found.map(toReport))),
    listUndeliveredReports: () =>
      rows(
        "listUndeliveredReports",
        sql`SELECT * FROM pm_reports WHERE delivered_at IS NULL ORDER BY created_at`,
      ).pipe(Effect.map((found) => found.map(toReport))),

    insertPage: (page: Omit<PmPageRow, "answersJson" | "answersMessageId">) =>
      exec(
        "insertPage",
        sql`INSERT INTO pm_pages ${sql.insert({
          page_id: page.pageId,
          pm_thread_id: page.pmThreadId,
          item_no: page.itemNo,
          source_name: page.sourceName,
          title: page.title,
          html: page.html,
          question_tags_json: JSON.stringify(page.questionTags),
          state: page.state,
          message_id: page.messageId,
          created_at: page.createdAt,
        })}`,
      ),
    getPage: (pageId: string) =>
      first("getPage", sql`SELECT * FROM pm_pages WHERE page_id = ${pageId}`, toPage),
    listPages: (pm: string) =>
      rows(
        "listPages",
        sql`SELECT * FROM pm_pages WHERE pm_thread_id = ${pm} ORDER BY created_at`,
      ).pipe(Effect.map((found) => found.map(toPage))),
    updatePage: (pageId: string, patch: PmPagePatch) =>
      exec("updatePage", sql`UPDATE pm_pages SET ${sql.update(patch)} WHERE page_id = ${pageId}`),
    /** First submission wins: false when the page was no longer open. */
    answerPage: (pageId: string, patch: PmPagePatch) =>
      run(
        "answerPage",
        sql`UPDATE pm_pages SET ${sql.update(patch)}
            WHERE page_id = ${pageId} AND state = 'open' RETURNING page_id`,
      ).pipe(Effect.map((found) => found.length > 0)),
  };
});

export class PmStore extends Context.Service<PmStore, Effect.Success<typeof make>>()(
  "t3/pm/PmStore",
) {}

export const layer = Layer.effect(PmStore, make);
