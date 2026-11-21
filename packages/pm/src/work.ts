// Work item and ask rules shared by the server and clients, ported from Ghostex's coordinator work
// items so every surface derives the same status.

export type PmStoredItemStatus = "moving" | "later" | "finished" | "dropped";

export type PmShownItemStatus =
  | "dropped"
  | "done"
  | "blocked"
  | "needs_you"
  | "in_progress"
  | "waiting"
  | "not_worked_on"
  | "later";

/** Display order of the groups in the PM panel. */
export const PM_SHOWN_STATUS_ORDER: ReadonlyArray<PmShownItemStatus> = [
  "needs_you",
  "blocked",
  "in_progress",
  "not_worked_on",
  "waiting",
  "later",
  "done",
  "dropped",
];

export type PmAskState = "open" | "answered" | "done" | "withdrawn" | "dismissed";

export type PmWorkerState = "running" | "waiting" | "idle" | "resolved";

export type PmWaitOn =
  | { readonly kind: "item"; readonly itemNo: number }
  | { readonly kind: "ask"; readonly askNo: number }
  | { readonly kind: "text"; readonly text: string };

export interface PmStatusInput {
  readonly status: PmStoredItemStatus;
  /** Open (uncleared) waits, oldest first. */
  readonly waits: ReadonlyArray<PmWaitOn>;
  /** Asks attached to this item. */
  readonly asks: ReadonlyArray<{ readonly state: PmAskState; readonly holds: boolean }>;
  /** States of the unresolved workers linked to this item. */
  readonly workers: ReadonlyArray<PmWorkerState>;
  /** The PM touched this item in its current or previous turn. */
  readonly touchedRecently: boolean;
  /** Settled state of asks and items other waits point at. */
  readonly isAskSettled: (askNo: number) => boolean;
  readonly isItemClosed: (itemNo: number) => boolean;
}

export const isOpenWait = (
  wait: PmWaitOn,
  ctx: Pick<PmStatusInput, "isAskSettled" | "isItemClosed">,
): boolean => {
  switch (wait.kind) {
    case "ask":
      return !ctx.isAskSettled(wait.askNo);
    case "item":
      return !ctx.isItemClosed(wait.itemNo);
    case "text":
      return true;
  }
};

/** First match wins, as in Ghostex: only a holding ask blocks. */
export function derivePmItemStatus(input: PmStatusInput): PmShownItemStatus {
  if (input.status === "dropped") return "dropped";
  if (input.status === "finished") return "done";
  const openAsks = input.asks.filter((ask) => ask.state === "open");
  if (openAsks.some((ask) => ask.holds)) return "blocked";
  if (input.workers.includes("waiting")) return "needs_you";
  if (input.workers.includes("running")) return "in_progress";
  if (input.waits.some((wait) => isOpenWait(wait, input))) return "waiting";
  if (input.status === "moving") {
    if (input.touchedRecently) return "in_progress";
    return openAsks.length > 0 ? "needs_you" : "not_worked_on";
  }
  return "later";
}

export const formatItemTag = (itemNo: number) => `W${itemNo}`;
export const formatAskTag = (askNo: number) => `Q${askNo}`;

const parseTag = (prefix: "W" | "Q", value: string | number): number | null => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  const match = new RegExp(`^\\s*${prefix}?(\\d+)\\s*$`, "i").exec(value);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

/** Accepts `W4`, `w4`, `4` or 4. */
export const parseItemTag = (value: string | number) => parseTag("W", value);
/** Accepts `Q4`, `q4`, `4` or 4. */
export const parseAskTag = (value: string | number) => parseTag("Q", value);

/** Parses a wait target: `W3`, `Q5`, or free text. */
export function parsePmWait(value: string): PmWaitOn | null {
  const text = value.trim();
  if (text.length === 0) return null;
  if (/^w\d+$/i.test(text)) {
    const itemNo = parseItemTag(text);
    return itemNo === null ? null : { kind: "item", itemNo };
  }
  if (/^q\d+$/i.test(text)) {
    const askNo = parseAskTag(text);
    return askNo === null ? null : { kind: "ask", askNo };
  }
  return { kind: "text", text };
}

export interface PmParsedAnswers {
  readonly answers: ReadonlyArray<string>;
  readonly recommended: string | null;
}

/** `"A*,B"`: comma separated, `*` marks the recommended answer. */
export function parsePmAnswers(value: string, recommended?: string | null): PmParsedAnswers {
  let marked: string | null = null;
  const answers = value
    .split(",")
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      if (!raw.endsWith("*")) return raw;
      const answer = raw.slice(0, -1).trim();
      marked ??= answer;
      return answer;
    })
    .filter((answer) => answer.length > 0);
  const explicit = recommended?.trim();
  return {
    answers,
    recommended: explicit && answers.includes(explicit) ? explicit : marked,
  };
}

/** The message an answered ask sends into the PM thread: `W4 Q3: iPhone only`. */
export const formatPmAnswerMessage = (input: {
  readonly itemNo: number | null;
  readonly askNo: number;
  readonly answer: string;
}) =>
  `${input.itemNo === null ? "" : `${formatItemTag(input.itemNo)} `}${formatAskTag(input.askNo)}: ${input.answer}`;

// Ghostex refuses now/wait lines that hand work to the user; those belong in an ask.
const USER_HANDOFF =
  /\b(waiting (on|for) (you|the user|your)|your (try|test|check|review|confirmation|approval|answer|decision|go-ahead)|for (you|the user) to (try|test|check|confirm|decide|approve|review|sign in))\b/i;

export const handsWorkToUser = (line: string) => USER_HANDOFF.test(line);
