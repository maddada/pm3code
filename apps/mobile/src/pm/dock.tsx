import { useNavigation } from "@react-navigation/native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, PmAsk, PmItem, PmPageSummary, ThreadId } from "@t3tools/contracts";
import { pmAskTag, pmDock } from "@t3tools/pm/client";
import * as Clipboard from "expo-clipboard";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";

import { AppText as Text } from "../components/ui/AppText";
import { SymbolView } from "../components/ui/AppSymbol";
import { Menu } from "../components/ui/Menu";
import { cn } from "../lib/cn";
import { useNowMinuteMs } from "../lib/clock";
import { runPm } from "./actions";
import { pmCommands, usePmSummary, usePmThreadDetail } from "./state";

type Target = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/** Above a PM's composer: what needs the user, counts first, then the first row (all when open). */
export function PmDock(props: {
  readonly thread: Pick<EnvironmentThreadShell, "environmentId" | "id">;
}) {
  const { environmentId, id: threadId } = props.thread;
  const summary = usePmSummary(environmentId, threadId);
  if (summary === null) return null;
  return <Dock environmentId={environmentId} threadId={threadId} />;
}

function Dock(props: Target) {
  const gt = useGT();
  const now = useNowMinuteMs();
  const detail = usePmThreadDetail(props.environmentId, props.threadId);
  const [open, setOpen] = useState(false);
  if (detail === null) return null;
  const dock = pmDock(detail, now);
  if (dock.rows.length === 0 && dock.snoozed.length === 0) return null;
  const rows = open ? dock.rows : dock.rows.slice(0, 1);
  return (
    <View
      className={cn(
        "mx-3 mb-2 overflow-hidden rounded-2xl border border-border",
        Platform.OS === "android" ? "bg-thread-canvas" : "bg-screen",
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          open ? gt("Fold the project manager dock") : gt("Open the project manager dock")
        }
        className="flex-row items-center gap-3 border-b border-border px-3 py-2"
        onPress={() => setOpen(!open)}
      >
        <Count
          icon="questionmark.bubble"
          className="text-warning-foreground"
          tint="accent-warning-foreground"
          value={dock.counts.needsYou}
          label={gt("Needs you")}
        />
        <Count
          icon="exclamationmark.circle"
          className="text-danger-foreground"
          tint="accent-danger-foreground"
          value={dock.counts.blocked}
          label={gt("Blocked")}
        />
        <Count
          icon="circle.dashed"
          className="text-primary-text"
          tint="accent-primary-text"
          value={dock.counts.inProgress}
          label={gt("In progress")}
        />
        <View className="flex-1" />
        <SymbolView
          name={open ? "chevron.up" : "chevron.down"}
          size={12}
          tintColorClassName="accent-foreground-muted"
        />
      </Pressable>
      <View className="gap-1 px-3 py-2">
        {rows.map((row) =>
          row.kind === "ask" ? (
            <AskRow key={row.key} target={props} ask={row.ask} now={now} />
          ) : row.kind === "page" ? (
            <PageRow key={row.key} target={props} page={row.page} />
          ) : (
            <BlockedRow key={row.key} item={row.item} />
          ),
        )}
        {open && dock.more > 0 ? (
          <Text className="text-xs text-foreground-muted">
            {gt("{count} more in the PM sheet", { count: dock.more })}
          </Text>
        ) : null}
        {open
          ? dock.snoozed.map((ask) => (
              <View key={ask.askNo} className="flex-row items-center gap-2 py-1">
                <SymbolView name="clock" size={11} tintColorClassName="accent-foreground-muted" />
                <Text className="flex-1 text-xs text-foreground-muted" numberOfLines={1}>
                  {gt("Snoozed: {title}", { title: ask.title })}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  className="rounded-full bg-subtle px-2.5 py-1"
                  onPress={() =>
                    void runPm(
                      pmCommands.askWake,
                      {
                        environmentId: props.environmentId,
                        input: { pm: props.threadId, ask: ask.askNo },
                      },
                      gt("Could not wake the question"),
                    )
                  }
                >
                  <Text className="text-xs text-foreground">{gt("Wake")}</Text>
                </Pressable>
              </View>
            ))
          : null}
      </View>
    </View>
  );
}

function Count(props: {
  readonly icon: "questionmark.bubble" | "exclamationmark.circle" | "circle.dashed";
  readonly className: string;
  readonly tint: string;
  readonly value: number;
  readonly label: string;
}) {
  return (
    <View
      className="flex-row items-center gap-1"
      accessibilityLabel={`${props.label} ${props.value}`}
    >
      <SymbolView name={props.icon} size={12} tintColorClassName={props.tint} />
      <Text className={cn("text-sm font-t3-medium", props.className)}>{props.value}</Text>
    </View>
  );
}

const HOUR_MS = 60 * 60 * 1000;

function AskRow(props: { readonly target: Target; readonly ask: PmAsk; readonly now: number }) {
  const gt = useGT();
  const { ask } = props;
  const [sending, setSending] = useState<string | null>(null);
  const input = { pm: props.target.threadId, ask: ask.askNo };
  const answer = async (value: string) => {
    setSending(value);
    await runPm(
      pmCommands.askAnswer,
      { environmentId: props.target.environmentId, input: { ...input, answer: value } },
      gt("Could not send the answer"),
    );
    setSending(null);
  };
  const onMenu = async (event: string) => {
    const environmentId = props.target.environmentId;
    if (event === "copy") await Clipboard.setStringAsync(`${pmAskTag(ask)} ${ask.title}`);
    if (event === "snooze")
      await runPm(
        pmCommands.askSnooze,
        { environmentId, input: { ...input, until: new Date(props.now + HOUR_MS).toISOString() } },
        gt("Could not snooze the question"),
      );
    if (event !== "dismiss") return;
    const done = await runPm(
      pmCommands.askDismiss,
      { environmentId, input },
      gt("Could not dismiss the question"),
    );
    if (done === null) return;
    Alert.alert(gt("Question dismissed"), ask.title, [
      { text: gt("OK"), style: "cancel" },
      {
        text: gt("Undo"),
        onPress: () =>
          void runPm(
            pmCommands.askUndoDismiss,
            { environmentId, input },
            gt("Could not undo the dismiss"),
          ),
      },
    ]);
  };
  return (
    <Menu
      accessibilityLabel={ask.title}
      shouldOpenOnLongPress
      actions={[
        { id: "snooze", title: gt("Snooze for an hour"), image: "clock" },
        { id: "copy", title: gt("Copy as {tag}", { tag: pmAskTag(ask) }), image: "doc.on.doc" },
        { id: "dismiss", title: gt("Dismiss"), image: "xmark", attributes: { destructive: true } },
      ]}
      onPressAction={({ nativeEvent }) => void onMenu(nativeEvent.event)}
    >
      <View className="gap-2 py-1">
        <View className="flex-row items-start gap-2">
          <SymbolView
            name="questionmark.bubble"
            size={13}
            tintColorClassName="accent-warning-foreground"
          />
          <Text className="flex-1 text-sm text-foreground">{ask.title}</Text>
        </View>
        {ask.answers.length > 0 ? (
          <View className="flex-row flex-wrap gap-1.5 pl-5">
            {ask.answers.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={
                  value === ask.recommended ? gt("{answer}, recommended", { answer: value }) : value
                }
                disabled={sending !== null}
                className={cn(
                  "flex-row items-center gap-1 rounded-lg bg-subtle px-2.5 py-1.5",
                  sending !== null && sending !== value && "opacity-50",
                )}
                onPress={() => void answer(value)}
              >
                <Text className="text-sm text-foreground">{value}</Text>
                {value === ask.recommended ? (
                  <SymbolView
                    name="star.fill"
                    size={9}
                    tintColorClassName="accent-warning-foreground"
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : (
          <Text className="pl-5 text-xs text-foreground-muted">
            {gt("Answer in the chat below.")}
          </Text>
        )}
      </View>
    </Menu>
  );
}

function PageRow(props: { readonly target: Target; readonly page: PmPageSummary }) {
  const gt = useGT();
  const navigation = useNavigation();
  return (
    <View className="flex-row items-center gap-2 py-1">
      <SymbolView name="doc.text" size={13} tintColorClassName="accent-warning-foreground" />
      <Text className="flex-1 text-sm text-foreground" numberOfLines={2}>
        {props.page.title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt("Open the page {title}", { title: props.page.title })}
        className="rounded-lg bg-subtle px-2.5 py-1.5"
        onPress={() =>
          navigation.navigate("PmPage", { ...props.target, pageId: props.page.pageId })
        }
      >
        <Text className="text-sm text-foreground">{gt("Open")}</Text>
      </Pressable>
    </View>
  );
}

function BlockedRow(props: { readonly item: PmItem }) {
  const gt = useGT();
  return (
    <View className="flex-row items-center gap-2 py-1">
      <SymbolView
        name="exclamationmark.circle"
        size={13}
        tintColorClassName="accent-danger-foreground"
      />
      <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
        {`W${props.item.itemNo} ${props.item.title}`}
      </Text>
      <Text className="text-xs text-danger-foreground">{gt("Blocked")}</Text>
    </View>
  );
}
