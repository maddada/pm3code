import {
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  DEFAULT_SERVER_SETTINGS,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { idleThreadProjection, liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PmLayer from "./PmLayer.ts";
import * as PmReportWatcher from "./PmReportWatcher.ts";

export const PROJECT = ProjectId.make("project:mcp-test");

/** The orchestration a PM drives, faked: shells by id, and every command and launch sent. */
export interface PmWorld {
  readonly shells: Map<string, OrchestrationV2ThreadShell>;
  readonly runs: Map<string, ReadonlyArray<OrchestrationV2Run>>;
  readonly messages: Map<string, ReadonlyArray<OrchestrationV2ConversationMessage>>;
  readonly commands: Array<OrchestrationV2ServerCommand>;
  readonly launches: Array<ThreadLaunch.ThreadLaunchInput>;
  failLaunch: boolean;
}

export const makeWorld = (): PmWorld => ({
  shells: new Map(),
  runs: new Map(),
  messages: new Map(),
  commands: [],
  launches: [],
  failLaunch: false,
});

export const shellFor = (
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  ...liveThreadShell(ThreadId.make(id), { activeRunId: null }),
  status: "idle",
  title: id,
  ...overrides,
});

export const messagesTo = (world: PmWorld, threadId: string) =>
  world.commands.flatMap((command) =>
    command.type === "message.dispatch" && command.threadId === threadId ? [command] : [],
  );

const layerFakes = (world: PmWorld) =>
  Layer.mergeAll(
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.sync(() => world.shells.get(threadId) ?? null),
      dispatch: (command) =>
        Effect.sync(() => {
          world.commands.push(command);
          if (command.type === "thread.metadata.update" && command.title !== undefined) {
            const shell = world.shells.get(command.threadId);
            if (shell !== undefined)
              world.shells.set(command.threadId, { ...shell, title: command.title });
          }
          return { sequence: world.commands.length, storedEvents: [] };
        }),
      getThreadRecords: (threadId) =>
        Effect.sync(() => {
          const shell = world.shells.get(threadId) ?? shellFor(threadId);
          return {
            ...idleThreadProjection(shell),
            runs: world.runs.get(threadId) ?? [],
            messages: world.messages.get(threadId) ?? [],
          };
        }),
    }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (input) =>
        world.failLaunch
          ? Effect.fail(
              new ThreadLaunch.ThreadLaunchError({
                operation: "create-thread",
                commandId: input.commandId,
                projectId: input.projectId,
                cause: new Error("launch refused"),
              }),
            )
          : Effect.sync(() => {
              world.launches.push(input);
              const threadId = input.threadId ?? ThreadId.make(input.commandId);
              const shell = shellFor(threadId, {
                projectId: input.projectId,
                title: input.title,
                modelSelection: input.modelSelection,
                status: input.initialMessage === undefined ? "idle" : "running",
              });
              world.shells.set(threadId, shell);
              return { threadId, projection: idleThreadProjection(shell), resumed: false };
            }),
    }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
    }),
  );

/** PmService, its store and the fakes over the database in context, as one fresh server start. */
export const layerPm = (world: PmWorld) =>
  PmLayer.layer.pipe(Layer.provideMerge(layerFakes(world)));

export const layerPmWithWatcher = (world: PmWorld) =>
  PmReportWatcher.layer.pipe(Layer.provideMerge(layerPm(world)));

const at = (iso: string) => DateTime.makeUnsafe(iso);

export const runOf = (
  threadId: string,
  id: string,
  status: OrchestrationV2Run["status"],
  extra: Partial<OrchestrationV2Run> = {},
): OrchestrationV2Run => ({
  id: RunId.make(id),
  threadId: ThreadId.make(threadId),
  ordinal: 1,
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  providerThreadId: null,
  userMessageId: MessageId.make(`message:${id}`),
  rootNodeId: null,
  activeAttemptId: null,
  status,
  requestedAt: at("2026-01-01T00:00:00.000Z"),
  startedAt: null,
  completedAt: null,
  checkpointId: null,
  contextHandoffId: null,
  ...extra,
});

export const runUpdated = (
  run: OrchestrationV2Run,
  occurredAt: DateTime.Utc,
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event:${run.id}:${run.status}`),
  threadId: run.threadId,
  occurredAt,
  type: "run.updated",
  payload: run,
});

export const requestPending = (
  threadId: string,
  requestId: string,
  occurredAt: DateTime.Utc,
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`event:${requestId}`),
  threadId: ThreadId.make(threadId),
  occurredAt,
  type: "runtime-request.updated",
  payload: {
    id: RuntimeRequestId.make(requestId),
    nodeId: NodeId.make(`node:${requestId}`),
    providerTurnId: null,
    nativeRequestRef: null,
    kind: "user_input",
    status: "pending",
    responseCapability: { type: "message" },
    createdAt: occurredAt,
    resolvedAt: null,
  },
});

export const assistantMessage = (
  threadId: string,
  runId: string,
  text: string,
  at: DateTime.Utc,
): OrchestrationV2ConversationMessage => ({
  id: MessageId.make(`message:${runId}:assistant`),
  threadId: ThreadId.make(threadId),
  runId: RunId.make(runId),
  nodeId: null,
  role: "assistant",
  text,
  attachments: [],
  streaming: false,
  createdBy: "agent",
  creationSource: "provider",
  createdAt: at,
  updatedAt: at,
});
