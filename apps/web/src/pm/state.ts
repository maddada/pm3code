import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationReadScope,
  type EnvironmentId,
  PM_WS_METHODS,
  type PmSummary,
  type PmThreadDetail,
  type ThreadId,
} from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentPresentations } from "../state/presentation";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironmentScope } from "../state/session";
import { EMPTY_PM_INDEX, type PmIndex, pmIndexSnapshot, pmKey } from "./indexSnapshot";

export { pmKey };

const pmSummaries = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "environment-data:pm:subscribe",
  tag: PM_WS_METHODS.subscribe,
  idleTtlMs: 0,
});

const pmThreadDetail = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "environment-data:pm:subscribe-thread",
  tag: PM_WS_METHODS.subscribeThread,
});

export const pmSettingsQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:pm:settings",
  tag: PM_WS_METHODS.settingsGet,
  staleTimeMs: 0,
  idleTtlMs: 60_000,
});

export const pmCommands = {
  create: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:create",
    tag: PM_WS_METHODS.create,
  }),
  setMission: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:set-mission",
    tag: PM_WS_METHODS.setMission,
  }),
  setInstructions: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:set-instructions",
    tag: PM_WS_METHODS.setInstructions,
  }),
  remember: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:remember",
    tag: PM_WS_METHODS.remember,
  }),
  forget: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:forget",
    tag: PM_WS_METHODS.forget,
  }),
  editMemory: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:edit-memory",
    tag: PM_WS_METHODS.editMemory,
  }),
  askAnswer: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:ask-answer",
    tag: PM_WS_METHODS.askAnswer,
  }),
  askSnooze: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:ask-snooze",
    tag: PM_WS_METHODS.askSnooze,
  }),
  askWake: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:ask-wake",
    tag: PM_WS_METHODS.askWake,
  }),
  askDismiss: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:ask-dismiss",
    tag: PM_WS_METHODS.askDismiss,
  }),
  askUndoDismiss: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:ask-undo-dismiss",
    tag: PM_WS_METHODS.askUndoDismiss,
  }),
  pageGet: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:page-get",
    tag: PM_WS_METHODS.pageGet,
  }),
  pageAnswer: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:page-answer",
    tag: PM_WS_METHODS.pageAnswer,
  }),
  pageMarkSeen: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:page-mark-seen",
    tag: PM_WS_METHODS.pageMarkSeen,
  }),
  settingsSet: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:pm:settings-set",
    tag: PM_WS_METHODS.settingsSet,
  }),
};

const EMPTY_INDEX = EMPTY_PM_INDEX;

/** Every connected environment's PMs in one index: the sidebar's single read. */
export const pmIndexAtom = Atom.make((get): PmIndex => {
  const pms = new Map<string, PmSummary & { readonly environmentId: EnvironmentId }>();
  const workerOf = new Map<string, string>();
  const enabled = new Set<EnvironmentId>();
  for (const [environmentId, config] of get(environmentPresentations.serverConfigsAtom)) {
    if (config.environment.capabilities.pm !== true) continue;
    const event = AsyncResult.getOrElse(get(pmSummaries({ environmentId, input: {} })), () => null);
    if (event === null || !event.enabled) continue;
    enabled.add(environmentId);
    for (const pm of event.pms) {
      const key = pmKey(environmentId, pm.threadId);
      pms.set(key, { ...pm, environmentId });
      for (const worker of pm.workerThreadIds) workerOf.set(pmKey(environmentId, worker), key);
    }
  }
  const index = pms.size === 0 && enabled.size === 0 ? EMPTY_INDEX : { pms, workerOf, enabled };
  pmIndexSnapshot.current = index;
  return index;
}).pipe(Atom.withLabel("pm-index"));

/** Upstream tests that mock `useAtomValue` hand back their own values; those read as no PMs. */
export const usePmIndex = (): PmIndex => {
  const index: unknown = useAtomValue(pmIndexAtom);
  return index !== null && typeof index === "object" && (index as PmIndex).workerOf instanceof Map
    ? (index as PmIndex)
    : EMPTY_INDEX;
};

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
