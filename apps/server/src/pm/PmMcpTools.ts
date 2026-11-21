import {
  ModelSelection,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  OrchestratorMcpFailure,
  ProviderInteractionMode,
  RuntimeMode,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { PmService } from "./PmService.ts";
import { hiddenUnlessPm } from "./PmVisibility.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  success: Schema.Struct({
    result: Schema.String,
    notes: Schema.optional(Schema.Array(Schema.String)),
  }),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    PmService,
  ],
};

const ItemRef = Schema.Union([Schema.String, Schema.Number]).annotate({
  description: "Work item tag, such as W3.",
});
const AskTagRef = Schema.Union([Schema.String, Schema.Number]).annotate({
  description: "Question tag, such as Q5.",
});
const pmTool = <const Name extends string, P extends Schema.Struct.Fields>(
  name: Name,
  description: string,
  parameters: P,
) =>
  Tool.make(name, { ...shared, description, parameters: Schema.Struct(parameters) }).annotate(
    McpSchema.EnabledWhen,
    hiddenUnlessPm,
  );

// No `parameters`: Tool.make's default serializes to `type: "object"`; an empty Schema.Struct
// serializes to `anyOf: [object, array]`, which MCP clients reject for the whole server.
const pmToolWithoutParameters = <const Name extends string>(name: Name, description: string) =>
  Tool.make(name, { ...shared, description }).annotate(McpSchema.EnabledWhen, hiddenUnlessPm);

const PmGuideTool = pmTool(
  "pm_guide",
  "Your playbook as a project manager, then the user's overrides. Call before your first reply and after every compaction. `changes: true` returns only what changed since your last read.",
  { changes: Schema.optional(Schema.Boolean) },
);
const PmStatusTool = pmToolWithoutParameters(
  "pm_status",
  "Your name, mission, standing instructions, memory, work items with their status, open asks, and every worker with its state and last report. Call at the start of every request.",
);
const PmSetNameTool = pmTool(
  "pm_set_name",
  "Rename yourself (2 to 5 words), once you know the brief.",
  { name: TrimmedNonEmptyString },
);
const PmSetMissionTool = pmTool(
  "pm_set_mission",
  "Set your mission in one or two sentences, once you know the brief. Later only when the user asks.",
  { mission: Schema.String },
);
const PmSetInstructionsTool = pmTool(
  "pm_set_instructions",
  "Replace your standing instructions. Only when the user asks.",
  { instructions: Schema.String },
);
const PmRememberTool = pmTool(
  "pm_remember",
  "Save a one-line memory note. Only after the user confirmed its exact wording.",
  { text: TrimmedNonEmptyString },
);
const PmForgetTool = pmTool(
  "pm_forget",
  "Remove memory note `number`; later notes move up one. Only when the user asks.",
  { number: Schema.Number },
);
const PmPlaybookOverrideTool = pmTool(
  "pm_playbook_override",
  "List or change the playbook overrides every PM follows. Change them only after the user confirmed the wording.",
  {
    op: Schema.Literals(["list", "add", "replace", "remove"]),
    text: Schema.optional(Schema.String),
    number: Schema.optional(Schema.Number),
  },
);
const PmWorkerStartTool = pmTool(
  "pm_worker_start",
  "Start a worker thread in your project with a brief that stands alone. T3 Code adds your mission, instructions and the reporting rules. Its report arrives as a message: end your turn after it starts. Omit the model to use yours.",
  {
    title: TrimmedNonEmptyString.annotate({ description: "Its task, 3 to 6 words." }),
    brief: TrimmedNonEmptyString.check(Schema.isMaxLength(120000)),
    item: Schema.optional(ItemRef),
    modelSelection: Schema.optional(ModelSelection),
    workspaceStrategy: Schema.optional(OrchestrationV2ThreadLaunchWorkspaceStrategy),
    runtimeMode: Schema.optional(RuntimeMode),
    interactionMode: Schema.optional(ProviderInteractionMode),
  },
).annotate(Tool.Destructive, true);
const PmWorkerLinkTool = pmTool(
  "pm_worker_link",
  "Adopt an existing thread in your project as your worker, after the user agreed. Its reports then come to you.",
  { thread: TrimmedNonEmptyString, item: Schema.optional(ItemRef) },
);
const PmWorkerUnlinkTool = pmTool(
  "pm_worker_unlink",
  "Return a worker to the normal thread list; it stops reporting to you.",
  { thread: TrimmedNonEmptyString },
);
const PmWorkerResolveTool = pmTool(
  "pm_worker_resolve",
  "Close a worker whose work you have taken: no more reports from it.",
  { thread: TrimmedNonEmptyString },
);
const PmItemAddTool = pmTool(
  "pm_item_add",
  "Start a work item for one line of work, named as the user would. Returns its W tag.",
  { title: TrimmedNonEmptyString, thread: Schema.optional(TrimmedNonEmptyString) },
);
const PmItemUpdateTool = pmTool(
  "pm_item_update",
  "Update a work item: `now` (replaces the last), `step` (+`chore`), `step_done`, `wait` (W<n>, Q<n> or words), `status` (done needs `done`, the line worth keeping; drop withdraws its asks; later; restore), `title`. Never hand work to the user here: that is pm_ask.",
  {
    item: ItemRef,
    title: Schema.optional(Schema.String),
    now: Schema.optional(Schema.String),
    step: Schema.optional(Schema.String),
    chore: Schema.optional(Schema.Boolean),
    step_done: Schema.optional(Schema.Number),
    wait: Schema.optional(Schema.String),
    status: Schema.optional(Schema.Literals(["done", "drop", "later", "restore"])),
    done: Schema.optional(Schema.String),
    reason: Schema.optional(Schema.String),
  },
);
const PmItemListTool = pmToolWithoutParameters(
  "pm_item_list",
  "Your work items with their status. Check it before ending each turn.",
);
const PmAskTool = pmTool(
  "pm_ask",
  'Ask the user one question; it shows above their chat box. Title names its subject (no Q tag); detail says what and why; answers like "A*,B" (* marks yours). `holds` when the work stops until they answer. End your turn after asking.',
  {
    item: Schema.optional(ItemRef),
    title: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
    answers: Schema.optional(Schema.String),
    recommended: Schema.optional(Schema.String),
    holds: Schema.optional(Schema.Boolean),
  },
);
const PmAskDoneTool = pmTool(
  "pm_ask_done",
  "Close an open question the user settled by doing it.",
  { tag: AskTagRef },
);
const PmAskWithdrawTool = pmTool(
  "pm_ask_withdraw",
  "Withdraw an open question the user settled another way.",
  { tag: AskTagRef },
);
const PmNextTagTool = pmToolWithoutParameters(
  "pm_next_tag",
  "The next free W and Q tags, after a compaction or when unsure of the count.",
);
const PmLinkAddTool = pmTool(
  "pm_link_add",
  "Link an issue, PR or page (full URL) to a work item or worker.",
  {
    url: TrimmedNonEmptyString,
    item: Schema.optional(ItemRef),
    thread: Schema.optional(TrimmedNonEmptyString),
    title: Schema.optional(Schema.String),
  },
);
const PmPageShowTool = pmTool(
  "pm_page_show",
  "Publish a Live page: self-contained HTML (inline images; no outside requests) for the user to look at and answer. Same `source_name` replaces the older page. Question tags come from pm_next_tag. Fields with a `name` and a `data-pm-send` button send the answers.",
  {
    html: Schema.String,
    title: TrimmedNonEmptyString,
    source_name: TrimmedNonEmptyString,
    item: Schema.optional(ItemRef),
    question_tags: Schema.optional(Schema.Array(Schema.String)),
  },
);
const PmPageRetireTool = pmTool(
  "pm_page_retire",
  "Retire an out-of-date Live page; its open questions are withdrawn.",
  { page: TrimmedNonEmptyString },
);

export const PmToolkit = Toolkit.make(
  PmGuideTool,
  PmStatusTool,
  PmSetNameTool,
  PmSetMissionTool,
  PmSetInstructionsTool,
  PmRememberTool,
  PmForgetTool,
  PmPlaybookOverrideTool,
  PmWorkerStartTool,
  PmWorkerLinkTool,
  PmWorkerUnlinkTool,
  PmWorkerResolveTool,
  PmItemAddTool,
  PmItemUpdateTool,
  PmItemListTool,
  PmAskTool,
  PmAskDoneTool,
  PmAskWithdrawTool,
  PmNextTagTool,
  PmLinkAddTool,
  PmPageShowTool,
  PmPageRetireTool,
);
