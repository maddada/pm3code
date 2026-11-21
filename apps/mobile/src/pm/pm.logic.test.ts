import { describe, expect, it } from "vite-plus/test";
import { pmKey } from "@t3tools/pm/client";

import {
  parsePmPageMessage,
  pmListedThreads,
  pmPageResultScript,
  pmWorkerPreview,
} from "./pm.logic";

const thread = (id: string) => ({ environmentId: "env", id });

describe("pmListedThreads", () => {
  it("drops PM workers, keyed like upstream's list, and keeps the array when none match", () => {
    const threads = [thread("pm"), thread("w1"), thread("other")];
    const workerOf = new Map([[pmKey("env" as never, "w1"), pmKey("env" as never, "pm")]]);
    expect(pmListedThreads(threads, workerOf).map((t) => t.id)).toEqual(["pm", "other"]);
    expect(pmListedThreads(threads, new Map())).toBe(threads);
    expect(pmListedThreads(threads, new Map([["env:gone", "env:pm"]]))).toBe(threads);
  });
});

describe("pmWorkerPreview", () => {
  it("shows working workers first, two at most, and counts the rest", () => {
    const workers = [
      { id: "a", working: false },
      { id: "b", working: true },
      { id: "c", working: false },
      { id: "d", working: true },
    ];
    const preview = pmWorkerPreview(workers, (worker) => worker.working);
    expect(preview.shown.map((worker) => worker.id)).toEqual(["b", "d"]);
    expect(preview.more).toBe(2);
    expect(pmWorkerPreview(workers.slice(0, 1), () => false).more).toBe(0);
  });
});

describe("Live page bridge", () => {
  it("accepts only kit submissions from the WebView", () => {
    expect(
      parsePmPageMessage(
        JSON.stringify({ type: "pm.page.submit", requestId: 3, answers: { Q1: "A" } }),
      ),
    ).toEqual({ requestId: 3, answers: { Q1: "A" } });
    expect(parsePmPageMessage(JSON.stringify({ type: "other" }))).toBeNull();
    expect(parsePmPageMessage("not json")).toBeNull();
  });

  it("answers the kit without letting an error message close the script", () => {
    const script = pmPageResultScript(3, false, "</script><b>");
    expect(script).not.toContain("</script>");
    expect(script).toContain('"requestId":3');
  });
});
