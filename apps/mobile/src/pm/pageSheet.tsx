import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { withPmPageTheme } from "@t3tools/pm";
import { useGT } from "gt-react-native";
import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";

import { AppText as Text } from "../components/ui/AppText";
import { SheetHeader } from "../components/ui/SheetHeader";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { runPm } from "./actions";
import { parsePmPageMessage, pmPageResultScript } from "./pm.logic";
import { pmCommands } from "./state";

type Target = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly pageId: string;
};

const BASE_URL = Platform.OS === "android" ? "https://localhost/" : "file:///";

/** A Live page with Ghostex's kit; its answers go back to the PM through the WebView bridge. */
export function PmPageSheet({ route }: StaticScreenProps<Target>) {
  const { environmentId, pageId } = route.params;
  const gt = useGT();
  const navigation = useNavigation();
  const { themeAppearance } = useAppearancePreferences();
  const view = useRef<WebView<object>>(null);
  const [page, setPage] = useState<{ readonly title: string; readonly html: string } | null>(null);
  const [failed, setFailed] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the page over the WebSocket when the sheet opens
  useEffect(() => {
    let cancelled = false;
    void runPm(
      pmCommands.pageGet,
      { environmentId, input: { pageId } },
      gt("Could not open the page"),
    ).then((loaded) => {
      if (cancelled) return;
      if (loaded === null) setFailed(true);
      else setPage({ title: loaded.title, html: loaded.html });
    });
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- gt only labels the failure; refetching on a language switch would drop answers in progress.
  }, [environmentId, pageId]);

  const onMessage = async (data: string) => {
    const submit = parsePmPageMessage(data);
    if (submit === null) return;
    const sent = await runPm(
      pmCommands.pageAnswer,
      { environmentId, input: { pageId, answers: submit.answers as never } },
      gt("Could not send your answers"),
    );
    view.current?.injectJavaScript(
      pmPageResultScript(
        submit.requestId,
        sent !== null,
        sent === null ? gt("Your answers were not sent.") : undefined,
      ),
    );
  };

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={page?.title ?? gt("Live page")} onClose={() => navigation.goBack()} />
      {page === null ? (
        failed ? (
          <Text className="p-6 text-center text-sm text-foreground-muted">
            {gt("This page could not be loaded.")}
          </Text>
        ) : null
      ) : (
        <WebView<object>
          ref={view}
          source={{
            html: withPmPageTheme(
              page.html,
              themeAppearance === "dark" ? "dark" : "light",
              "native",
            ),
            baseUrl: BASE_URL,
          }}
          originWhitelist={["*"]}
          setSupportMultipleWindows={false}
          style={{ flex: 1, backgroundColor: "transparent" }}
          onShouldStartLoadWithRequest={(request) =>
            request.url === "about:blank" || request.url === BASE_URL
          }
          onMessage={(event) => void onMessage(event.nativeEvent.data)}
        />
      )}
    </View>
  );
}
