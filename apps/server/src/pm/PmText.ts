import type { PmReportKind } from "@t3tools/contracts";
import { PM_PLAYBOOK } from "@t3tools/pm";

export const PM_NEW_TITLE = "New PM";

export const isoMillis = (value: string) => Date.parse(value);
const REPORT_TEXT_LIMIT = 12_000;
export const QUIET_AFTER_MS = 8 * 60_000;
export const IDLE_AFTER_MS = 10 * 60_000;
export const MEMORY_LIMIT = 60;
export const MEMORY_TEXT_LIMIT = 600;
export const PAGE_HTML_LIMIT = 2 * 1024 * 1024;
export const PAGE_ANSWERS_LIMIT = 64 * 1024;

export const PM_SETUP_MESSAGE = [
  "You are a Project Manager (PM) thread for this project in T3 Code.",
  "Call `pm_guide` now and follow it from here on.",
  "Then reply with one short line asking the user for the brief. Start no work yet.",
].join(" ");

export const QUIET_NUDGE =
  "T3: no new output from you for 8 minutes. Still working? Say what you're waiting on, or carry on.";
export const IDLE_NUDGE =
  "T3: your turn ended before your task was done. Carry on with it, and end your turn with your report.";

export const REPORT_LABELS: Record<PmReportKind, string> = {
  finished: "Finished",
  waiting: "Waiting for an answer",
  quiet: "Quiet for 8 min",
  stopped: "Stopped mid-turn",
  idle: "Idle while owing work",
  restarted: "Restarted",
};

export function composeGuide(overrides: ReadonlyArray<string>): string {
  if (overrides.length === 0) return PM_PLAYBOOK;
  return `${PM_PLAYBOOK}\n\n## The user's overrides\n\nThese apply to every project manager and outrank everything above.\n\n${overrides
    .map((rule, index) => `${index + 1}. ${rule}`)
    .join("\n")}\n`;
}

/** The footer every brief gets: the port of Ghostex's thread brief. */
export function workerBrief(input: {
  readonly brief: string;
  readonly pmTitle: string;
  readonly mission: string;
  readonly instructions: string;
}): string {
  const lines = [
    input.brief.trim(),
    "",
    "---",
    `You are a worker thread started by the T3 Code project manager "${input.pmTitle}".`,
  ];
  if (input.mission.trim().length > 0) lines.push(`Its mission: ${input.mission.trim()}`);
  if (input.instructions.trim().length > 0)
    lines.push(`Its standing instructions: ${input.instructions.trim()}`);
  lines.push(
    "",
    "How to report:",
    "- Your final message is your report: what you did, where, how you verified it, and anything left or blocked. T3 Code passes it to the project manager.",
    "- Never message the project manager's thread yourself.",
    "- When you need a decision you cannot make, ask it plainly in your final message and stop.",
    "- Do not merge, push, delete branches or run destructive commands unless this brief asks for it.",
    "- Stop every background job you no longer need before your final report.",
    "- Start your report's sections with markers: ✅ Done, 🧪 Untested, ⚠️ Read this, 🛑 Blocked, ❓ Needs you.",
    "- When you change or drive a UI, save a screenshot of every state (at least 1650x962) and link them in your report.",
  );
  return lines.join("\n");
}

export function cutReportText(text: string): string {
  if (text.length <= REPORT_TEXT_LIMIT) return text;
  return `${text.slice(0, REPORT_TEXT_LIMIT)}\n\n[Cut at 12,000 characters. Read the rest with t3_thread_read.]`;
}

export const firstLine = (text: string, limit = 160) => {
  const line =
    text
      .trim()
      .split("\n")
      .find((candidate) => candidate.trim().length > 0) ?? "";
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line.trim();
};

export function reportMessage(input: {
  readonly kind: PmReportKind;
  readonly workerTitle: string;
  readonly workerThreadId: string;
  readonly body: string;
}): string {
  return `Worker report from "${input.workerTitle}" (thread ${input.workerThreadId}): ${REPORT_LABELS[input.kind]}\n\n${input.body}`;
}

export function pageAnswersMessage(input: {
  readonly pageId: string;
  readonly title: string;
  readonly tags: ReadonlyArray<string>;
  readonly json: string;
}): string {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<pm-page-answers page="${escape(input.pageId)}" title="${escape(input.title)}" tags="${escape(
    input.tags.join(","),
  )}">${input.json}</pm-page-answers>`;
}

export function linkKind(url: string): "pr" | "issue" | "url" {
  if (/\/(pull|pulls|merge_requests|pull-requests)\/\d+/.test(url)) return "pr";
  if (/\/(issues|issue)\/\d+|\/browse\/[A-Z][A-Z0-9]+-\d+/.test(url)) return "issue";
  return "url";
}
