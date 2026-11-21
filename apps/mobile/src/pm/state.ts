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
import { pmListIndex } from "./threadList";

const pmClient = createPmClient(connectionAtomRuntime, environmentPresentations.serverConfigsAtom);

export const {
  settingsQuery: pmSettingsQuery,
  commands: pmCommands,
  indexAtom: pmIndexAtom,
} = pmClient;
pmListIndex.atom = pmIndexAtom;

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

/** Full detail of one open PM, subscribed only while a PM screen shows it. */
export function usePmThreadDetail(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | string | null,
): PmThreadDetail | null {
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    environmentId === null || threadId === null || !canRead
      ? null
      : pmClient.threadDetail({ environmentId, input: { pm: threadId as ThreadId } }),
  );
  return query.data ?? null;
}
