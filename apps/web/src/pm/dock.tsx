import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type PmAsk,
  type ThreadId,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import {
  AlarmClockIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  FileTextIcon,
  MessageCircleQuestionIcon,
  MoreHorizontalIcon,
  StarIcon,
} from "lucide-react";
import { useState } from "react";

import { pickSnoozePreset, resolveSnoozePresets } from "../components/Sidebar.snooze";
import { Button } from "../components/ui/button";
import {
  Menu,
  MenuItem,
  MenuItemDetail,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../components/ui/menu";
import { toastManager } from "../components/ui/toast";
import { useNowMinute } from "../hooks/useNowMinute";
import { useEnvironmentScope } from "../state/session";
import { useClientSettings } from "../hooks/useSettings";
import { cn } from "../lib/utils";
import { formatRelativeTime } from "../timestampFormat";
import { runPmCommand } from "./actions";
import { PmMissionDialog } from "./mission";
import { pmAskTag, pmDock, type PmDockRow } from "./pm.logic";
import { pmCommands, pmKey, usePmSummary, usePmThreadDetail } from "./state";
import { openPmPage, usePmFold } from "./uiState";

interface DockProps {
  readonly threadRef: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } | null;
  /** Upstream's blocking question drawer is showing; the dock steps aside. */
  readonly hidden?: boolean;
}

/** What needs you, above a PM's composer: asks, pages to answer and blocked work. */
export function PmComposerDock(props: DockProps) {
  const summary = usePmSummary(
    props.threadRef?.environmentId ?? null,
    props.threadRef?.threadId ?? null,
  );
  if (props.threadRef === null || summary === null) return null;
  return (
    <>
      <PmMissionDialog threadRef={props.threadRef} />
      {props.hidden ? null : <PmDockCard threadRef={props.threadRef} />}
    </>
  );
}

function PmDockCard(props: {
  readonly threadRef: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };
}) {
  const gt = useGT();
  const { environmentId, threadId } = props.threadRef;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const detail = usePmThreadDetail(environmentId, threadId);
  const key = pmKey(environmentId, threadId);
  const [folded, setFolded] = usePmFold(`dock:${key}`, false);
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  const now = Date.parse(useNowMinute());
  if (detail === null) return null;
  const dock = pmDock(detail, now);
  if (dock.rows.length === 0 && dock.snoozed.length === 0 && dock.counts.inProgress === 0)
    return null;
  return (
    <div
      data-pm-dock=""
      // Upstream's banner dock shows only with an attached surface in it, and tucks 1rem under the
      // composer; the PM dock is its own card 8px above the chat box instead.
      data-composer-banner-surface="attached"
      className="mb-6 overflow-hidden rounded-xl border border-border/70 bg-card text-sm shadow-xs"
    >
      <button
        type="button"
        aria-expanded={!folded}
        onClick={() => setFolded(!folded)}
        className="flex h-8 w-full items-center gap-3 px-3 text-muted-foreground text-xs hover:bg-accent/50"
      >
        {dock.counts.needsYou > 0 ? (
          <span className="inline-flex items-center gap-1 text-foreground">
            <MessageCircleQuestionIcon aria-hidden className="size-3.5 text-warning-foreground" />
            {gt("{count} need you", { count: dock.counts.needsYou, $context: "PM dock count" })}
          </span>
        ) : null}
        {dock.counts.blocked > 0 ? (
          <span className="inline-flex items-center gap-1 text-foreground">
            <span aria-hidden className="size-2 rounded-full bg-destructive" />
            {gt("{count} blocked", { count: dock.counts.blocked, $context: "PM dock count" })}
          </span>
        ) : null}
        {dock.counts.inProgress > 0 ? (
          <span className="inline-flex items-center gap-1 text-foreground">
            <span aria-hidden className="size-2 rounded-full bg-warning" />
            {gt("{count} in progress", {
              count: dock.counts.inProgress,
              $context: "PM dock count",
            })}
          </span>
        ) : null}
        <span className="flex-1" />
        {folded ? (
          <ChevronUpIcon aria-hidden className="size-3.5" />
        ) : (
          <ChevronDownIcon aria-hidden className="size-3.5" />
        )}
      </button>
      {folded ? null : (
        <div className="border-border/60 border-t">
          {dock.rows.length === 0 ? (
            <div className="px-3 py-2 text-muted-foreground text-xs">
              {gt("Nothing needs you right now.")}
            </div>
          ) : (
            dock.rows.map((row) => (
              <PmDockRowView
                key={row.key}
                row={row}
                environmentId={environmentId}
                threadId={threadId}
                canOperate={canOperate}
                now={now}
              />
            ))
          )}
          {dock.more > 0 ? (
            <div className="px-3 py-1.5 text-muted-foreground text-xs">
              {gt("{count} more need you", { count: dock.more })}
            </div>
          ) : null}
          {dock.snoozed.length > 0 ? (
            <div className="border-border/60 border-t">
              <button
                type="button"
                aria-expanded={snoozedOpen}
                onClick={() => setSnoozedOpen(!snoozedOpen)}
                className="flex h-7 w-full items-center gap-1.5 px-3 text-muted-foreground text-xs hover:bg-accent/50"
              >
                <AlarmClockIcon aria-hidden className="size-3" />
                {gt("Snoozed ({count})", { count: dock.snoozed.length })}
              </button>
              {snoozedOpen
                ? dock.snoozed.map((ask) => (
                    <div key={ask.askNo} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate text-foreground/80">
                        {ask.title}
                      </span>
                      <Button
                        size="compact"
                        variant="ghost"
                        disabled={!canOperate}
                        onClick={() =>
                          void runPmCommand(
                            pmCommands.askWake,
                            { environmentId, input: { pm: threadId, ask: ask.askNo } },
                            gt("Could not wake the question"),
                          )
                        }
                      >
                        {gt("Wake")}
                      </Button>
                    </div>
                  ))
                : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function age(at: string, now: number) {
  return formatRelativeTime(at, now)?.value ?? "";
}

function PmDockRowView(props: {
  readonly row: PmDockRow;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly canOperate: boolean;
  readonly now: number;
}) {
  const gt = useGT();
  const { row, environmentId, threadId } = props;
  if (row.kind === "page") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5">
        <FileTextIcon aria-hidden className="size-3.5 shrink-0 text-warning-foreground" />
        <span className="min-w-0 flex-1 truncate">{row.page.title}</span>
        <Button
          size="compact"
          variant="outline"
          onClick={() =>
            openPmPage({ threadKey: pmKey(environmentId, threadId), pageId: row.page.pageId })
          }
        >
          {gt("Open", { $context: "open a Live page" })}
        </Button>
        <span className="shrink-0 whitespace-nowrap text-right text-muted-foreground text-xs">
          {age(row.at, props.now)}
        </span>
      </div>
    );
  }
  if (row.kind === "blocked") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5">
        <CircleAlertIcon aria-hidden className="size-3.5 shrink-0 text-destructive" />
        <span className="min-w-0 flex-1 truncate">
          {row.item.title}
          {row.item.nowLine ? (
            <span className="block truncate text-muted-foreground text-xs">{row.item.nowLine}</span>
          ) : null}
        </span>
        <span className="shrink-0 whitespace-nowrap text-right text-muted-foreground text-xs">
          {age(row.at, props.now)}
        </span>
      </div>
    );
  }
  return (
    <PmAskRow
      ask={row.ask}
      environmentId={environmentId}
      threadId={threadId}
      canOperate={props.canOperate}
      now={props.now}
    />
  );
}

function PmAskRow(props: {
  readonly ask: PmAsk;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly canOperate: boolean;
  readonly now: number;
}) {
  const gt = useGT();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [presets, setPresets] = useState<ReturnType<typeof resolveSnoozePresets>>([]);
  const { ask, environmentId, threadId } = props;
  const target = { environmentId, input: { pm: threadId, ask: ask.askNo } };
  const answers =
    ask.answers.length > 0
      ? ask.answers
      : [gt("Done", { $context: "answer to an ask with no choices" })];
  const answer = (value: string) =>
    void runPmCommand(
      pmCommands.askAnswer,
      { environmentId, input: { pm: threadId, ask: ask.askNo, answer: value } },
      gt("Could not send the answer"),
    );
  const dismiss = async () => {
    const done = await runPmCommand(
      pmCommands.askDismiss,
      target,
      gt("Could not dismiss the question"),
    );
    if (done === null) return;
    const toastId = toastManager.add({
      title: gt('Dismissed "{title}"', { title: ask.title }),
      timeout: 6000,
      actionProps: {
        children: gt("Undo"),
        onClick: () => {
          toastManager.close(toastId);
          void runPmCommand(pmCommands.askUndoDismiss, target, gt("Could not undo the dismiss"));
        },
      },
    });
  };
  return (
    <div className="group/pm-ask flex items-start gap-2 px-3 py-1.5" data-pm-ask={ask.askNo}>
      <MessageCircleQuestionIcon
        aria-hidden
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          ask.holds ? "text-destructive" : "text-warning-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate">{ask.title}</div>
        {ask.detail ? (
          <div className="line-clamp-2 text-muted-foreground text-xs">{ask.detail}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {answers.map((choice) => (
          <Button
            key={choice}
            size="compact"
            variant="outline"
            disabled={!props.canOperate}
            onClick={() => answer(choice)}
          >
            {choice === ask.recommended ? (
              <StarIcon aria-label={gt("Recommended")} className="fill-current" />
            ) : null}
            {choice}
          </Button>
        ))}
        <Menu
          onOpenChange={(open) =>
            setPresets(open ? resolveSnoozePresets(new Date(), timestampFormat, environmentId) : [])
          }
        >
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={gt("More for this question")}
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup side="bottom" align="end">
            <MenuSub>
              <MenuSubTrigger disabled={!props.canOperate}>{gt("Snooze")}</MenuSubTrigger>
              <MenuSubPopup>
                {presets.map((preset) => (
                  <MenuItem
                    key={preset.id}
                    onClick={() => {
                      const picked = pickSnoozePreset(
                        presets,
                        preset.id,
                        timestampFormat,
                        environmentId,
                      );
                      if (picked)
                        void runPmCommand(
                          pmCommands.askSnooze,
                          {
                            environmentId,
                            input: { pm: threadId, ask: ask.askNo, until: picked.snoozedUntil },
                          },
                          gt("Could not snooze the question"),
                        );
                    }}
                  >
                    {preset.label}
                    <MenuItemDetail>{preset.whenLabel}</MenuItemDetail>
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
            <MenuItem disabled={!props.canOperate} onClick={() => void dismiss()}>
              {gt("Dismiss")}
            </MenuItem>
            <MenuItem onClick={() => void navigator.clipboard?.writeText(pmAskTag(ask))}>
              {gt('Copy as "{tag}"', { tag: pmAskTag(ask) })}
            </MenuItem>
          </MenuPopup>
        </Menu>
        <span className="whitespace-nowrap text-right text-muted-foreground text-xs group-hover/pm-ask:hidden">
          {age(ask.createdAt, props.now)}
        </span>
      </div>
    </div>
  );
}
