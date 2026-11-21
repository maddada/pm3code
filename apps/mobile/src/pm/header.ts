import { useNavigation, useRoute, type Route } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useGT } from "gt-react-native";

import type { AppBarAction } from "../components/ui/AppBar.types";
import { usePmSummary } from "./state";

/** A PM thread's header button: opens its details sheet. */
export function usePmHeaderActions(): AppBarAction[] {
  const gt = useGT();
  const navigation = useNavigation();
  const route = useRoute<Route<string, { environmentId?: string; threadId?: string }>>();
  const environmentId = (route.params?.environmentId ?? null) as EnvironmentId | null;
  const threadId = (route.params?.threadId ?? null) as ThreadId | null;
  const summary = usePmSummary(environmentId, threadId);
  if (summary === null || environmentId === null || threadId === null) return [];
  return [
    {
      accessibilityLabel: gt("Project manager"),
      icon: "list.number",
      separateBackground: false,
      onPress: () => navigation.navigate("PmSheet", { environmentId, threadId }),
    },
  ];
}

/** The Android home button's long-press: the New PM project picker. */
export function usePmOpenNewSheet() {
  const navigation = useNavigation();
  return () => navigation.navigate("PmNew");
}
