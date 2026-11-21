import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Scheduler from "../scheduling/Scheduler.ts";
import * as PmReportWatcher from "./PmReportWatcher.ts";
import * as PmService from "./PmService.ts";
import * as PmStore from "./PmStore.ts";

/** PmService over its store. One value, so every use memoizes to one instance. */
export const layer = PmService.layer.pipe(Layer.provideMerge(PmStore.layer));

/** Starts the worker report watcher once the server is active. */
export const layerWatcher = Layer.effectDiscard(
  Effect.gen(function* () {
    const watcher = yield* PmReportWatcher.PmReportWatcher;
    yield* watcher.start();
  }),
).pipe(Layer.provide(PmReportWatcher.layer), Layer.provide(layer), Layer.provide(Scheduler.layer));
