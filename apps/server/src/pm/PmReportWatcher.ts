import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import {
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type PmReportKind,
  RunId,
  ThreadId,
} from "@t3tools/contracts";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import { forkParked } from "../serverActivation.ts";
import { PmService } from "./PmService.ts";
import { PmStore, type PmWorkerRow } from "./PmStore.ts";
import {
  cutReportText,
  firstLine,
  IDLE_AFTER_MS,
  IDLE_NUDGE,
  isoMillis,
  QUIET_AFTER_MS,
  QUIET_NUDGE,
  REPORT_LABELS,
  reportMessage,
} from "./PmText.ts";

const RUNNING = new Set(["preparing", "queued", "starting", "running"]);
const STOPPED = new Set(["interrupted", "failed", "cancelled"]);

const ms = (value: DateTime.DateTime | null | undefined) =>
  value === null || value === undefined ? 0 : DateTime.toEpochMillis(value);

const make = Effect.gen(function* () {
  const pm = yield* PmService;
  const store = yield* PmStore;
  const threads = yield* ThreadManagement.ThreadManagementService;
  // One lane: events, sweeps and reconciles never race on the same worker's watch state.
  const lane = yield* Semaphore.make(1);

  const shellOf = (threadId: string) =>
    threads.getThreadShell(ThreadId.make(threadId)).pipe(Effect.orElseSucceed(() => null));

  /** The worker and its PM, when reports should flow: linked, unresolved, PM live, switch on. */
  const watched = Effect.fn("PmReportWatcher.watched")(function* (workerThreadId: string) {
    if (!(yield* pm.isEnabled)) return null;
    const worker = yield* store.getWorker(workerThreadId).pipe(Effect.orElseSucceed(() => null));
    if (worker === null || worker.resolvedAt !== null) return null;
    const pmShell = yield* shellOf(worker.pmThreadId);
    if (pmShell === null || pmShell.archivedAt !== null) return null;
    return worker;
  });

  const report = Effect.fn("PmReportWatcher.report")(function* (input: {
    readonly worker: PmWorkerRow;
    readonly shell: OrchestrationV2ThreadShell;
    readonly kind: PmReportKind;
    readonly dedupeKey: string;
    readonly body: string;
    readonly line: string;
  }) {
    const title = input.shell.title;
    return yield* pm
      .deliverReport({
        pmThreadId: input.worker.pmThreadId,
        workerThreadId: input.worker.workerThreadId,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        line: input.line,
        summary: `Report from ${title}: ${REPORT_LABELS[input.kind]}`,
        text: reportMessage({
          kind: input.kind,
          workerTitle: title,
          workerThreadId: input.worker.workerThreadId,
          body: input.body,
        }),
      })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("PM report delivery failed", { kind: input.kind, error }).pipe(
            Effect.as(false),
          ),
        ),
      );
  });

  /** The run's last assistant message; the shell's latest message can still be the brief. */
  const finalText = Effect.fn("PmReportWatcher.finalText")(function* (
    shell: OrchestrationV2ThreadShell,
    runId: string,
  ) {
    const records = yield* threads
      .getThreadRecords(shell.id, ["messages"], {
        messageRoles: ["assistant"],
        messageRunIds: [RunId.make(runId)],
      })
      .pipe(Effect.orElseSucceed(() => null));
    const last = records?.messages.filter((message) => message.role === "assistant").at(-1);
    if (last !== undefined) return last.text;
    return shell.latestVisibleMessage?.role === "assistant" ? shell.latestVisibleMessage.text : "";
  });

  const finished = Effect.fn("PmReportWatcher.finished")(function* (
    worker: PmWorkerRow,
    shell: OrchestrationV2ThreadShell,
    runId: string,
  ) {
    const message = yield* finalText(shell, runId);
    return yield* report({
      worker,
      shell,
      kind: "finished",
      dedupeKey: `run:${runId}`,
      body:
        message.trim().length === 0
          ? "It finished its turn without a final message. Read it with t3_thread_read."
          : `Its final message:\n\n${cutReportText(message)}`,
      line: `Finished: ${firstLine(message) || "no final message"}`,
    });
  });

  const stopped = (worker: PmWorkerRow, shell: OrchestrationV2ThreadShell, runId: string) =>
    report({
      worker,
      shell,
      kind: "stopped",
      dedupeKey: `run:${runId}`,
      body: `Its turn stopped before it ended (${shell.status}${shell.lastError ? `: ${shell.lastError}` : ""}). It is not finished: read it with t3_thread_read and heal it.`,
      line: `Stopped mid-turn (${shell.status})`,
    });

  const waiting = (worker: PmWorkerRow, shell: OrchestrationV2ThreadShell) => {
    const request = shell.pendingRuntimeRequest;
    if (request === null) return Effect.succeed(false);
    return report({
      worker,
      shell,
      kind: "waiting",
      dedupeKey: `request:${request.id}`,
      body: `It waits for an answer (${request.kind}${request.userOnly ? ", only the user can answer it" : ""}). Read it with t3_thread_read: answer a settled question yourself, bring the rest to the user. Never approve for the user.`,
      line: `Waiting for an answer (${request.kind})`,
    });
  };

  const restarted = (worker: PmWorkerRow, shell: OrchestrationV2ThreadShell, sourceRunId: string) =>
    report({
      worker,
      shell,
      kind: "restarted",
      dedupeKey: `restart:${sourceRunId}`,
      body: "The server restarted while it ran, and T3 Code told it to carry on. Do nothing unless a later report says it failed.",
      line: "Restarted and carrying on",
    });

  const linkedBefore = (worker: PmWorkerRow, at: DateTime.DateTime | null | undefined) =>
    ms(at) >= isoMillis(worker.linkedAt);

  const handle = Effect.fn("PmReportWatcher.handle")(function* (event: OrchestrationV2DomainEvent) {
    switch (event.type) {
      case "run.updated": {
        const run = event.payload;
        if (run.status === "starting" || run.status === "running") {
          const pmRow = yield* store.getPm(run.threadId).pipe(Effect.orElseSucceed(() => null));
          if (pmRow !== null)
            yield* pm
              .notePmRun(run.threadId, run.id, DateTime.formatIso(event.occurredAt))
              .pipe(Effect.ignore);
        }
        const worker = yield* watched(run.threadId);
        if (worker === null) return;
        const shell = yield* shellOf(worker.workerThreadId);
        if (shell === null) return;
        if (run.restartContinuationOfRunId !== undefined && RUNNING.has(run.status))
          yield* restarted(worker, shell, run.restartContinuationOfRunId);
        if (run.status === "completed") yield* finished(worker, shell, run.id);
        else if (STOPPED.has(run.status) && run.restartContinuationOfRunId === undefined)
          yield* stopped(worker, { ...shell, status: run.status }, run.id);
        return;
      }
      case "runtime-request.updated": {
        if (event.payload.status !== "pending") return;
        const worker = yield* watched(event.threadId);
        if (worker === null) return;
        const shell = yield* shellOf(worker.workerThreadId);
        if (shell !== null) yield* waiting(worker, shell);
        return;
      }
      case "thread.deleted":
        yield* pm.forgetThread(event.threadId).pipe(Effect.ignore);
        return;
      case "thread.archived": {
        const worker = yield* store
          .getWorker(event.threadId)
          .pipe(Effect.orElseSucceed(() => null));
        if (worker !== null) yield* pm.forgetThread(event.threadId).pipe(Effect.ignore);
        else yield* pm.changed(event.threadId);
        return;
      }
      case "thread.unarchived":
        if ((yield* store.getPm(event.threadId).pipe(Effect.orElseSucceed(() => null))) !== null)
          yield* reconcile;
        return;
      default:
        return;
    }
  });

  /** Brings every watched worker up to date from its thread, after a restart or a re-arm. */
  const reconcile = Effect.gen(function* () {
    if (!(yield* pm.isEnabled)) return;
    for (const pending of yield* store
      .listUndeliveredReports()
      .pipe(Effect.orElseSucceed(() => [])))
      yield* pm.redeliver(pending).pipe(Effect.ignore);
    const workers = yield* store.listWorkers().pipe(Effect.orElseSucceed(() => []));
    for (const candidate of workers) {
      const worker = yield* watched(candidate.workerThreadId);
      if (worker === null) continue;
      const shell = yield* shellOf(worker.workerThreadId);
      if (shell === null) {
        yield* pm.forgetThread(worker.workerThreadId).pipe(Effect.ignore);
        continue;
      }
      if (shell.pendingRuntimeRequest !== null) {
        yield* waiting(worker, shell);
        continue;
      }
      const runId = shell.latestRunId;
      if (runId === null) continue;
      const records = yield* threads
        .getThreadRecords(ThreadId.make(worker.workerThreadId), ["runs"], {
          runIds: [RunId.make(runId)],
        })
        .pipe(Effect.orElseSucceed(() => null));
      const run = records?.runs.find((candidateRun) => candidateRun.id === runId);
      if (run?.restartContinuationOfRunId !== undefined && linkedBefore(worker, run.requestedAt))
        yield* restarted(worker, shell, run.restartContinuationOfRunId);
      if (!linkedBefore(worker, shell.latestRunCompletedAt)) continue;
      if (shell.status === "completed") yield* finished(worker, shell, runId);
      else if (STOPPED.has(shell.status)) yield* stopped(worker, shell, runId);
    }
  }).pipe(Effect.withSpan("PmReportWatcher.reconcile"));

  /** Time-based reports: quiet while running, and idle while owing work. */
  const sweep = Effect.gen(function* () {
    if (!(yield* pm.isEnabled)) return;
    const workers = (yield* store.listWorkers().pipe(Effect.orElseSucceed(() => []))).filter(
      (worker) => worker.resolvedAt === null,
    );
    if (workers.length === 0) return;
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    for (const candidate of workers) {
      const worker = yield* watched(candidate.workerThreadId);
      if (worker === null) continue;
      const shell = yield* shellOf(worker.workerThreadId);
      if (shell === null) continue;
      if (RUNNING.has(shell.status) && shell.activeRunId !== null) {
        const runId = shell.activeRunId;
        const lastActivity = Math.max(
          ms(shell.updatedAt),
          ms(shell.latestVisibleMessage?.updatedAt),
          ms(shell.activityRunStartedAt),
        );
        const round = Math.floor((now - lastActivity) / QUIET_AFTER_MS);
        if (round < 1) continue;
        const streak = `${runId}@${lastActivity}`;
        const watch = worker.watch;
        if (watch.quietRunId === streak && (watch.quietRound ?? 0) >= round) continue;
        const nudge = watch.nudgedRunId !== runId;
        if (nudge)
          yield* pm
            .nudgeWorker(worker.workerThreadId, `quiet-nudge:${runId}`, QUIET_NUDGE)
            .pipe(Effect.ignore);
        yield* store
          .updateWatch(worker.workerThreadId, {
            ...watch,
            quietRunId: streak,
            quietRound: round,
            nudgedRunId: runId,
          })
          .pipe(Effect.ignore);
        yield* report({
          worker,
          shell,
          kind: "quiet",
          dedupeKey: `quiet:${streak}:${round}`,
          body:
            round === 1 || nudge
              ? "No new output for 8 minutes while its turn runs. T3 Code nudged it once. Read it with t3_thread_read: a build whose output still comes is not stuck."
              : `Still no new output (${round * 8} minutes). Not nudged again: heal it if it hung.`,
          line: `Quiet for ${round * 8} min`,
        });
        continue;
      }
      const owed = worker.lastReportKind === "stopped" || worker.lastReportKind === "restarted";
      if (!owed || worker.lastReportAt === null) continue;
      if (now - isoMillis(worker.lastReportAt) < IDLE_AFTER_MS) continue;
      if (worker.watch.idleNudgedFor === worker.lastReportAt) continue;
      if (worker.itemNo !== null) {
        const item = yield* store
          .getItem(worker.pmThreadId, worker.itemNo)
          .pipe(Effect.orElseSucceed(() => null));
        if (item !== null && (item.status === "finished" || item.status === "dropped")) continue;
      }
      yield* store
        .updateWatch(worker.workerThreadId, { ...worker.watch, idleNudgedFor: worker.lastReportAt })
        .pipe(Effect.ignore);
      yield* pm
        .nudgeWorker(worker.workerThreadId, `idle-nudge:${worker.lastReportAt}`, IDLE_NUDGE)
        .pipe(Effect.ignore);
      yield* report({
        worker,
        shell,
        kind: "idle",
        dedupeKey: `idle:${worker.lastReportAt}`,
        body: `It has been idle for 10 minutes since its last report (${worker.lastReportKind}) and its work is not done. T3 Code sent it "carry on".`,
        line: "Idle while owing work",
      });
    }
  }).pipe(Effect.withSpan("PmReportWatcher.sweep"));

  const inLane = <A, E, R>(effect: Effect.Effect<A, E, R>) => lane.withPermits(1)(effect);

  const start = Effect.fn("PmReportWatcher.start")(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const scheduler = yield* Scheduler.Scheduler;
    yield* forkParked(
      inLane(reconcile).pipe(
        Effect.andThen(
          Stream.runForEach(engine.streamDomainEvents, (event) =>
            inLane(handle(event)).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("PM report watcher failed on an event", {
                  threadId: event.threadId,
                  cause,
                }),
              ),
            ),
          ),
        ),
        Effect.catchCause((cause) => Effect.logWarning("PM report watcher stopped", { cause })),
      ),
    );
    // Turning the switch back on re-arms the watcher from stored state.
    yield* forkParked(
      Stream.runForEach(pm.changes.pipe(Stream.filter((id) => id === "*")), () =>
        inLane(reconcile),
      ),
    );
    yield* scheduler.register("pm-report-watcher", inLane(sweep));
  });

  return {
    handle: (event: OrchestrationV2DomainEvent) => inLane(handle(event)),
    reconcile: inLane(reconcile),
    sweep: inLane(sweep),
    start,
  };
});

export class PmReportWatcher extends Context.Service<
  PmReportWatcher,
  Effect.Success<typeof make>
>()("t3/pm/PmReportWatcher") {}

export const layer = Layer.effect(PmReportWatcher, make);
