import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommand,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { msg } from "gt-react";

import { toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { buildThreadRouteParams } from "../threadRoutes";
import { pmCommands } from "./state";

type Navigate = (options: {
  readonly to: "/$environmentId/$threadId";
  readonly params: { environmentId: EnvironmentId; threadId: ThreadId };
}) => unknown;

/** Runs a PM command outside React and toasts its failure; returns the value or null. */
export async function runPmCommand<W, A, E>(
  command: AtomCommand<W, A, E>,
  value: W,
  failureTitle: string,
): Promise<A | null> {
  const result = await runAtomCommand(appAtomRegistry, command, value, { label: command.label });
  if (result._tag === "Success") return result.value;
  if (isAtomCommandInterrupted(result)) return null;
  toastManager.add({
    type: "error",
    title: failureTitle,
    description: thrownErrorMessage(squashAtomCommandFailure(result), m) ?? undefined,
  });
  return null;
}

/** New PM: no dialog. It starts on the last model picked and opens the new PM's chat. */
export async function createPmAndOpen(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly navigate: Navigate;
}): Promise<void> {
  const created = await runPmCommand(
    pmCommands.create,
    { environmentId: input.environmentId, input: { projectId: input.projectId } },
    m(msg("Could not create the project manager")),
  );
  if (created === null) return;
  await input.navigate({
    to: "/$environmentId/$threadId",
    params: buildThreadRouteParams(scopeThreadRef(input.environmentId, created.threadId)),
  });
}
