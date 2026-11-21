import type { MenuAction } from "@react-native-menu/menu";
import { StackActions, useNavigation } from "@react-navigation/native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { pmKey } from "@t3tools/pm/client";
import { useGT } from "gt-react-native";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../components/ui/AppText";
import { SymbolView } from "../components/ui/AppSymbol";
import { cn } from "../lib/cn";
import { useThreadShells } from "../state/entities";
import { createPm } from "./actions";
import { pmWorkerPreview } from "./pm.logic";
import { usePmIndex, usePmSummary } from "./state";

type RowThread = Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId">;

/** The "PM" badge on a project manager's row. */
export function PmRowBadge(props: { readonly thread: RowThread }) {
  const gt = useGT();
  if (usePmSummary(props.thread.environmentId, props.thread.id) === null) return null;
  return (
    <View className="rounded border border-border px-1">
      <Text className="font-t3-medium text-3xs uppercase text-foreground-muted">
        {gt("PM", { $context: "badge for a project manager thread" })}
      </Text>
    </View>
  );
}

/** Under a PM's title: its counts and status, then its workers, two at most, then "N more". */
export function PmRowCounts(props: {
  readonly thread: RowThread;
  readonly inset: number;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
}) {
  const gt = useGT();
  const summary = usePmSummary(props.thread.environmentId, props.thread.id);
  const shells = useThreadShells();
  if (summary === null) return null;
  const workerKeys = new Set(
    summary.workerThreadIds.map((id) => pmKey(props.thread.environmentId, id)),
  );
  const workers = shells.filter((shell) => workerKeys.has(pmKey(shell.environmentId, shell.id)));
  const preview = pmWorkerPreview(workers, (worker) => threadRuntimeIsActive(worker.runtime));
  const status =
    summary.rowState === "blocked"
      ? { text: gt("Blocked"), className: "text-danger-foreground" }
      : summary.rowState === "needs_you"
        ? { text: gt("Needs you"), className: "text-warning-foreground" }
        : summary.rowState === "running"
          ? {
              text: gt("{count} running", { count: summary.runningWorkers }),
              className: "text-primary-text",
            }
          : { text: gt("Idle"), className: "text-foreground-muted" };
  return (
    <View className="mt-1 gap-1.5" style={{ paddingLeft: props.inset }}>
      <View className="flex-row items-center gap-3">
        <Count
          icon="list.number"
          text={gt("{count, plural, one {# item} other {# items}}", { count: summary.openItems })}
        />
        <Count
          icon="questionmark.bubble"
          text={gt("{count, plural, one {# ask} other {# asks}}", { count: summary.openAsks })}
        />
        <Count
          icon="robot"
          text={gt("{count, plural, one {# worker} other {# workers}}", { count: summary.workers })}
        />
        <Text className={cn("ml-auto text-xs font-t3-medium", status.className)}>
          {status.text}
        </Text>
      </View>
      {preview.shown.map((worker) => (
        <Pressable
          key={worker.id}
          accessibilityRole="button"
          accessibilityLabel={gt("Open worker {title}", { title: worker.title })}
          className="flex-row items-center gap-2 py-1"
          onPress={() => props.onSelectThread(worker)}
        >
          <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
            {worker.title}
          </Text>
          {threadRuntimeIsActive(worker.runtime) ? (
            <Text className="text-xs text-primary-text">{gt("Working")}</Text>
          ) : null}
        </Pressable>
      ))}
      {preview.more > 0 ? (
        <Text className="text-xs text-foreground-muted">
          {gt("{count} more", { count: preview.more })}
        </Text>
      ) : null}
    </View>
  );
}

function Count(props: {
  readonly icon: "list.number" | "questionmark.bubble" | "robot";
  readonly text: string;
}) {
  return (
    <View className="flex-row items-center gap-1">
      <SymbolView name={props.icon} size={11} tintColorClassName="accent-foreground-muted" />
      <Text className="text-xs text-foreground-muted">{props.text}</Text>
    </View>
  );
}

/**
 * A row's long-press additions: a PM shows its mission first (mobile has no preview to carry it),
 * and every row in an environment with PMs on offers a new PM in its project.
 */
export function usePmRowMenu(thread: RowThread) {
  const gt = useGT();
  const index = usePmIndex();
  const navigation = useNavigation();
  const summary = index.pms.get(pmKey(thread.environmentId, thread.id)) ?? null;
  const actions: MenuAction[] = index.enabled.has(thread.environmentId)
    ? [
        ...(summary === null
          ? []
          : [
              {
                id: "pm-mission",
                title: summary.mission.trim() || gt("No mission yet"),
                image: "target",
                attributes: { disabled: true },
              },
            ]),
        { id: "pm-new", title: gt("New PM in this project"), image: "plus.bubble" },
      ]
    : [];
  const handle = (event: string) => {
    if (event !== "pm-new") return false;
    void createPm(thread.environmentId, thread.projectId, (target) =>
      navigation.dispatch(StackActions.push("Thread", target)),
    );
    return true;
  };
  return { actions, handle };
}
