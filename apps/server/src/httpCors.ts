import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";
import { PM_TRUSTED_DESKTOP_ORIGINS } from "@t3tools/pm/identity"; // t3code-pm:

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

export const DESKTOP_RENDERER_ORIGINS = PM_TRUSTED_DESKTOP_ORIGINS; // t3code-pm:

/** MCP refuses every browser Origin with 403, so the browser CORS layer must not answer for it. */
export const MCP_HTTP_PATH = "/mcp";
