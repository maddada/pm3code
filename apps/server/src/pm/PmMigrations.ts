import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

// The fork keeps its own ledger so upstream's `effect_sql_migrations` never sees a fork id: an
// upstream build opens a fork database unchanged, and the fork opens an upstream one by adding
// these tables. Only `CREATE ... IF NOT EXISTS pm_*`; never touch an upstream table, and no
// foreign keys into upstream tables (upstream rebuilds them).
export const PM_MIGRATIONS_TABLE = "pm_migrations";

const createTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mission TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      next_item_no INTEGER NOT NULL DEFAULT 1,
      next_ask_no INTEGER NOT NULL DEFAULT 1,
      next_link_no INTEGER NOT NULL DEFAULT 1,
      guide_version_read INTEGER,
      guide_text_read TEXT,
      open_asks_told TEXT NOT NULL DEFAULT '',
      turn_run_id TEXT,
      turn_started_at TEXT,
      previous_turn_started_at TEXT,
      created_at TEXT NOT NULL
    ) WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS pm_threads_project ON pm_threads (project_id)`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_workers (
      worker_thread_id TEXT PRIMARY KEY,
      pm_thread_id TEXT NOT NULL,
      item_no INTEGER,
      linked_at TEXT NOT NULL,
      resolved_at TEXT,
      last_report_kind TEXT,
      last_report_at TEXT,
      last_report_line TEXT,
      watch_json TEXT NOT NULL DEFAULT '{}'
    ) WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS pm_workers_pm ON pm_workers (pm_thread_id)`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_items (
      pm_thread_id TEXT NOT NULL,
      item_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      later_reason TEXT,
      now_line TEXT,
      done_line TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      dropped_at TEXT,
      PRIMARY KEY (pm_thread_id, item_no)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_item_steps (
      pm_thread_id TEXT NOT NULL,
      item_no INTEGER NOT NULL,
      step_no INTEGER NOT NULL,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      chore INTEGER NOT NULL DEFAULT 0,
      at TEXT NOT NULL,
      PRIMARY KEY (pm_thread_id, item_no, step_no)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_item_waits (
      pm_thread_id TEXT NOT NULL,
      item_no INTEGER NOT NULL,
      wait_no INTEGER NOT NULL,
      on_kind TEXT NOT NULL,
      on_ref TEXT NOT NULL,
      since TEXT NOT NULL,
      cleared_at TEXT,
      PRIMARY KEY (pm_thread_id, item_no, wait_no)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_asks (
      pm_thread_id TEXT NOT NULL,
      ask_no INTEGER NOT NULL,
      item_no INTEGER,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      answers_json TEXT NOT NULL DEFAULT '[]',
      recommended TEXT,
      holds INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL,
      answer TEXT,
      snoozed_until TEXT,
      dismissal_told INTEGER NOT NULL DEFAULT 0,
      answer_message_id TEXT,
      created_at TEXT NOT NULL,
      settled_at TEXT,
      PRIMARY KEY (pm_thread_id, ask_no)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_links (
      pm_thread_id TEXT NOT NULL,
      link_no INTEGER NOT NULL,
      item_no INTEGER,
      worker_thread_id TEXT,
      url TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT,
      PRIMARY KEY (pm_thread_id, link_no)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_memory (
      pm_thread_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (pm_thread_id, position)
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_reports (
      report_id TEXT PRIMARY KEY,
      pm_thread_id TEXT NOT NULL,
      worker_thread_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      message_id TEXT NOT NULL,
      line TEXT NOT NULL,
      text TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      UNIQUE (worker_thread_id, kind, dedupe_key)
    ) WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS pm_reports_pm ON pm_reports (pm_thread_id, created_at)`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_pages (
      page_id TEXT PRIMARY KEY,
      pm_thread_id TEXT NOT NULL,
      item_no INTEGER,
      source_name TEXT NOT NULL,
      title TEXT NOT NULL,
      html TEXT NOT NULL,
      question_tags_json TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL,
      answers_json TEXT,
      message_id TEXT,
      answers_message_id TEXT,
      created_at TEXT NOT NULL
    ) WITHOUT ROWID
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS pm_pages_pm ON pm_pages (pm_thread_id, created_at)`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS pm_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    ) WITHOUT ROWID
  `;
});

const pmMigrationEntries = [[1, "PmTables", createTables]] as const;

const run = Migrator.make({});

export const runPmMigrations = Effect.fn("PmMigrations.run")(function* () {
  return yield* run({
    table: PM_MIGRATIONS_TABLE,
    loader: Migrator.fromRecord(
      Object.fromEntries(
        pmMigrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
      ),
    ),
  });
});
