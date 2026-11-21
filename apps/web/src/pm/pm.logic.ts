import type {
  EnvironmentId,
  PmAsk,
  PmItem,
  PmPageSummary,
  PmShownItemStatus,
  ThreadId,
} from "@t3tools/contracts";
import { PM_SHOWN_STATUS_ORDER } from "@t3tools/pm";
import { threadKey } from "@t3tools/client-runtime/state/entities";

/** PMs first, keeping every other order as it was: a stable partition, not a re-sort. */
export function pmFirst<T>(
  threads: ReadonlyArray<T>,
  isPm: (thread: T) => boolean,
): ReadonlyArray<T> {
  const pms = threads.filter(isPm);
  if (pms.length === 0) return threads;
  return [...pms, ...threads.filter((thread) => !isPm(thread))];
}

/** Upstream's set of thread keys shown under a parent, plus every PM worker. */
export function withPmWorkers(
  shownUnderParent: ReadonlySet<string>,
  workerKeys: Iterable<string>,
): ReadonlySet<string> {
  let merged: Set<string> | null = null;
  for (const key of workerKeys) {
    if (shownUnderParent.has(key)) continue;
    merged ??= new Set(shownUnderParent);
    merged.add(key);
  }
  return merged ?? shownUnderParent;
}

/** Workers as upstream's list filters key threads: `threadKey` (environment, NUL, thread). */
export const pmWorkerListKeys = (
  pms: Iterable<{
    readonly environmentId: EnvironmentId;
    readonly workerThreadIds: ReadonlyArray<ThreadId>;
  }>,
) =>
  [...pms].flatMap((pm) =>
    pm.workerThreadIds.map((threadId) => threadKey({ environmentId: pm.environmentId, threadId })),
  );

const DAY_MS = 24 * 60 * 60 * 1000;

export type PmDockRow =
  | { readonly kind: "ask"; readonly key: string; readonly ask: PmAsk; readonly at: string }
  | {
      readonly kind: "page";
      readonly key: string;
      readonly page: PmPageSummary;
      readonly at: string;
    }
  | { readonly kind: "blocked"; readonly key: string; readonly item: PmItem; readonly at: string };

export interface PmDock {
  readonly rows: ReadonlyArray<PmDockRow>;
  /** Rows past the first four. */
  readonly more: number;
  readonly snoozed: ReadonlyArray<PmAsk>;
  readonly counts: {
    readonly needsYou: number;
    readonly blocked: number;
    readonly inProgress: number;
  };
}

const newestFirstAgedLast = (now: number) => (a: PmDockRow, b: PmDockRow) => {
  const aOld = now - Date.parse(a.at) > DAY_MS;
  const bOld = now - Date.parse(b.at) > DAY_MS;
  if (aOld !== bOld) return aOld ? 1 : -1;
  return Date.parse(b.at) - Date.parse(a.at);
};

/**
 * The dock above the composer, Ghostex's rules: what needs you (asks, then pages to answer,
 * newest first, rows older than a day sink), then blocked items no holding ask already shows.
 * Snoozed asks fold into their own line until they wake.
 */
export function pmDock(
  input: {
    readonly asks: ReadonlyArray<PmAsk>;
    readonly pages: ReadonlyArray<PmPageSummary>;
    readonly items: ReadonlyArray<PmItem>;
  },
  now: number,
  limit = 4,
): PmDock {
  const open = input.asks.filter((ask) => ask.state === "open");
  const snoozed = open.filter(
    (ask) => ask.snoozedUntil !== null && Date.parse(ask.snoozedUntil) > now,
  );
  const awake = open.filter((ask) => !snoozed.includes(ask));
  const order = newestFirstAgedLast(now);
  const asks: PmDockRow[] = awake
    .map((ask) => ({ kind: "ask" as const, key: `ask:${ask.askNo}`, ask, at: ask.createdAt }))
    .toSorted(order);
  const pages: PmDockRow[] = input.pages
    .filter((page) => page.state === "open")
    .map((page) => ({
      kind: "page" as const,
      key: `page:${page.pageId}`,
      page,
      at: page.createdAt,
    }))
    .toSorted(order);
  const heldItems = new Set(awake.filter((ask) => ask.holds).map((ask) => ask.itemNo));
  const blocked: PmDockRow[] = input.items
    .filter((item) => item.shownStatus === "blocked" && !heldItems.has(item.itemNo))
    .map((item) => ({
      kind: "blocked" as const,
      key: `item:${item.itemNo}`,
      item,
      at: item.updatedAt,
    }));
  const all = [...asks, ...pages, ...blocked];
  return {
    rows: all.slice(0, limit),
    more: Math.max(0, all.length - limit),
    snoozed,
    counts: {
      needsYou: asks.length + pages.length,
      blocked: input.items.filter((item) => item.shownStatus === "blocked").length,
      inProgress: input.items.filter((item) => item.shownStatus === "in_progress").length,
    },
  };
}

export interface PmItemGroup {
  readonly status: PmShownItemStatus;
  readonly items: ReadonlyArray<PmItem>;
  /** Only In progress and Blocked start open; the user's folds win after that. */
  readonly openByDefault: boolean;
}

/** Work items grouped in Ghostex's order; dropped items are not shown. */
export function pmItemGroups(items: ReadonlyArray<PmItem>): ReadonlyArray<PmItemGroup> {
  return PM_SHOWN_STATUS_ORDER.filter((status) => status !== "dropped").flatMap((status) => {
    const grouped = items.filter((item) => item.shownStatus === status);
    return grouped.length === 0
      ? []
      : [
          {
            status,
            items: grouped,
            openByDefault: status === "in_progress" || status === "blocked",
          },
        ];
  });
}

const REPORT_SUMMARY =
  /^Report from (.+): (Finished|Waiting for an answer|Quiet for 8 min|Stopped mid-turn|Idle while owing work|Restarted)$/;

export type PmReportPill = "finished" | "waiting" | "quiet" | "stopped" | "idle" | "restarted";
const PILLS: Record<string, PmReportPill> = {
  Finished: "finished",
  "Waiting for an answer": "waiting",
  "Quiet for 8 min": "quiet",
  "Stopped mid-turn": "stopped",
  "Idle while owing work": "idle",
  Restarted: "restarted",
};

/** A worker report the PM service sent, read back from its notification. */
export function parsePmReportNotification(notification: {
  readonly source: { readonly kind: string };
  readonly summary: string;
  readonly detail?: string | undefined;
}): { readonly worker: string; readonly pill: PmReportPill; readonly body: string } | null {
  if (notification.source.kind !== "system") return null;
  const match = REPORT_SUMMARY.exec(notification.summary);
  if (!match?.[1] || !match[2]) return null;
  const detail = notification.detail ?? "";
  const body = detail.includes("\n\n") ? detail.slice(detail.indexOf("\n\n") + 2) : detail;
  return { worker: match[1], pill: PILLS[match[2]]!, body };
}

const ANSWERS =
  /^<pm-page-answers page="([^"]*)" title="([^"]*)" tags="([^"]*)">([\s\S]*)<\/pm-page-answers>$/;
const unescapeAttribute = (value: string) =>
  value.replaceAll("&quot;", '"').replaceAll("&amp;", "&");

export interface PmPageAnswers {
  readonly pageId: string;
  readonly title: string;
  readonly tags: ReadonlyArray<string>;
  readonly entries: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  readonly seen: boolean;
  readonly reply: string | null;
}

/** The answers message a Live page sends, for the compact answers card. */
export function parsePmPageAnswers(text: string): PmPageAnswers | null {
  const match = ANSWERS.exec(text.trim());
  if (!match) return null;
  let answers: unknown;
  try {
    answers = JSON.parse(match[4] ?? "null");
  } catch {
    return null;
  }
  const record =
    typeof answers === "object" && answers !== null ? (answers as Record<string, unknown>) : {};
  const seen = record.seen === true;
  const entries = seen
    ? []
    : Object.entries(record).map(([key, value]) => ({
        key,
        value: Array.isArray(value)
          ? value.join(", ")
          : typeof value === "string"
            ? value
            : JSON.stringify(value),
      }));
  return {
    pageId: unescapeAttribute(match[1] ?? ""),
    title: unescapeAttribute(match[2] ?? ""),
    tags: (match[3] ?? "").split(",").filter((tag) => tag.length > 0),
    entries,
    seen,
    reply: seen && typeof record.reply === "string" ? record.reply : null,
  };
}

/** Copy text for an ask row: `W4 Q3`, or `Q3` without an item. */
export const pmAskTag = (ask: Pick<PmAsk, "itemNo" | "askNo">) =>
  `${ask.itemNo === null ? "" : `W${ask.itemNo} `}Q${ask.askNo}`;
