import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ServerNpmReleaseError, ServerSelfUpdateError } from "@t3tools/contracts";

import * as NpmRelease from "../cloud/npmRelease.ts";
import * as ServerSelfUpdate from "../cloud/selfUpdate.ts";
import * as ServerConfig from "../config.ts";

// npm's `t3` is upstream: installing it would replace this fork. The desktop app's own updater
// follows the fork's release feed, so desktop-managed updates still pass through.
const FORK_UPDATE_REFUSAL =
  "This is a t3code-pm fork build. It never installs upstream's npm `t3`; update it by pulling and rebuilding the fork.";

export const layerForkNpmRelease = Layer.effect(
  NpmRelease.NpmRelease,
  Effect.succeed(
    NpmRelease.NpmRelease.of({
      get: Effect.fn("PmFork.npmRelease")(function* () {
        return yield* new ServerNpmReleaseError({ reason: FORK_UPDATE_REFUSAL });
      }),
    }),
  ),
).pipe(Layer.provide(NpmRelease.layer));

export const layerForkSelfUpdate = <E, R>(
  upstream: Layer.Layer<ServerSelfUpdate.ServerSelfUpdate, E, R>,
) =>
  Layer.effect(
    ServerSelfUpdate.ServerSelfUpdate,
    Effect.gen(function* () {
      const service = yield* ServerSelfUpdate.ServerSelfUpdate;
      const config = yield* ServerConfig.ServerConfig;
      return ServerSelfUpdate.ServerSelfUpdate.of({
        ...service,
        update: Effect.fn("PmFork.selfUpdate")(
          function* (input, reportProgress, onHandoffAccepted) {
            if (config.mode !== "desktop")
              return yield* new ServerSelfUpdateError({ reason: FORK_UPDATE_REFUSAL });
            return yield* service.update(input, reportProgress, onHandoffAccepted);
          },
        ),
      });
    }),
  ).pipe(Layer.provide(upstream));
