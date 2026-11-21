import { type EnvironmentId, PM_WS_METHODS, type PmSummary } from "@t3tools/contracts";
import type { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult, Atom } from "effect/reactivity";

import { EMPTY_PM_INDEX, type PmIndex, pmIndexSnapshot, pmKey } from "./pmIndex.ts";

type ServerConfigs = ReadonlyMap<
  EnvironmentId,
  { readonly environment: { readonly capabilities: { readonly pm?: boolean } } }
>;

/** The PM subscriptions, commands and cross-environment index, on an app's connection runtime. */
export function createPmClient<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
  serverConfigsAtom: Atom.Atom<ServerConfigs>,
) {
  const summaries = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:pm:subscribe",
    tag: PM_WS_METHODS.subscribe,
    idleTtlMs: 0,
  });
  const threadDetail = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:pm:subscribe-thread",
    tag: PM_WS_METHODS.subscribeThread,
  });
  const settingsQuery = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:pm:settings",
    tag: PM_WS_METHODS.settingsGet,
    staleTimeMs: 0,
    idleTtlMs: 60_000,
  });
  const commands = {
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:create",
      tag: PM_WS_METHODS.create,
    }),
    setMission: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:set-mission",
      tag: PM_WS_METHODS.setMission,
    }),
    setInstructions: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:set-instructions",
      tag: PM_WS_METHODS.setInstructions,
    }),
    remember: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:remember",
      tag: PM_WS_METHODS.remember,
    }),
    forget: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:forget",
      tag: PM_WS_METHODS.forget,
    }),
    editMemory: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:edit-memory",
      tag: PM_WS_METHODS.editMemory,
    }),
    askAnswer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:ask-answer",
      tag: PM_WS_METHODS.askAnswer,
    }),
    askSnooze: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:ask-snooze",
      tag: PM_WS_METHODS.askSnooze,
    }),
    askWake: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:ask-wake",
      tag: PM_WS_METHODS.askWake,
    }),
    askDismiss: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:ask-dismiss",
      tag: PM_WS_METHODS.askDismiss,
    }),
    askUndoDismiss: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:ask-undo-dismiss",
      tag: PM_WS_METHODS.askUndoDismiss,
    }),
    pageGet: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:page-get",
      tag: PM_WS_METHODS.pageGet,
    }),
    pageAnswer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:page-answer",
      tag: PM_WS_METHODS.pageAnswer,
    }),
    pageMarkSeen: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:page-mark-seen",
      tag: PM_WS_METHODS.pageMarkSeen,
    }),
    settingsSet: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pm:settings-set",
      tag: PM_WS_METHODS.settingsSet,
    }),
  };

  /** Every connected environment's PMs in one index: a thread list's single read. */
  const indexAtom = Atom.make((get): PmIndex => {
    const pms = new Map<string, PmSummary & { readonly environmentId: EnvironmentId }>();
    const workerOf = new Map<string, string>();
    const enabled = new Set<EnvironmentId>();
    for (const [environmentId, config] of get(serverConfigsAtom)) {
      if (config.environment.capabilities.pm !== true) continue;
      const event = AsyncResult.getOrElse(get(summaries({ environmentId, input: {} })), () => null);
      if (event === null || !event.enabled) continue;
      enabled.add(environmentId);
      for (const pm of event.pms) {
        const key = pmKey(environmentId, pm.threadId);
        pms.set(key, { ...pm, environmentId });
        for (const worker of pm.workerThreadIds) workerOf.set(pmKey(environmentId, worker), key);
      }
    }
    const index =
      pms.size === 0 && enabled.size === 0 ? EMPTY_PM_INDEX : { pms, workerOf, enabled };
    pmIndexSnapshot.current = index;
    return index;
  }).pipe(Atom.withLabel("pm-index"));

  return { summaries, threadDetail, settingsQuery, commands, indexAtom };
}
