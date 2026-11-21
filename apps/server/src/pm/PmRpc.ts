import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { PM_WS_METHODS, PmError, PmRpcGroup, RpcScopeAuthorization } from "@t3tools/contracts";

import { RpcInstrumentation } from "../observability/RpcInstrumentation.ts";

import { PmService } from "./PmService.ts";

// The middlewares the server group runs, so these handlers spread into its `.of`.
const PmServerRpcGroup =
  PmRpcGroup.middleware(RpcScopeAuthorization).middleware(RpcInstrumentation);

const ok = <E, R>(effect: Effect.Effect<unknown, E, R>) => Effect.as(effect, {});

const missing = new PmError({
  code: "unavailable",
  message: "This server runs without Project Managers.",
});

// Servers built without the PM layer (upstream's own tests) still answer, with a refusal.
const refuse = () => Effect.fail(missing);
const refuseStream = () => Stream.fail(missing);
const unavailableHandlers = PmServerRpcGroup.of({
  [PM_WS_METHODS.subscribe]: refuseStream,
  [PM_WS_METHODS.subscribeThread]: refuseStream,
  [PM_WS_METHODS.create]: refuse,
  [PM_WS_METHODS.setMission]: refuse,
  [PM_WS_METHODS.setInstructions]: refuse,
  [PM_WS_METHODS.remember]: refuse,
  [PM_WS_METHODS.forget]: refuse,
  [PM_WS_METHODS.editMemory]: refuse,
  [PM_WS_METHODS.askAnswer]: refuse,
  [PM_WS_METHODS.askSnooze]: refuse,
  [PM_WS_METHODS.askWake]: refuse,
  [PM_WS_METHODS.askDismiss]: refuse,
  [PM_WS_METHODS.askUndoDismiss]: refuse,
  [PM_WS_METHODS.pageGet]: refuse,
  [PM_WS_METHODS.pageAnswer]: refuse,
  [PM_WS_METHODS.pageMarkSeen]: refuse,
  [PM_WS_METHODS.settingsGet]: refuse,
  [PM_WS_METHODS.settingsSet]: refuse,
});

/** Thin transport: each handler calls one PmService method. */
export const makePmRpcHandlers = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(PmService);
  if (Option.isNone(service)) return unavailableHandlers;
  const pm = service.value;
  return PmServerRpcGroup.of({
    [PM_WS_METHODS.subscribe]: ({ projectId }) => pm.subscribe(projectId),
    [PM_WS_METHODS.subscribeThread]: ({ pm: thread }) => pm.subscribeThread(thread),
    [PM_WS_METHODS.create]: ({ projectId, modelSelection }) =>
      pm.create({ projectId, modelSelection, createdBy: "user", creationSource: "web" }),
    [PM_WS_METHODS.setMission]: ({ pm: thread, mission }) =>
      ok(pm.setMission(thread, mission, "user")),
    [PM_WS_METHODS.setInstructions]: ({ pm: thread, instructions }) =>
      ok(pm.setInstructions(thread, instructions, "user")),
    [PM_WS_METHODS.remember]: ({ pm: thread, text }) =>
      Effect.map(pm.remember(thread, text, "user"), (number) => ({ number })),
    [PM_WS_METHODS.forget]: ({ pm: thread, number }) => ok(pm.forget(thread, number, "user")),
    [PM_WS_METHODS.editMemory]: ({ pm: thread, number, text }) =>
      ok(pm.editMemory(thread, number, text)),
    [PM_WS_METHODS.askAnswer]: ({ pm: thread, ask, answer }) =>
      ok(pm.answerAsk(thread, ask, answer)),
    [PM_WS_METHODS.askSnooze]: ({ pm: thread, ask, until }) => ok(pm.snoozeAsk(thread, ask, until)),
    [PM_WS_METHODS.askWake]: ({ pm: thread, ask }) => ok(pm.snoozeAsk(thread, ask, null)),
    [PM_WS_METHODS.askDismiss]: ({ pm: thread, ask }) => ok(pm.dismissAsk(thread, ask)),
    [PM_WS_METHODS.askUndoDismiss]: ({ pm: thread, ask }) => ok(pm.undoDismissAsk(thread, ask)),
    [PM_WS_METHODS.pageGet]: ({ pageId }) => pm.pageGet(pageId),
    [PM_WS_METHODS.pageAnswer]: ({ pageId, answers }) => ok(pm.pageAnswer(pageId, answers)),
    [PM_WS_METHODS.pageMarkSeen]: ({ pageId, reply }) => ok(pm.pageMarkSeen(pageId, reply)),
    [PM_WS_METHODS.settingsGet]: () => pm.getSettings,
    [PM_WS_METHODS.settingsSet]: (input) => pm.setSettings(input),
  });
});

/** The server's PmService, captured where the WebSocket route is built, for each connection. */
export const capturePmService = Effect.map(Effect.serviceOption(PmService), (service) =>
  Option.isNone(service) ? Layer.empty : Layer.succeed(PmService, service.value),
);
