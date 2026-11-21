import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type {
  EnvironmentId,
  PmItem,
  PmShownItemStatus,
  PmThreadDetail,
  ThreadId,
} from "@t3tools/contracts";
import { pmItemGroups, pmKey } from "@t3tools/pm/client";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/ui/AppText";
import { SymbolView } from "../components/ui/AppSymbol";
import { ScreenContent } from "../components/ui/ScreenContent";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { SheetHeader } from "../components/ui/SheetHeader";
import { cn } from "../lib/cn";
import { useThreadShells } from "../state/entities";
import { useOpenLinkedThread } from "../features/threads/useOpenLinkedThread";
import { runPm } from "./actions";
import type { PmSheetTab } from "./pm.logic";
import { pmCommands, usePmThreadDetail } from "./state";

type Target = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/** The PM's details as four tabs, Work first: the desktop's details-card sections. */
export function PmSheet({ route }: StaticScreenProps<Target>) {
  const target = route.params;
  const gt = useGT();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const detail = usePmThreadDetail(target.environmentId, target.threadId);
  const [tab, setTab] = useState<PmSheetTab>("work");
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={gt("Project manager")} onClose={() => navigation.goBack()} />
      <ScreenContent>
        <View className="px-5 pb-3">
          <SegmentedControl
            role="tab"
            size="compact"
            selected={tab}
            onSelect={setTab}
            options={[
              { value: "work", label: gt("Work") },
              { value: "workers", label: gt("Workers") },
              { value: "goal", label: gt("Goal") },
              { value: "memory", label: gt("Memory") },
            ]}
          />
        </View>
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-3 px-5"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          {detail === null ? null : tab === "work" ? (
            <WorkTab detail={detail} />
          ) : tab === "workers" ? (
            <WorkersTab target={target} detail={detail} />
          ) : tab === "goal" ? (
            <GoalTab target={target} detail={detail} />
          ) : (
            <MemoryTab target={target} detail={detail} />
          )}
        </ScrollView>
      </ScreenContent>
    </View>
  );
}

const STATUS_TINT: Record<PmShownItemStatus, string> = {
  needs_you: "accent-warning-foreground",
  blocked: "accent-danger-foreground",
  in_progress: "accent-primary-text",
  not_worked_on: "accent-foreground-muted",
  waiting: "accent-foreground-muted",
  later: "accent-foreground-muted",
  done: "accent-foreground-muted",
  dropped: "accent-foreground-muted",
};

function WorkTab(props: { readonly detail: PmThreadDetail }) {
  const gt = useGT();
  const [folds, setFolds] = useState<ReadonlyMap<PmShownItemStatus, boolean>>(new Map());
  const labels: Record<PmShownItemStatus, string> = {
    needs_you: gt("Needs you", { $context: "PM work item group" }),
    blocked: gt("Blocked", { $context: "PM work item group" }),
    in_progress: gt("In progress", { $context: "PM work item group" }),
    not_worked_on: gt("Not being worked on", { $context: "PM work item group" }),
    waiting: gt("Waiting", { $context: "PM work item group" }),
    later: gt("Later", { $context: "PM work item group" }),
    done: gt("Done", { $context: "PM work item group" }),
    dropped: gt("Dropped", { $context: "PM work item group" }),
  };
  const groups = pmItemGroups(props.detail.items);
  if (groups.length === 0)
    return (
      <Text className="pt-6 text-center text-sm text-foreground-muted">
        {gt("No work items yet.")}
      </Text>
    );
  return groups.map((group) => {
    const open = folds.get(group.status) ?? group.openByDefault;
    return (
      <View key={group.status} className="gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          className="flex-row items-center gap-2 py-1"
          onPress={() => setFolds(new Map(folds).set(group.status, !open))}
        >
          <SymbolView
            name={open ? "chevron.down" : "chevron.right"}
            size={10}
            tintColorClassName="accent-foreground-muted"
          />
          <SymbolView name="circle.fill" size={8} tintColorClassName={STATUS_TINT[group.status]} />
          <Text className="text-sm font-t3-medium text-foreground">{labels[group.status]}</Text>
          <Text className="text-sm text-foreground-muted">{group.items.length}</Text>
        </Pressable>
        {open ? group.items.map((item) => <ItemCard key={item.itemNo} item={item} />) : null}
      </View>
    );
  });
}

function ItemCard(props: { readonly item: PmItem }) {
  const gt = useGT();
  const { item } = props;
  const steps = item.steps.filter((step) => !step.chore);
  const line = item.nowLine ?? item.doneLine ?? item.laterReason;
  return (
    <View className="gap-1 rounded-xl border border-border bg-card px-3 py-2.5">
      <Text className="text-sm text-foreground">{`W${item.itemNo} ${item.title}`}</Text>
      {line ? (
        <Text className="text-xs text-foreground-muted" numberOfLines={2}>
          {line}
        </Text>
      ) : null}
      {steps.length > 0 ? (
        <Text className="text-xs text-foreground-muted">
          {gt("{done} of {total} steps", {
            done: steps.filter((step) => step.done).length,
            total: steps.length,
          })}
        </Text>
      ) : null}
    </View>
  );
}

function WorkersTab(props: { readonly target: Target; readonly detail: PmThreadDetail }) {
  const gt = useGT();
  const shells = useThreadShells();
  const open = useOpenLinkedThread();
  const titles = new Map(
    shells.map((shell) => [pmKey(shell.environmentId, shell.id), shell.title]),
  );
  if (props.detail.workers.length === 0)
    return (
      <Text className="pt-6 text-center text-sm text-foreground-muted">
        {gt("No workers yet.")}
      </Text>
    );
  return props.detail.workers.map((worker) => (
    <Pressable
      key={worker.threadId}
      accessibilityRole="button"
      className="gap-1 rounded-xl border border-border bg-card px-3 py-2.5"
      onPress={() => open({ environmentId: props.target.environmentId, threadId: worker.threadId })}
    >
      <Text className="text-sm text-foreground" numberOfLines={1}>
        {titles.get(pmKey(props.target.environmentId, worker.threadId)) ?? worker.threadId}
      </Text>
      <Text className="text-xs text-foreground-muted" numberOfLines={2}>
        {[
          worker.itemNo === null ? null : `W${worker.itemNo}`,
          worker.lastReportLine ?? worker.state,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </Pressable>
  ));
}

function GoalTab(props: { readonly target: Target; readonly detail: PmThreadDetail }) {
  const gt = useGT();
  const input = { pm: props.target.threadId };
  const environmentId = props.target.environmentId;
  return (
    <>
      <EditableText
        label={gt("Mission")}
        empty={gt("No mission yet. The PM sets it once it knows the brief.")}
        value={props.detail.mission}
        onSave={(mission) =>
          runPm(
            pmCommands.setMission,
            { environmentId, input: { ...input, mission } },
            gt("Could not save the mission"),
          )
        }
      />
      <EditableText
        label={gt("Standing instructions")}
        empty={gt("None yet.")}
        value={props.detail.instructions}
        onSave={(instructions) =>
          runPm(
            pmCommands.setInstructions,
            { environmentId, input: { ...input, instructions } },
            gt("Could not save the instructions"),
          )
        }
      />
    </>
  );
}

function EditableText(props: {
  readonly label: string;
  readonly empty: string;
  readonly value: string;
  readonly onSave: (value: string) => Promise<unknown>;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
        <Pressable
          accessibilityRole="button"
          className="px-2 py-1"
          onPress={async () => {
            if (draft === null) return setDraft(props.value);
            if ((await props.onSave(draft.trim())) !== null) setDraft(null);
          }}
        >
          <Text className="text-sm text-primary-text">
            {draft === null ? gt("Edit") : gt("Save")}
          </Text>
        </Pressable>
      </View>
      {draft === null ? (
        <Text
          className={cn(
            "text-sm",
            props.value.trim() ? "text-foreground" : "text-foreground-muted",
          )}
        >
          {props.value.trim() || props.empty}
        </Text>
      ) : (
        <TextInput
          accessibilityLabel={props.label}
          multiline
          autoFocus
          value={draft}
          onChangeText={setDraft}
          className="min-h-20 rounded-lg border border-border bg-card px-3 py-2 text-foreground"
        />
      )}
    </View>
  );
}

function MemoryTab(props: { readonly target: Target; readonly detail: PmThreadDetail }) {
  const gt = useGT();
  const [text, setText] = useState("");
  const environmentId = props.target.environmentId;
  const pm = props.target.threadId;
  const add = async () => {
    const note = text.trim();
    if (note.length === 0) return;
    const saved = await runPm(
      pmCommands.remember,
      { environmentId, input: { pm, text: note as never } },
      gt("Could not save the memory note"),
    );
    if (saved !== null) setText("");
  };
  return (
    <>
      {props.detail.memory.length === 0 ? (
        <Text className="text-sm text-foreground-muted">{gt("Nothing remembered yet.")}</Text>
      ) : (
        props.detail.memory.map((note) => (
          <View
            key={note.number}
            className="flex-row items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5"
          >
            <Text className="flex-1 text-sm text-foreground">{note.text}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Delete memory note {number}", { number: note.number })}
              onPress={() =>
                void runPm(
                  pmCommands.forget,
                  { environmentId, input: { pm, number: note.number } },
                  gt("Could not delete the memory note"),
                )
              }
            >
              <SymbolView name="trash" size={14} tintColorClassName="accent-icon-muted" />
            </Pressable>
          </View>
        ))
      )}
      <View className="flex-row items-center gap-2">
        <TextInput
          accessibilityLabel={gt("New memory note")}
          placeholder={gt("Remember something")}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => void add()}
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-foreground"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Add memory note")}
          className="px-2 py-2"
          onPress={() => void add()}
        >
          <SymbolView name="plus" size={16} tintColorClassName="accent-icon" />
        </Pressable>
      </View>
    </>
  );
}
