// @effect-diagnostics nodeBuiltinImport:off globalFetch:off
/**
 * t3code-pm: the replay agent's `t3/mcp_call` frame, which upstream dropped. A frame
 * `{ name, arguments }` makes the agent call that T3 tool itself over its session's MCP server,
 * so the `pm` scenario drives the real `pm_*` tools.
 */
export const PM_MCP_CALL = "t3/mcp_call";

interface McpServer {
  readonly endpoint: string;
  readonly authorization: string;
}

const mcpServersBySession = new Map<string, McpServer>();

/** Keeps the T3 MCP server T3 hands the agent in session/new, through the stdio bridge's env. */
export function rememberPmMcpServer(sessionId: string, servers: unknown): void {
  if (!Array.isArray(servers)) return;
  for (const server of servers as ReadonlyArray<{
    env?: ReadonlyArray<{ name: string; value: string }>;
  }>) {
    const env = new Map((server.env ?? []).map((entry) => [entry.name, entry.value]));
    const endpoint = env.get("T3_ACP_MCP_ENDPOINT");
    const authorization = env.get("T3_ACP_MCP_AUTHORIZATION");
    if (endpoint !== undefined && authorization !== undefined) {
      mcpServersBySession.set(sessionId, { endpoint, authorization });
      return;
    }
  }
}

/** One MCP tools/call over streamable HTTP: initialize, initialized, then the call. */
async function callT3Tool(server: McpServer, name: string, args: unknown): Promise<unknown> {
  let sessionHeader: string | undefined;
  const post = async (body: object) => {
    const response = await fetch(server.endpoint, {
      method: "POST",
      headers: {
        authorization: server.authorization,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(sessionHeader === undefined ? {} : { "mcp-session-id": sessionHeader }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    });
    sessionHeader = response.headers.get("mcp-session-id") ?? sessionHeader;
    const text = await response.text();
    // A streamed answer carries the JSON-RPC message on a `data:` line.
    const data = text.split("\n").find((line) => line.startsWith("data:"));
    return text.length === 0 ? undefined : JSON.parse(data === undefined ? text : data.slice(5));
  };
  await post({
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t3-dev-replay", version: "1" },
    },
  });
  await post({ method: "notifications/initialized" });
  return post({ id: 2, method: "tools/call", params: { name, arguments: args } });
}

/** Runs a `t3/mcp_call` frame's tool call and logs a failure; the turn goes on either way. */
export async function playPmMcpCall(sessionId: string, params: unknown): Promise<void> {
  const call = params as { name: string; arguments?: unknown };
  const server = mcpServersBySession.get(sessionId);
  if (server === undefined) {
    process.stderr.write(`dev replay agent has no T3 MCP server for ${call.name}\n`);
    return;
  }
  const result = await callT3Tool(server, call.name, call.arguments ?? {}).catch(
    (error: unknown) => ({ error: String(error) }),
  );
  const failed = result as { error?: unknown; result?: { isError?: boolean } } | undefined;
  if (failed?.error !== undefined || failed?.result?.isError === true) {
    process.stderr.write(`dev replay agent: ${call.name} failed: ${JSON.stringify(result)}\n`);
  }
}
