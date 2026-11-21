import type { EnvironmentId, PmSummary, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

/** Upstream's key for a thread across environments. */
export const pmKey = (environmentId: EnvironmentId, threadId: ThreadId | string) =>
  scopedThreadKey({ environmentId, threadId: threadId as ThreadId });

export interface PmIndex {
  /** PMs by thread key, only from environments that serve PMs and have them on. */
  readonly pms: ReadonlyMap<string, PmSummary & { readonly environmentId: EnvironmentId }>;
  /** Each linked worker's thread key to its PM's thread key. */
  readonly workerOf: ReadonlyMap<string, string>;
  /** Environments that serve PMs and have them turned on. */
  readonly enabled: ReadonlySet<EnvironmentId>;
}

export const EMPTY_PM_INDEX: PmIndex = { pms: new Map(), workerOf: new Map(), enabled: new Set() };

/**
 * The PM index as last computed, for menus built outside React. Kept free of React imports:
 * upstream's thread menu reads it, and that menu's tests run with React mocked.
 */
export const pmIndexSnapshot: { current: PmIndex } = { current: EMPTY_PM_INDEX };
