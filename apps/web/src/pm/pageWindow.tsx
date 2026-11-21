import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { PM_PAGE_RESULT, PM_PAGE_SUBMIT, withPmPageTheme } from "@t3tools/pm";
import { msg, useGT } from "gt-react";
import { EyeOffIcon, MoreHorizontalIcon, XIcon } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { m } from "../i18n/messages";
import { runPmCommand } from "./actions";
import { pmCommands, pmKey } from "./state";
import { closePmPage, useOpenPmPage } from "./uiState";

type ThreadRef = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/** The Live page window: floats over the chat, stays while the user keeps chatting. */
export function PmPageWindow(props: { readonly threadRef: ThreadRef }) {
  const open = useOpenPmPage();
  const key = pmKey(props.threadRef.environmentId, props.threadRef.threadId);
  if (open === null || open.threadKey !== key) return null;
  return <PageWindow key={open.pageId} threadRef={props.threadRef} pageId={open.pageId} />;
}

const isDark = () => document.documentElement.classList.contains("dark");

function PageWindow(props: { readonly threadRef: ThreadRef; readonly pageId: string }) {
  const gt = useGT();
  const frame = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<{ readonly title: string; readonly html: string } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const { environmentId } = props.threadRef;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the page over the WebSocket when the window opens
  useEffect(() => {
    let cancelled = false;
    void runPmCommand(
      pmCommands.pageGet,
      { environmentId, input: { pageId: props.pageId } },
      m(msg("Could not open the page")),
    ).then((loaded) => {
      if (!cancelled && loaded !== null)
        setPage({
          title: loaded.title,
          html: withPmPageTheme(loaded.html, isDark() ? "dark" : "light"),
        });
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, props.pageId]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the page's kit answers by postMessage from its sandboxed frame
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; requestId?: unknown; answers?: unknown } | null;
      if (event.source !== frame.current?.contentWindow || data?.type !== PM_PAGE_SUBMIT) return;
      const reply = (ok: boolean, error?: string) =>
        frame.current?.contentWindow?.postMessage(
          { type: PM_PAGE_RESULT, requestId: data.requestId, ok, error },
          "*",
        );
      void runPmCommand(
        pmCommands.pageAnswer,
        { environmentId, input: { pageId: props.pageId, answers: data.answers ?? null } },
        m(msg("Could not send your answers")),
      ).then((sent) => {
        reply(sent !== null, sent === null ? m(msg("Your answers were not sent.")) : undefined);
        if (sent !== null) window.setTimeout(closePmPage, 700);
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [environmentId, props.pageId]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const start = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent) =>
      setOffset({ x: moved.clientX - start.x, y: moved.clientY - start.y });
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const exportPage = () => {
    if (page === null) return;
    const url = URL.createObjectURL(new Blob([page.html], { type: "text/html" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${page.title.replace(/[^\w.-]+/g, "-").slice(0, 60) || "page"}.html`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const openInBrowser = () => {
    if (page === null) return;
    const url = URL.createObjectURL(new Blob([page.html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div
      data-pm-page-window=""
      role="dialog"
      aria-label={page?.title ?? gt("Live page")}
      className="absolute inset-x-6 top-4 bottom-28 z-30 flex resize flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div
        className="flex h-9 shrink-0 cursor-grab items-center gap-1.5 bg-card px-2.5"
        onPointerDown={startDrag}
      >
        <Button
          size="icon-xs"
          variant="glass"
          aria-label={gt("Close")}
          onClick={() => closePmPage()}
        >
          <XIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="glass"
          aria-label={gt("Hide")}
          onClick={() => closePmPage()}
        >
          <EyeOffIcon />
        </Button>
        <Menu>
          <MenuTrigger render={<Button size="icon-xs" variant="glass" aria-label={gt("More")} />}>
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup side="bottom" align="start">
            <MenuItem onClick={exportPage}>{gt("Export page")}</MenuItem>
            <MenuItem onClick={openInBrowser}>{gt("Open in browser")}</MenuItem>
          </MenuPopup>
        </Menu>
        <span className="min-w-0 flex-1 truncate text-center text-muted-foreground text-xs">
          {page?.title}
        </span>
      </div>
      {page === null ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
          {gt("Loading the page…")}
        </div>
      ) : (
        <iframe
          ref={frame}
          title={page.title}
          srcDoc={page.html}
          // No allow-same-origin: the page runs in an opaque origin and reaches nothing of ours.
          sandbox="allow-scripts allow-forms allow-popups"
          className="min-h-0 w-full flex-1 border-0 bg-transparent"
        />
      )}
    </div>
  );
}
