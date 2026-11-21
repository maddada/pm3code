// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { describe, expect, it } from "@effect/vitest";

import { parseReplayTurns, SCENARIOS } from "./dev-replay-agent.ts";
import { PM_MCP_CALL } from "./dev-replay-pm.ts";

describe("dev replay agent pm scenario", () => {
  it("keeps the t3/mcp_call frames that drive the real pm_* tools", () => {
    const scenario = SCENARIOS.find((candidate) => candidate.id === "pm");
    expect(scenario).toBeDefined();
    const turns = parseReplayTurns(
      NodeFS.readFileSync(new URL(scenario!.file, import.meta.url), "utf8"),
    );
    const calls = turns.flatMap((turn) =>
      turn.frames.flatMap(({ frame }) =>
        frame.kind === "request" && frame.method === PM_MCP_CALL
          ? [(frame.params as { name: string }).name]
          : [],
      ),
    );
    expect(calls).toContain("pm_guide");
    expect(calls).toContain("pm_worker_start");
  });
});
