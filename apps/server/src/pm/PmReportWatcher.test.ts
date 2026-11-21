import { assert, describe, expect, it } from "@effect/vitest";
import { MessageId, RunId, RuntimeRequestId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import {
  assistantMessage,
  layerPmWithWatcher,
  makeWorld,
  messagesTo,
  PROJECT,
  requestPending,
  runOf,
  runUpdated,
  type PmWorld,
} from "./Pm.testkit.ts";
import { PmReportWatcher } from "./PmReportWatcher.ts";
import { PmService } from "./PmService.ts";
import { PmStore } from "./PmStore.ts";
import { IDLE_NUDGE, QUIET_NUDGE } from "./PmText.ts";

/** One server lifetime over the shared database; call it again to restart. */
const serverStart = <A, E, R>(world: PmWorld, effect: Effect.Effect<A, E, R>) =>
  Effect.provide(effect, layerPmWithWatcher(world));

const setup = (world: PmWorld) =>
  Effect.gen(function* () {
    const service = yield* PmService;
    const { threadId: pm } = yield* service.create({
      projectId: PROJECT,
      createdBy: "user",
      creationSource: "web",
    });
    yield* service.itemAdd(pm, { title: "Pairing" });
    yield* service.startWorker(pm, {
      title: "Fix pairing",
      brief: "Fix it.",
      item: "W1",
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    const store = yield* PmStore;
    const worker = (yield* store.listWorkers(pm))[0]!.workerThreadId;
    world.commands.length = 0;
    return { pm, worker };
  });

const finishWorker = (world: PmWorld, worker: string, runId: string, text: string) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const shell = world.shells.get(worker)!;
    world.shells.set(worker, {
      ...shell,
      status: "completed",
      activeRunId: null,
      latestRunId: RunId.make(runId),
      latestRunCompletedAt: now,
      latestVisibleMessage: {
        id: MessageId.make(`message:${runId}`),
        role: "assistant",
        text,
        updatedAt: now,
      },
    });
    return runUpdated(runOf(worker, runId, "completed", { completedAt: now }), now);
  });

const reportsTo = (world: PmWorld, pm: string) =>
  messagesTo(world, pm).filter((message) =>
    message.notification?.summary.startsWith("Report from"),
  );

const harness = SqlitePersistence.layerMemory;

describe("PmReportWatcher", () => {
  it.effect("reports a finished worker once, and not again on a repeat event or a restart", () => {
    const world = makeWorld();
    return Effect.gen(function* () {
      const { pm, worker } = yield* serverStart(
        world,
        Effect.gen(function* () {
          const ids = yield* setup(world);
          const watcher = yield* PmReportWatcher;
          const event = yield* finishWorker(
            world,
            ids.worker,
            "run-1",
            "All done.\n\nDetails here.",
          );
          yield* watcher.handle(event);
          yield* watcher.handle(event);
          return ids;
        }),
      );
      const sent = reportsTo(world, pm);
      assert.lengthOf(sent, 1);
      expect(sent[0]).toMatchObject({
        senderThreadId: worker,
        createdBy: "agent",
        dispatchMode: { type: "queue_after_active" },
        notification: { source: { kind: "system" }, summary: "Report from Fix pairing: Finished" },
      });
      expect(sent[0]!.text).toContain("Its final message:\n\nAll done.");
      yield* serverStart(
        world,
        Effect.flatMap(PmReportWatcher, (watcher) => watcher.reconcile),
      );
      assert.lengthOf(reportsTo(world, pm), 1);
      const detail = yield* serverStart(
        world,
        Effect.flatMap(PmService, (service) => service.detail(pm)),
      );
      expect(detail?.workers[0]).toMatchObject({
        lastReportKind: "finished",
        lastReportLine: "Finished: All done.",
      });
    }).pipe(Effect.provide(harness));
  });

  it.effect(
    "the report carries the run's own final message even when the shell still shows the brief",
    () => {
      const world = makeWorld();
      return Effect.gen(function* () {
        const { pm, worker } = yield* setup(world);
        const event = yield* finishWorker(world, worker, "run-1", "");
        const shell = world.shells.get(worker)!;
        world.shells.set(worker, {
          ...shell,
          latestVisibleMessage: { ...shell.latestVisibleMessage!, role: "user", text: "The brief" },
        });
        world.messages.set(worker, [
          assistantMessage(worker, "run-1", "Drafted the notes.", event.occurredAt),
        ]);
        yield* Effect.flatMap(PmReportWatcher, (watcher) => watcher.handle(event));
        expect(reportsTo(world, pm)[0]!.text).toContain("Its final message:\n\nDrafted the notes.");
      }).pipe(Effect.provide(layerPmWithWatcher(world).pipe(Layer.provideMerge(harness))));
    },
  );

  it.effect("a worker that finished while the server was down is reported once at startup", () => {
    const world = makeWorld();
    return Effect.gen(function* () {
      const { pm, worker } = yield* serverStart(world, setup(world));
      yield* finishWorker(world, worker, "run-1", "Done while you were away.");
      yield* serverStart(
        world,
        Effect.flatMap(PmReportWatcher, (watcher) => watcher.reconcile),
      );
      yield* serverStart(
        world,
        Effect.flatMap(PmReportWatcher, (watcher) => watcher.reconcile),
      );
      assert.lengthOf(reportsTo(world, pm), 1);
    }).pipe(Effect.provide(harness));
  });

  it.effect(
    "a report claimed but not delivered before a crash is delivered once on restart",
    () => {
      const world = makeWorld();
      return Effect.gen(function* () {
        const { pm, worker } = yield* serverStart(
          world,
          Effect.gen(function* () {
            const ids = yield* setup(world);
            const store = yield* PmStore;
            yield* store.claimReport({
              reportId: "report:crash",
              pmThreadId: ids.pm,
              workerThreadId: ids.worker,
              kind: "finished",
              dedupeKey: "run:crash",
              messageId: "message:pm:report:crash",
              line: "Finished: before the crash",
              text: "Worker report: Finished",
              summary: "Report from Fix pairing: Finished",
              createdAt: "1970-01-01T00:00:00.000Z",
            });
            return ids;
          }),
        );
        yield* serverStart(
          world,
          Effect.flatMap(PmReportWatcher, (watcher) => watcher.reconcile),
        );
        yield* serverStart(
          world,
          Effect.flatMap(PmReportWatcher, (watcher) => watcher.reconcile),
        );
        const sent = reportsTo(world, pm);
        assert.lengthOf(sent, 1);
        expect(sent[0]).toMatchObject({ senderThreadId: worker, text: "Worker report: Finished" });
      }).pipe(Effect.provide(harness));
    },
  );

  it.effect("waiting for an answer is reported once per request", () => {
    const world = makeWorld();
    return Effect.gen(function* () {
      const { pm, worker } = yield* setup(world);
      const now = yield* DateTime.now;
      const shell = world.shells.get(worker)!;
      world.shells.set(worker, {
        ...shell,
        status: "waiting",
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("request-1"),
          kind: "user_input",
          createdAt: now,
        },
      });
      const watcher = yield* PmReportWatcher;
      yield* watcher.handle(requestPending(worker, "request-1", now));
      yield* watcher.handle(requestPending(worker, "request-1", now));
      yield* watcher.reconcile;
      const sent = reportsTo(world, pm);
      assert.lengthOf(sent, 1);
      expect(sent[0]!.notification?.summary).toBe("Report from Fix pairing: Waiting for an answer");
    }).pipe(Effect.provide(layerPmWithWatcher(world).pipe(Layer.provideMerge(harness))));
  });

  it.effect(
    "quiet for 8 minutes: one nudge, then a report every 8 minutes without nudging again",
    () => {
      const world = makeWorld();
      return Effect.gen(function* () {
        const { pm, worker } = yield* setup(world);
        const now = yield* DateTime.now;
        const shell = world.shells.get(worker)!;
        world.shells.set(worker, {
          ...shell,
          status: "running",
          activeRunId: RunId.make("run-1"),
          updatedAt: now,
          activityRunStartedAt: now,
        });
        const watcher = yield* PmReportWatcher;
        yield* TestClock.adjust("7 minutes");
        yield* watcher.sweep;
        assert.lengthOf(reportsTo(world, pm), 0);
        yield* TestClock.adjust("1 minute");
        yield* watcher.sweep;
        yield* watcher.sweep;
        assert.deepStrictEqual(
          messagesTo(world, worker).map((message) => message.text),
          [QUIET_NUDGE],
        );
        assert.lengthOf(reportsTo(world, pm), 1);
        yield* TestClock.adjust("8 minutes");
        yield* watcher.sweep;
        const sent = reportsTo(world, pm);
        assert.lengthOf(sent, 2);
        expect(sent[1]!.text).toContain("Still no new output (16 minutes). Not nudged again");
        assert.lengthOf(messagesTo(world, worker), 1);
      }).pipe(Effect.provide(layerPmWithWatcher(world).pipe(Layer.provideMerge(harness))));
    },
  );

  it.effect(
    "stopped mid-turn is reported at once, then idle while owing work after 10 minutes",
    () => {
      const world = makeWorld();
      return Effect.gen(function* () {
        const { pm, worker } = yield* setup(world);
        const now = yield* DateTime.now;
        const shell = world.shells.get(worker)!;
        world.shells.set(worker, {
          ...shell,
          status: "failed",
          activeRunId: null,
          lastError: "Provider crashed",
        });
        const watcher = yield* PmReportWatcher;
        yield* watcher.handle(
          runUpdated(runOf(worker, "run-1", "failed", { completedAt: now }), now),
        );
        let sent = reportsTo(world, pm);
        assert.lengthOf(sent, 1);
        expect(sent[0]!.text).toContain(
          "Its turn stopped before it ended (failed: Provider crashed)",
        );
        yield* TestClock.adjust("9 minutes");
        yield* watcher.sweep;
        assert.lengthOf(reportsTo(world, pm), 1);
        yield* TestClock.adjust("1 minute");
        yield* watcher.sweep;
        yield* watcher.sweep;
        sent = reportsTo(world, pm);
        assert.lengthOf(sent, 2);
        expect(sent[1]!.notification?.summary).toBe(
          "Report from Fix pairing: Idle while owing work",
        );
        assert.deepStrictEqual(
          messagesTo(world, worker).map((message) => message.text),
          [IDLE_NUDGE],
        );
      }).pipe(Effect.provide(layerPmWithWatcher(world).pipe(Layer.provideMerge(harness))));
    },
  );

  it.effect("a restart continuation is reported once as Restarted, not as Stopped", () => {
    const world = makeWorld();
    return Effect.gen(function* () {
      const { pm, worker } = yield* setup(world);
      const now = yield* DateTime.now;
      const watcher = yield* PmReportWatcher;
      const continuation = runOf(worker, "run-2", "running", {
        restartContinuationOfRunId: RunId.make("run-1"),
      });
      yield* watcher.handle(runUpdated(continuation, now));
      yield* watcher.handle(runUpdated(continuation, now));
      const sent = reportsTo(world, pm);
      assert.lengthOf(sent, 1);
      expect(sent[0]!.notification?.summary).toBe("Report from Fix pairing: Restarted");
    }).pipe(Effect.provide(layerPmWithWatcher(world).pipe(Layer.provideMerge(harness))));
  });

  it.effect(
    "skips archived PMs, resolved workers and everything while off; re-arms when turned on",
    () => {
      const world = makeWorld();
      return Effect.gen(function* () {
        const { pm, worker } = yield* setup(world);
        const service = yield* PmService;
        const watcher = yield* PmReportWatcher;
        const event = yield* finishWorker(world, worker, "run-1", "Done.");

        const pmShell = world.shells.get(pm)!;
        world.shells.set(pm, { ...pmShell, archivedAt: yield* DateTime.now });
        yield* watcher.handle(event);
        assert.lengthOf(reportsTo(world, pm), 0);
        world.shells.set(pm, pmShell);

        yield* service.setSettings({ enabled: false });
        yield* watcher.handle(event);
        yield* watcher.reconcile;
        yield* watcher.sweep;
        assert.lengthOf(world.commands, 0);

        yield* service.setSettings({ enabled: true });
        yield* watcher.reconcile;
        assert.lengthOf(reportsTo(world, pm), 1);

        yield* service.resolveWorker(pm, worker);
        const second = yield* finishWorker(world, worker, "run-2", "Again.");
        yield* watcher.handle(second);
        assert.lengthOf(reportsTo(world, pm), 1);
      }).pipe(Effect.provide(layerPmWithWatcher(world).pipe(Layer.provideMerge(harness))));
    },
  );
});
