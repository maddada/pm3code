import { useAtomValue } from "@effect/atom-react";
import { asPmIndex, EMPTY_PM_INDEX, type PmIndex } from "@t3tools/pm/client";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { pmListedThreads } from "./pm.logic";

/**
 * Where the thread list reads the PM index. `./state` points it at the live index when it loads;
 * this module stays light because upstream's list-hook tests load it without the connection runtime.
 */
export const pmListIndex: { atom: Atom.Atom<PmIndex> } = { atom: Atom.make(EMPTY_PM_INDEX) };

/** The thread list's threads without PM workers, which nest in their PM's row. */
export function usePmListedThreads<
  T extends { readonly environmentId: string; readonly id: string },
>(threads: ReadonlyArray<T>): ReadonlyArray<T> {
  const { workerOf } = asPmIndex(useAtomValue(pmListIndex.atom));
  return useMemo(() => pmListedThreads(threads, workerOf), [threads, workerOf]);
}
