import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ChevronDownIcon, ChevronRightIcon, FileTextIcon } from "lucide-react";
import { type ReactNode, use, useState } from "react";

import { TimelineRowCtx } from "../components/chat/timelineRowContext";
import { cn } from "../lib/utils";
import { usePmIndex } from "./state";
import { parsePmPageAnswers, parsePmReportNotification, type PmReportPill } from "./pm.logic";

type TurnItem = OrchestrationV2ThreadProjection["turnItems"][number];

/** The worker report a PM got, read from its notification; null for anything else. */
export function pmReportOf(item: TurnItem | undefined) {
  return item?.type === "notification" ? parsePmReportNotification(item) : null;
}

const PILL_CLASS: Record<PmReportPill, string> = {
  finished: "text-success-foreground border-success/30",
  waiting: "text-warning-foreground border-warning/30",
  quiet: "text-warning-foreground border-warning/30",
  stopped: "text-error-foreground border-error/30",
  idle: "text-warning-foreground border-warning/30",
  restarted: "text-info-foreground border-info/30",
};

/** One line, "Report from <worker>" and why it came; opens to the full report. */
export function PmReportCard(props: {
  readonly item: TurnItem | undefined;
  /** Upstream's own row, shown while PMs are off there. */
  readonly fallback: ReactNode;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const enabled = usePmIndex().enabled.has(use(TimelineRowCtx).activeThreadEnvironmentId);
  const report = pmReportOf(props.item);
  if (report === null || !enabled) return props.fallback;
  const pill: Record<PmReportPill, string> = {
    finished: gt("Finished", { $context: "worker report kind" }),
    waiting: gt("Waiting for an answer", { $context: "worker report kind" }),
    quiet: gt("Quiet for 8 min", { $context: "worker report kind" }),
    stopped: gt("Stopped mid-turn", { $context: "worker report kind" }),
    idle: gt("Idle while owing work", { $context: "worker report kind" }),
    restarted: gt("Restarted", { $context: "worker report kind" }),
  };
  return (
    <div data-pm-report="" className="my-1 rounded-lg border border-border/70 bg-card/60 text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
        ) : (
          <ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {gt('Report from "{worker}"', { worker: report.worker })}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-2xs",
            PILL_CLASS[report.pill],
          )}
        >
          {pill[report.pill]}
        </span>
      </button>
      {open ? (
        <div className="whitespace-pre-wrap border-border/60 border-t px-3 py-2 text-foreground/85 text-xs leading-relaxed">
          {report.body}
        </div>
      ) : null}
    </div>
  );
}

/** A Live page's answers message, drawn as a compact answers card. */
export function PmAnswersCard(props: { readonly text: string; readonly fallback: ReactNode }) {
  const gt = useGT();
  const enabled = usePmIndex().enabled.size > 0;
  const answers = parsePmPageAnswers(props.text);
  if (answers === null || !enabled) return props.fallback;
  return (
    <div
      data-pm-answers=""
      className="ms-auto my-1 w-full max-w-md rounded-lg border border-border/70 bg-card/60 text-sm"
    >
      <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2">
        <FileTextIcon aria-hidden className="size-3.5 text-warning-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {answers.seen
            ? gt("Seen · {title}", { title: answers.title })
            : gt("Answers · {title}", { title: answers.title })}
        </span>
      </div>
      <div className="flex flex-col gap-1 px-3 py-2 text-xs">
        {answers.seen ? (
          <span className="text-foreground/85">{answers.reply ?? gt("Marked as seen.")}</span>
        ) : (
          answers.entries.map((entry) => (
            <div key={entry.key} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground">{entry.key}</span>
              <span className="min-w-0 text-foreground/85">{entry.value}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
