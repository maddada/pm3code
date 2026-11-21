import {
  EnvironmentId,
  type PmAsk,
  type PmItem,
  type PmPageSummary,
  ThreadId,
} from "@t3tools/contracts";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { isShownUnderParent } from "@t3tools/client-runtime/state/threads";
import { describe, expect, it } from "vite-plus/test";

import {
  parsePmPageAnswers,
  parsePmReportNotification,
  pmAskTag,
  pmDock,
  pmFirst,
  pmItemGroups,
  pmWorkerListKeys,
  withPmWorkers,
} from "./pm.logic";

const LISTED = {
  rootThreadId: ThreadId.make("w-1"),
  parentThreadId: null,
  relationshipToParent: null,
};
const NOW = Date.parse("2026-11-21T12:00:00.000Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const ask = (askNo: number, overrides: Partial<PmAsk> = {}): PmAsk => ({
  askNo,
  itemNo: 1,
  title: `Question ${askNo}`,
  detail: "Why.",
  answers: ["Yes", "No"],
  recommended: "Yes",
  holds: false,
  state: "open",
  answer: null,
  snoozedUntil: null,
  answerMessageId: null,
  createdAt: at(askNo),
  settledAt: null,
  ...overrides,
});

const item = (itemNo: number, overrides: Partial<PmItem> = {}): PmItem => ({
  itemNo,
  title: `Item ${itemNo}`,
  status: "moving",
  shownStatus: "in_progress",
  laterReason: null,
  nowLine: null,
  doneLine: null,
  steps: [],
  waits: [],
  createdAt: at(60),
  updatedAt: at(5),
  finishedAt: null,
  droppedAt: null,
  ...overrides,
});

const page = (pageId: string, overrides: Partial<PmPageSummary> = {}): PmPageSummary => ({
  pageId,
  itemNo: null,
  sourceName: `${pageId}.html`,
  title: pageId,
  state: "open",
  questionTags: [],
  messageId: null,
  answersMessageId: null,
  createdAt: at(3),
  ...overrides,
});

describe("pmFirst", () => {
  it("moves PMs to the front and keeps every other order", () => {
    expect(pmFirst(["a", "pm1", "b", "pm2", "c"], (id) => id.startsWith("pm"))).toEqual([
      "pm1",
      "pm2",
      "a",
      "b",
      "c",
    ]);
  });

  it("returns the same list when there is no PM", () => {
    const threads = ["a", "b"];
    expect(pmFirst(threads, () => false)).toBe(threads);
  });
});

describe("withPmWorkers", () => {
  it("adds worker keys and keeps the set's identity when nothing changes", () => {
    const shown = new Set(["delegated"]);
    expect([...withPmWorkers(shown, ["w1", "w2"])].toSorted()).toEqual(["delegated", "w1", "w2"]);
    expect(withPmWorkers(shown, ["delegated"])).toBe(shown);
    expect(withPmWorkers(shown, [])).toBe(shown);
  });
});

describe("pmWorkerListKeys", () => {
  it("keys workers the way upstream's list filters key threads, so they really hide", () => {
    const environmentId = EnvironmentId.make("env-1");
    const workerKeys = pmWorkerListKeys([
      { environmentId, workerThreadIds: [ThreadId.make("w-1")] },
    ]);
    expect(workerKeys).toEqual([threadKey({ environmentId, threadId: ThreadId.make("w-1") })]);
    expect(
      isShownUnderParent(
        { environmentId, threadId: ThreadId.make("w-1") },
        LISTED,
        new Set(workerKeys),
      ),
    ).toBe(true);
  });
});

describe("pmDock", () => {
  it("lists asks newest first, then pages, then blocked items no holding ask shows, at most four", () => {
    const dock = pmDock(
      {
        asks: [ask(1), ask(2, { holds: true, itemNo: 3 }), ask(3)],
        pages: [page("icons")],
        items: [item(3, { shownStatus: "blocked" }), item(4, { shownStatus: "blocked" }), item(5)],
      },
      NOW,
    );
    expect(dock.rows.map((row) => row.key)).toEqual(["ask:1", "ask:2", "ask:3", "page:icons"]);
    expect(dock.more).toBe(1);
    expect(dock.counts).toEqual({ needsYou: 4, blocked: 2, inProgress: 1 });
  });

  it("sinks rows older than a day and folds snoozed asks into their own line", () => {
    const dock = pmDock(
      {
        asks: [
          ask(1, { createdAt: at(60 * 30) }),
          ask(2, { createdAt: at(10) }),
          ask(3, { snoozedUntil: new Date(NOW + 3_600_000).toISOString() }),
          ask(4, { snoozedUntil: new Date(NOW - 60_000).toISOString() }),
          ask(5, { state: "answered" }),
        ],
        pages: [],
        items: [],
      },
      NOW,
    );
    expect(dock.rows.map((row) => row.key)).toEqual(["ask:4", "ask:2", "ask:1"]);
    expect(dock.snoozed.map((snoozed) => snoozed.askNo)).toEqual([3]);
  });
});

describe("pmItemGroups", () => {
  it("groups in Ghostex's order, hides dropped items, and opens only In progress and Blocked", () => {
    const groups = pmItemGroups([
      item(1, { shownStatus: "done" }),
      item(2, { shownStatus: "blocked" }),
      item(3, { shownStatus: "dropped" }),
      item(4, { shownStatus: "needs_you" }),
      item(5),
    ]);
    expect(groups.map((group) => [group.status, group.openByDefault])).toEqual([
      ["needs_you", false],
      ["blocked", true],
      ["in_progress", true],
      ["done", false],
    ]);
  });
});

describe("parsePmReportNotification", () => {
  it("reads the worker, the pill and the body of a report", () => {
    expect(
      parsePmReportNotification({
        source: { kind: "system" },
        summary: "Report from Fix pairing: Waiting for an answer",
        detail: 'Worker report from "Fix pairing" (thread w): Waiting for an answer\n\nIt waits.',
      }),
    ).toEqual({ worker: "Fix pairing", pill: "waiting", body: "It waits." });
  });

  it("ignores other notifications", () => {
    expect(
      parsePmReportNotification({
        source: { kind: "delegated_task" },
        summary: "Report from X: Finished",
      }),
    ).toBeNull();
    expect(
      parsePmReportNotification({ source: { kind: "system" }, summary: "Project manager setup" }),
    ).toBeNull();
  });
});

describe("parsePmPageAnswers", () => {
  it("reads a page's answers message", () => {
    expect(
      parsePmPageAnswers(
        '<pm-page-answers page="page-1" title="Icons &amp; more" tags="Q4,Q5">{"Q4":"Round","Q5":["A","B"]}</pm-page-answers>',
      ),
    ).toEqual({
      pageId: "page-1",
      title: "Icons & more",
      tags: ["Q4", "Q5"],
      entries: [
        { key: "Q4", value: "Round" },
        { key: "Q5", value: "A, B" },
      ],
      seen: false,
      reply: null,
    });
  });

  it("reads a seen reply and refuses anything else", () => {
    expect(
      parsePmPageAnswers(
        '<pm-page-answers page="p" title="Plan" tags="">{"seen":true,"reply":"Looks good"}</pm-page-answers>',
      ),
    ).toMatchObject({ seen: true, reply: "Looks good", entries: [] });
    expect(parsePmPageAnswers("W1 Q1: Yes")).toBeNull();
    expect(
      parsePmPageAnswers('<pm-page-answers page="p" title="t" tags="">not json</pm-page-answers>'),
    ).toBeNull();
  });
});

describe("pmAskTag", () => {
  it("copies an ask as its tags", () => {
    expect(pmAskTag({ itemNo: 4, askNo: 3 })).toBe("W4 Q3");
    expect(pmAskTag({ itemNo: null, askNo: 3 })).toBe("Q3");
  });
});
