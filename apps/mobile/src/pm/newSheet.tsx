import { StackActions, useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/ui/AppText";
import { NavigationRow } from "../components/ui/NavigationRow";
import { ScreenContent } from "../components/ui/ScreenContent";
import { SheetHeader } from "../components/ui/SheetHeader";
import { useProjects } from "../state/entities";
import { createPm } from "./actions";
import { usePmIndex } from "./state";

/** New PM from the home button's long-press: pick the project, and the PM opens with its setup turn. */
export function PmNewSheet() {
  const gt = useGT();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const index = usePmIndex();
  const [busy, setBusy] = useState(false);
  const projects = useProjects().filter(
    (project) => index.enabled.has(project.environmentId) && project.isScratch !== true,
  );
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={gt("New PM")} onClose={() => navigation.goBack()} />
      <ScreenContent>
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          {projects.length === 0 ? (
            <Text className="pt-6 text-center text-sm text-foreground-muted">
              {gt("No project here has project managers turned on.")}
            </Text>
          ) : (
            projects.map((project) => (
              <NavigationRow
                key={`${project.environmentId}:${project.id}`}
                title={project.title}
                subtitle={project.workspaceRoot}
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  await createPm(project.environmentId, project.id, (target) =>
                    navigation.dispatch(StackActions.replace("Thread", target)),
                  );
                  setBusy(false);
                }}
              />
            ))
          )}
        </ScrollView>
      </ScreenContent>
    </View>
  );
}
