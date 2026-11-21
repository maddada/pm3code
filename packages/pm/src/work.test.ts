import { describe, expect, it } from "@effect/vitest";

import {
  derivePmItemStatus,
  formatPmAnswerMessage,
  handsWorkToUser,
  parseAskTag,
  parseItemTag,
  parsePmAnswers,
  parsePmWait,
  type PmStatusInput,
} from "./work.ts";
import { diffPmParagraphs } from "./diff.ts";

const base: PmStatusInput = {
  status: "moving",
  waits: [],
  asks: [],
  workers: [],
  touchedRecently: false,
  isAskSettled: () => false,
  isItemClosed: () => false,
};

describe("derivePmItemStatus", () => {
  it.each([
    ["dropped wins over everything", { status: "dropped", workers: ["running"] }, "dropped"],
    [
      "done wins over a holding ask",
      { status: "finished", asks: [{ state: "open", holds: true }] },
      "done",
    ],
    [
      "only a holding ask blocks",
      { asks: [{ state: "open", holds: true }], workers: ["running"] },
      "blocked",
    ],
    [
      "a non-holding ask does not block",
      { asks: [{ state: "open", holds: false }], touchedRecently: true },
      "in_progress",
    ],
    [
      "a settled holding ask does not block",
      { asks: [{ state: "answered", holds: true }] },
      "not_worked_on",
    ],
    ["a waiting worker needs the user", { workers: ["running", "waiting"] }, "needs_you"],
    ["a running worker is in progress", { workers: ["running"] }, "in_progress"],
    ["an open text wait is waiting", { waits: [{ kind: "text", text: "CI" }] }, "waiting"],
    [
      "a wait on a settled ask clears",
      { waits: [{ kind: "ask", askNo: 3 }], isAskSettled: () => true },
      "not_worked_on",
    ],
    ["a wait on an open ask holds", { waits: [{ kind: "ask", askNo: 3 }] }, "waiting"],
    [
      "a wait on a finished item clears",
      { waits: [{ kind: "item", itemNo: 2 }], isItemClosed: () => true },
      "not_worked_on",
    ],
    ["touched in the turn floor is in progress", { touchedRecently: true }, "in_progress"],
    [
      "untouched with an open ask needs the user",
      { asks: [{ state: "open", holds: false }] },
      "needs_you",
    ],
    ["untouched is not being worked on", {}, "not_worked_on"],
    ["later stays later", { status: "later" }, "later"],
    [
      "later with a running worker is in progress",
      { status: "later", workers: ["running"] },
      "in_progress",
    ],
  ] as const)("%s", (_name, overrides, expected) => {
    expect(derivePmItemStatus({ ...base, ...(overrides as Partial<PmStatusInput>) })).toBe(
      expected,
    );
  });
});

describe("tags and answers", () => {
  it("parses W and Q tags in every accepted form", () => {
    expect([parseItemTag("W4"), parseItemTag("w4"), parseItemTag("4"), parseItemTag(4)]).toEqual([
      4, 4, 4, 4,
    ]);
    expect([parseAskTag("Q12"), parseItemTag("Q4"), parseItemTag("W0"), parseItemTag("x")]).toEqual(
      [12, null, null, null],
    );
  });

  it("parses waits", () => {
    expect(parsePmWait("W3")).toEqual({ kind: "item", itemNo: 3 });
    expect(parsePmWait("q5")).toEqual({ kind: "ask", askNo: 5 });
    expect(parsePmWait("the store review")).toEqual({ kind: "text", text: "the store review" });
    expect(parsePmWait("  ")).toBeNull();
  });

  it("parses answers with a starred recommendation", () => {
    expect(parsePmAnswers("iPhone only*, Both ,")).toEqual({
      answers: ["iPhone only", "Both"],
      recommended: "iPhone only",
    });
    expect(parsePmAnswers("A,B", "B")).toEqual({ answers: ["A", "B"], recommended: "B" });
    expect(parsePmAnswers("A,B", "C")).toEqual({ answers: ["A", "B"], recommended: null });
  });

  it("formats the answer message", () => {
    expect(formatPmAnswerMessage({ itemNo: 4, askNo: 3, answer: "iPhone only" })).toBe(
      "W4 Q3: iPhone only",
    );
    expect(formatPmAnswerMessage({ itemNo: null, askNo: 3, answer: "Yes" })).toBe("Q3: Yes");
  });

  it("refuses lines that hand work to the user", () => {
    expect(handsWorkToUser("Waiting on your try of the build")).toBe(true);
    expect(handsWorkToUser("waiting for the user to confirm")).toBe(true);
    expect(handsWorkToUser("Worker is fixing the sidebar")).toBe(false);
  });
});

describe("diffPmParagraphs", () => {
  it("returns added and removed paragraphs", () => {
    expect(diffPmParagraphs("a\n\nb\n\nc", "a\n\nc\n\nd")).toEqual({
      added: ["d"],
      removed: ["b"],
    });
  });
});
