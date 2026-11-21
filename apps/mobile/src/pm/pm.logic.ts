import { pmKey } from "@t3tools/pm/client";

type ListThread = { readonly environmentId: string; readonly id: string };

/** The list without PM workers: they show inside their PM's row instead. Same array when none. */
export function pmListedThreads<T extends ListThread>(
  threads: ReadonlyArray<T>,
  workerOf: ReadonlyMap<string, string>,
): ReadonlyArray<T> {
  if (workerOf.size === 0) return threads;
  const listed = threads.filter(
    (thread) => !workerOf.has(pmKey(thread.environmentId as never, thread.id)),
  );
  return listed.length === threads.length ? threads : listed;
}

/** A PM row's worker lines: working ones first, at most `limit`, then "N more". */
export function pmWorkerPreview<T>(
  workers: ReadonlyArray<T>,
  isWorking: (worker: T) => boolean,
  limit = 2,
): { readonly shown: ReadonlyArray<T>; readonly more: number } {
  const ordered = [...workers.filter(isWorking), ...workers.filter((worker) => !isWorking(worker))];
  return { shown: ordered.slice(0, limit), more: Math.max(0, ordered.length - limit) };
}

export const PM_SHEET_TABS = ["work", "workers", "goal", "memory"] as const;
export type PmSheetTab = (typeof PM_SHEET_TABS)[number];

/** Live pages arrive as JSON strings from the WebView; only a kit submission is acted on. */
export function parsePmPageMessage(
  data: string,
): { readonly requestId: unknown; readonly answers: unknown } | null {
  try {
    const parsed = JSON.parse(data) as { type?: unknown; requestId?: unknown; answers?: unknown };
    return parsed?.type === "pm.page.submit"
      ? { requestId: parsed.requestId, answers: parsed.answers ?? null }
      : null;
  } catch {
    return null;
  }
}

/** Script the app runs in the page to settle the kit's pending submit. */
export const pmPageResultScript = (requestId: unknown, ok: boolean, error?: string) =>
  `window.postMessage(${JSON.stringify({ type: "pm.page.result", requestId, ok, error }).replaceAll("<", "\\u003c")},"*");true;`;
