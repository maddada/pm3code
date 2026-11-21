import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { preparePmPage } from "@t3tools/pm";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { PmPageWindow } from "./pageWindow";
import { pmKey } from "./state";
import { closePmPage, openPmPage } from "./uiState";

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ readonly label: string; readonly value: unknown }>,
  html: "",
}));

vi.mock(import("./actions"), () => ({
  createPmAndOpen: vi.fn(),
  runPmCommand: vi.fn(
    async (command: { readonly label: string }, value: unknown): Promise<never> => {
      mocks.calls.push({ label: command.label, value });
      return (
        command.label.endsWith("page-get")
          ? { pageId: "page-1", title: "Icons", html: mocks.html }
          : {}
      ) as never;
    },
  ),
}));

const environmentId = EnvironmentId.make("environment:pm-page");
const threadId = ThreadId.make("pm-page-thread");

// The page answers through the kit's own `ghostex.submit`, then tells the test it heard back.
const PAGE = `<p>Pick one</p><script>
window.ghostex.submit({ Q1: "Round" }).then(
  () => parent.postMessage({ type: "test.page.sent" }, "*"),
  (error) => parent.postMessage({ type: "test.page.failed", error: String(error) }, "*"),
);
</script>`;

function setup() {
  mocks.calls.length = 0;
  mocks.html = preparePmPage(PAGE, {
    answered: false,
    answers: null,
    answeredAt: null,
    awaitsSeen: false,
  });
  closePmPage();
}

it("sends a sandboxed page's answers to the PM and tells the page they arrived", async () => {
  setup();
  const heard: Array<string> = [];
  const listen = (event: MessageEvent) => {
    const type = (event.data as { type?: unknown } | null)?.type;
    if (typeof type === "string" && type.startsWith("test.page.")) heard.push(type);
  };
  window.addEventListener("message", listen);
  try {
    openPmPage({ threadKey: pmKey(environmentId, threadId), pageId: "page-1" });
    await using screen = await render(
      <RegistryContext value={appAtomRegistry}>
        <PmPageWindow threadRef={{ environmentId, threadId }} />
      </RegistryContext>,
      {
        // The window takes its thread from props; it never reads the route.
        router: false,
      },
    );
    await vi.waitFor(() => expect(heard).toEqual(["test.page.sent"]));
    expect(mocks.calls.map((call) => call.label)).toEqual([
      "environment-data:pm:page-get",
      "environment-data:pm:page-answer",
    ]);
    expect(mocks.calls[1]?.value).toEqual({
      environmentId,
      input: { pageId: "page-1", answers: { Q1: "Round" } },
    });
    // A sent page closes its window, as Ghostex's floating page does.
    await expect.element(screen.getByTitle("Icons")).not.toBeInTheDocument();
  } finally {
    window.removeEventListener("message", listen);
  }
});
