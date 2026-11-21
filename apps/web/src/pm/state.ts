import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type PmThreadDetail,
  type ThreadId,
} from "@t3tools/contracts";
import { asPmIndex, createPmClient, type PmIndex, pmKey } from "@t3tools/pm/client";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentPresentations } from "../state/presentation";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironmentScope } from "../state/session";

export { pmKey };

const pmClient = createPmClient(connectionAtomRuntime, environmentPresentations.serverConfigsAtom);

export const {
  settingsQuery: pmSettingsQuery,
  commands: pmCommands,
  indexAtom: pmIndexAtom,
} = pmClient;
const pmThreadDetail = pmClient.threadDetail;

/** Upstream tests that mock `useAtomValue` hand back their own values; those read as no PMs. */
export const usePmIndex = (): PmIndex => asPmIndex(useAtomValue(pmIndexAtom));

export function usePmSummary(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | string | null,
) {
  const index = usePmIndex();
  if (environmentId === null || threadId === null) return null;
  return index.pms.get(pmKey(environmentId, threadId)) ?? null;
}

/** Full detail of one open PM, subscribed only while a PM view shows it. */
export function usePmThreadDetail(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | string | null,
  enabled = true,
): PmThreadDetail | null {
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    environmentId === null || threadId === null || !enabled || !canRead
      ? null
      : pmThreadDetail({ environmentId, input: { pm: threadId as ThreadId } }),
  );
  return query.data ?? null;
}
