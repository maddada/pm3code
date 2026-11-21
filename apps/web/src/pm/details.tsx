import type { EnvironmentId, PmItem, PmThreadDetail, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { ThreadDetailsSection } from "../components/chat/ThreadDetailsSection";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { useThreadShells } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { runPmCommand } from "./actions";
import { savePmMission } from "./mission";
import { pmItemGroups } from "./pm.logic";
import { pmCommands, pmKey, usePmSummary, usePmThreadDetail } from "./state";
import { openPmPage, usePmFold } from "./uiState";

type ThreadRef = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/** The thread's PM summary, or null for an ordinary thread or with PMs off. */
export const usePmThread = (ref: ThreadRef) => usePmSummary(ref.environmentId, ref.threadId);

/** A PM has no branch of its own, so its git sections give way to the PM's. */
export const pmHiddenSections = (pm: unknown) =>
  pm ? ({ branch: false, pullRequests: false, git: false, repositories: false } as const) : {};

/** The PM's own sections at the top of the details panel. */
export function PmDetailsSections(props: { readonly threadRef: ThreadRef }) {
  const summary = usePmThread(props.threadRef);
  const detail = usePmThreadDetail(
    props.threadRef.environmentId,
    props.threadRef.threadId,
    summary !== null,
  );
  if (summary === null || detail === null) return null;
  return (
    <>
      <PmManagerSection threadRef={props.threadRef} detail={detail} />
      <PmWorkItemsSection threadRef={props.threadRef} detail={detail} />
      <PmWorkersSection threadRef={props.threadRef} detail={detail} />
      <PmMemorySection threadRef={props.threadRef} detail={detail} />
    </>
  );
}

function PmManagerSection(props: {
  readonly threadRef: ThreadRef;
  readonly detail: PmThreadDetail;
}) {
  const gt = useGT();
  const [editing, setEditing] = useState(false);
  const [mission, setMission] = useState(props.detail.mission);
  const [instructions, setInstructions] = useState(props.detail.instructions);
  const startEditing = () => {
    setMission(props.detail.mission);
    setInstructions(props.detail.instructions);
    setEditing(true);
  };
  const save = async () => {
    if (
      await savePmMission(
        props.threadRef,
        props.detail,
        { mission, instructions },
        gt("Could not save the mission"),
      )
    )
      setEditing(false);
  };
  const instructionLines = props.detail.instructions
    .split("\n")
    .filter((line) => line.trim().length > 0);
  return (
    <ThreadDetailsSection
      headingId="pm-manager"
      title={gt("Project manager")}
      actions={
        editing ? null : (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={gt("Edit mission and instructions")}
            onClick={startEditing}
          >
            <PencilIcon />
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-2 px-2.5 text-sm">
        {editing ? (
          <>
            <label className="text-muted-foreground text-xs" htmlFor="pm-detail-mission">
              {gt("Mission")}
            </label>
            <Textarea
              id="pm-detail-mission"
              value={mission}
              onChange={(event) => setMission(event.target.value)}
            />
            <label className="text-muted-foreground text-xs" htmlFor="pm-detail-instructions">
              {gt("Standing instructions")}
            </label>
            <Textarea
              id="pm-detail-instructions"
              value={instructions}
              placeholder={gt("One per line.")}
              onChange={(event) => setInstructions(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button size="compact" variant="outline" onClick={() => setEditing(false)}>
                {gt("Cancel")}
              </Button>
              <Button size="compact" onClick={() => void save()}>
                {gt("Save")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="text-muted-foreground text-xs">{gt("Mission")}</div>
              {props.detail.mission.length > 0 ? (
                <div className="text-foreground/90">{props.detail.mission}</div>
              ) : (
                <div className="text-muted-foreground">
                  {gt("No mission yet. The PM sets it once it knows the brief.")}
                </div>
              )}
            </div>
            <div className="text-muted-foreground text-xs">
              {gt(
                "{count, plural, =0 {No standing instructions} one {# standing instruction} other {# standing instructions}}",
                {
                  count: instructionLines.length,
                },
              )}
            </div>
            {instructionLines.length > 0 ? (
              <ul className="list-disc ps-5 text-foreground/80 text-xs">
                {instructionLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </ThreadDetailsSection>
  );
}

const STATUS_DOT: Record<string, string> = {
  needs_you: "bg-warning",
  blocked: "bg-destructive",
  in_progress: "bg-warning",
  not_worked_on: "border border-muted-foreground",
  waiting: "bg-info",
  later: "bg-muted-foreground/60",
  done: "bg-success",
};

function usePmStatusLabels() {
  const gt = useGT();
  return {
    needs_you: gt("Needs you", { $context: "PM work item group" }),
    blocked: gt("Blocked", { $context: "PM work item group" }),
    in_progress: gt("In progress", { $context: "PM work item group" }),
    not_worked_on: gt("Not being worked on", { $context: "PM work item group" }),
    waiting: gt("Waiting", { $context: "PM work item group" }),
    later: gt("Later", { $context: "PM work item group" }),
    done: gt("Done", { $context: "PM work item group" }),
    dropped: gt("Dropped", { $context: "PM work item group" }),
  } as const;
}

function PmWorkItemsSection(props: {
  readonly threadRef: ThreadRef;
  readonly detail: PmThreadDetail;
}) {
  const gt = useGT();
  const labels = usePmStatusLabels();
  const groups = pmItemGroups(props.detail.items);
  const open = props.detail.items.filter(
    (item) => item.status === "moving" || item.status === "later",
  ).length;
  const key = pmKey(props.threadRef.environmentId, props.threadRef.threadId);
  return (
    <ThreadDetailsSection
      headingId="pm-work-items"
      title={gt("Work items")}
      actions={
        <span className="text-muted-foreground text-xs">{gt("{count} open", { count: open })}</span>
      }
    >
      <div className="flex flex-col px-1" data-pm-work-items="">
        {groups.length === 0 ? (
          <div className="px-1.5 py-1 text-muted-foreground text-xs">
            {gt("No work items yet.")}
          </div>
        ) : (
          groups.map((group) => (
            <PmItemGroupView
              key={group.status}
              foldKey={`items:${key}:${group.status}`}
              label={labels[group.status]}
              dot={STATUS_DOT[group.status] ?? ""}
              items={group.items}
              openByDefault={group.openByDefault}
              detail={props.detail}
              threadKey={key}
            />
          ))
        )}
      </div>
    </ThreadDetailsSection>
  );
}

function PmItemGroupView(props: {
  readonly foldKey: string;
  readonly label: string;
  readonly dot: string;
  readonly items: ReadonlyArray<PmItem>;
  readonly openByDefault: boolean;
  readonly detail: PmThreadDetail;
  readonly threadKey: string;
}) {
  const [open, setOpen] = usePmFold(props.foldKey, props.openByDefault);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-xs hover:bg-accent"
      >
        {open ? (
          <ChevronDownIcon aria-hidden className="size-3" />
        ) : (
          <ChevronRightIcon aria-hidden className="size-3" />
        )}
        <span aria-hidden className={cn("size-2 rounded-full", props.dot)} />
        <span className="text-foreground/90">{props.label}</span>
        <span className="text-muted-foreground">{props.items.length}</span>
      </button>
      {open
        ? props.items.map((item) => (
            <PmItemCard
              key={item.itemNo}
              item={item}
              detail={props.detail}
              threadKey={props.threadKey}
            />
          ))
        : null}
    </div>
  );
}

function PmItemCard(props: {
  readonly item: PmItem;
  readonly detail: PmThreadDetail;
  readonly threadKey: string;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  const { item } = props;
  const asks = props.detail.asks.filter(
    (ask) => ask.itemNo === item.itemNo && ask.state === "open",
  );
  const links = props.detail.links.filter((link) => link.itemNo === item.itemNo);
  const steps = item.steps.filter((step) => !step.chore);
  const doneSteps = steps.filter((step) => step.done).length;
  return (
    <div className="mx-1 mb-1.5 rounded-lg border border-border/70 bg-card/60 px-2.5 py-2 text-xs">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground text-sm">{item.title}</span>
          {item.nowLine || item.doneLine ? (
            <span className="block truncate text-muted-foreground">
              {item.doneLine ?? item.nowLine}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-muted-foreground">W{item.itemNo}</span>
      </button>
      {steps.length > 0 || asks.length > 0 || links.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2 text-muted-foreground">
          {steps.length > 0 ? (
            <span>{gt("{done} of {total} steps", { done: doneSteps, total: steps.length })}</span>
          ) : null}
          {asks.length > 0 ? (
            <span className="text-warning-foreground">
              {gt("{count, plural, one {# for you} other {# for you}}", { count: asks.length })}
            </span>
          ) : null}
          {links.map((link) => (
            <a
              key={link.number}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-2 hover:underline"
            >
              {link.title ??
                (link.kind === "pr" ? gt("PR") : link.kind === "issue" ? gt("Issue") : gt("Link"))}
            </a>
          ))}
        </div>
      ) : null}
      {expanded ? (
        <div className="mt-2 flex flex-col gap-1">
          {steps.map((step) => (
            <div key={step.number} className="flex items-center gap-1.5">
              {step.done ? (
                <CheckIcon aria-hidden className="size-3 text-success-foreground" />
              ) : (
                <CircleIcon aria-hidden className="size-3 text-muted-foreground" />
              )}
              <span className={cn(step.done && "text-muted-foreground")}>{step.text}</span>
            </div>
          ))}
          {item.waits
            .filter((wait) => wait.open)
            .map((wait) => (
              <div key={wait.number} className="text-muted-foreground">
                {gt("Waits on {target}", {
                  target:
                    wait.onKind === "item"
                      ? `W${wait.onRef}`
                      : wait.onKind === "ask"
                        ? `Q${wait.onRef}`
                        : wait.onRef,
                })}
              </div>
            ))}
          {asks.map((ask) => (
            <div key={ask.askNo} className="text-warning-foreground">
              Q{ask.askNo} {ask.title}
            </div>
          ))}
          {props.detail.pages
            .filter((page) => page.itemNo === item.itemNo && page.state === "open")
            .map((page) => (
              <button
                key={page.pageId}
                type="button"
                className="text-left text-warning-foreground underline-offset-2 hover:underline"
                onClick={() => openPmPage({ threadKey: props.threadKey, pageId: page.pageId })}
              >
                {page.title}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function PmWorkersSection(props: {
  readonly threadRef: ThreadRef;
  readonly detail: PmThreadDetail;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const shells = useThreadShells();
  const workers = props.detail.workers.filter((worker) => worker.state !== "resolved");
  if (workers.length === 0) return null;
  const stateLabel = (state: string) =>
    state === "running"
      ? gt("Working", { $context: "thread status" })
      : state === "waiting"
        ? gt("Waiting for your answer")
        : gt("Idle", { $context: "thread status" });
  return (
    <ThreadDetailsSection
      headingId="pm-workers"
      title={gt("Workers")}
      actions={<span className="text-muted-foreground text-xs">{workers.length}</span>}
    >
      <div className="flex flex-col px-1">
        {workers.map((worker) => {
          const shell = shells.find(
            (candidate) =>
              candidate.environmentId === props.threadRef.environmentId &&
              candidate.id === worker.threadId,
          );
          const ref = scopeThreadRef(props.threadRef.environmentId, worker.threadId);
          return (
            <button
              key={worker.threadId}
              type="button"
              className="group/pm-worker flex w-full min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
              onClick={() =>
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(ref),
                })
              }
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{shell?.title ?? worker.threadId}</span>
                <span className="block truncate text-muted-foreground text-xs">
                  {[
                    worker.itemNo === null ? null : `W${worker.itemNo}`,
                    stateLabel(worker.state),
                    worker.lastReportLine,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <ArrowUpRightIcon
                aria-hidden
                className="mt-0.5 size-3 shrink-0 opacity-0 group-hover/pm-worker:opacity-100"
              />
            </button>
          );
        })}
      </div>
    </ThreadDetailsSection>
  );
}

function PmMemorySection(props: {
  readonly threadRef: ThreadRef;
  readonly detail: PmThreadDetail;
}) {
  const gt = useGT();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const { environmentId, threadId } = props.threadRef;
  const add = async () => {
    const text = draft.trim();
    if (text.length === 0) return;
    const saved = await runPmCommand(
      pmCommands.remember,
      { environmentId, input: { pm: threadId, text } },
      gt("Could not save the memory note"),
    );
    if (saved !== null) {
      setDraft("");
      setAdding(false);
    }
  };
  const saveEdit = async (number: number) => {
    const text = draft.trim();
    if (text.length === 0) return;
    const saved = await runPmCommand(
      pmCommands.editMemory,
      { environmentId, input: { pm: threadId, number, text } },
      gt("Could not save the memory note"),
    );
    if (saved !== null) setEditing(null);
  };
  return (
    <ThreadDetailsSection
      headingId="pm-memory"
      title={gt("Memory")}
      actions={
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={gt("Add a memory note")}
          onClick={() => setAdding(true)}
        >
          <PlusIcon />
        </Button>
      }
    >
      <div className="flex flex-col gap-1 px-2.5 text-xs">
        {props.detail.memory.length === 0 && !adding ? (
          <div className="text-muted-foreground">{gt("No memory notes yet.")}</div>
        ) : null}
        {props.detail.memory.map((note) =>
          editing === note.number ? (
            <form
              key={note.number}
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                void saveEdit(note.number);
              }}
            >
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label={gt("Memory note")}
              />
            </form>
          ) : (
            <div key={note.number} className="group/pm-note flex items-start gap-2">
              <span className="w-4 shrink-0 text-muted-foreground">{note.number}</span>
              <span className="min-w-0 flex-1 text-foreground/85">{note.text}</span>
              <span className="hidden shrink-0 gap-0.5 group-hover/pm-note:flex">
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={gt("Edit memory note {number}", { number: note.number })}
                  onClick={() => {
                    setDraft(note.text);
                    setEditing(note.number);
                  }}
                >
                  <PencilIcon />
                </Button>
                <Button
                  size="icon-micro"
                  variant="ghost-destructive"
                  aria-label={gt("Delete memory note {number}", { number: note.number })}
                  onClick={() =>
                    void runPmCommand(
                      pmCommands.forget,
                      { environmentId, input: { pm: threadId, number: note.number } },
                      gt("Could not delete the memory note"),
                    )
                  }
                >
                  <Trash2Icon />
                </Button>
              </span>
            </div>
          ),
        )}
        {adding ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <Input
              autoFocus
              value={draft}
              placeholder={gt("A one-line note the PM keeps")}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={gt("New memory note")}
            />
          </form>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}
