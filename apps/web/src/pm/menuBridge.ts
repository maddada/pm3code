import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { pmIndexSnapshot, pmKey } from "./indexSnapshot";
import type { PmThreadMenuState } from "./threadMenu.logic";

// Upstream's thread menus call these; they load no React so those menus' tests keep running.

/** What a thread menu needs to offer PM items for this thread. */
export const pmMenuState = (
  thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly projectId: PmThreadMenuState["projectId"];
  },
  projectLabel: string | null,
): PmThreadMenuState => {
  const index = pmIndexSnapshot.current;
  return {
    environmentId: thread.environmentId,
    threadId: thread.id,
    projectId: thread.projectId,
    projectLabel,
    enabled: index.enabled.has(thread.environmentId),
    isPm: index.pms.has(pmKey(thread.environmentId, thread.id)),
  };
};

/** Handles a PM menu item; false for every other item. */
export function handlePmThreadAction(action: string | null, state: PmThreadMenuState): boolean {
  if (action !== "pm:new" && action !== "pm:edit-mission") return false;
  void import("./entryPoints").then((entryPoints) => entryPoints.runPmThreadAction(action, state));
  return true;
}
