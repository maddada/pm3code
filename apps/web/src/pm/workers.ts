import { pmWorkerListKeys, withPmWorkers } from "./pm.logic";
import { usePmIndex } from "./state";

/** Hides every PM worker from the thread lists, as upstream hides delegated children. */
export function usePmWorkersUnderParent(
  shownUnderParent: ReadonlySet<string>,
): ReadonlySet<string> {
  return withPmWorkers(shownUnderParent, pmWorkerListKeys(usePmIndex().pms.values()));
}
