import { OrchestratorMcpFailure, type PmError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { PmToolkit } from "./PmMcpTools.ts";
import { PmService } from "./PmService.ts";

const toFailure = (error: PmError) =>
  new OrchestratorMcpFailure({
    code:
      error.code === "disabled"
        ? "capability_denied"
        : error.code === "unavailable"
          ? "orchestration_error"
          : "invalid_request",
    message: error.message,
  });

/** Every `pm_*` tool acts for the calling thread, which must be a PM. */
const asPm = Effect.fn("PmMcp.asPm")(function* <A>(
  run: (service: PmService["Service"], pm: string) => Effect.Effect<A, PmError>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const caller = yield* McpInvocationContext.requireThreadScope(scope, "This tool");
  const service = yield* PmService;
  return yield* run(service, caller.thread.threadId).pipe(Effect.mapError(toFailure));
});

export const layer = McpToolAccess.toLayer(PmToolkit, {
  pm_guide: McpToolAccess.reads(({ changes }) =>
    asPm((service, pm) => service.guide(pm, changes === true)),
  ),
  pm_status: McpToolAccess.reads(() => asPm((service, pm) => service.status(pm))),
  pm_set_name: McpToolAccess.writesWithCapability(({ name }) =>
    asPm((service, pm) => service.setName(pm, name)),
  ),
  pm_set_mission: McpToolAccess.writesWithCapability(({ mission }) =>
    asPm((service, pm) => service.toolResult(pm, () => service.setMission(pm, mission, "pm"))),
  ),
  pm_set_instructions: McpToolAccess.writesWithCapability(({ instructions }) =>
    asPm((service, pm) =>
      service.toolResult(pm, () => service.setInstructions(pm, instructions, "pm")),
    ),
  ),
  pm_remember: McpToolAccess.writesWithCapability(({ text: note }) =>
    asPm((service, pm) =>
      service.toolResult(pm, () =>
        service
          .remember(pm, note, "pm")
          .pipe(Effect.map((number) => `Saved as memory note ${number}.`)),
      ),
    ),
  ),
  pm_forget: McpToolAccess.writesWithCapability(({ number }) =>
    asPm((service, pm) => service.toolResult(pm, () => service.forget(pm, number, "pm"))),
  ),
  pm_playbook_override: McpToolAccess.writesWithCapability((input) =>
    asPm((service, pm) => service.playbookOverride(pm, input)),
  ),
  pm_worker_start: McpToolAccess.startsThreads(
    (input) => input,
    (input, { runtimeMode, interactionMode, linkOrigin }) =>
      asPm((service, pm) =>
        service.startWorker(pm, {
          title: input.title,
          brief: input.brief,
          item: input.item,
          modelSelection: input.modelSelection,
          workspaceStrategy: input.workspaceStrategy,
          runtimeMode,
          interactionMode,
          linkOrigin,
        }),
      ),
    "stamped",
  ),
  pm_worker_link: McpToolAccess.writesWithCapability(({ thread, item }) =>
    asPm((service, pm) => service.linkWorker(pm, { thread, item })),
  ),
  pm_worker_unlink: McpToolAccess.writesWithCapability(({ thread }) =>
    asPm((service, pm) => service.unlinkWorker(pm, thread)),
  ),
  pm_worker_resolve: McpToolAccess.writesWithCapability(({ thread }) =>
    asPm((service, pm) => service.resolveWorker(pm, thread)),
  ),
  pm_item_add: McpToolAccess.writesWithCapability(({ title, thread }) =>
    asPm((service, pm) => service.itemAdd(pm, { title, thread })),
  ),
  pm_item_update: McpToolAccess.writesWithCapability(({ step_done, ...input }) =>
    asPm((service, pm) => service.itemUpdate(pm, { ...input, stepDone: step_done })),
  ),
  pm_item_list: McpToolAccess.reads(() => asPm((service, pm) => service.itemList(pm))),
  pm_ask: McpToolAccess.writesWithCapability((input) =>
    asPm((service, pm) => service.ask(pm, input)),
  ),
  pm_ask_done: McpToolAccess.writesWithCapability(({ tag }) =>
    asPm((service, pm) => service.askDone(pm, tag)),
  ),
  pm_ask_withdraw: McpToolAccess.writesWithCapability(({ tag }) =>
    asPm((service, pm) => service.askWithdraw(pm, tag)),
  ),
  pm_next_tag: McpToolAccess.reads(() => asPm((service, pm) => service.nextTag(pm))),
  pm_link_add: McpToolAccess.writesWithCapability((input) =>
    asPm((service, pm) => service.linkAdd(pm, input)),
  ),
  pm_page_show: McpToolAccess.writesWithCapability(({ source_name, question_tags, ...input }) =>
    asPm((service, pm) =>
      service.pageShow(pm, { ...input, sourceName: source_name, questionTags: question_tags }),
    ),
  ),
  pm_page_retire: McpToolAccess.writesWithCapability(({ page }) =>
    asPm((service, pm) => service.pageRetire(pm, page)),
  ),
});
