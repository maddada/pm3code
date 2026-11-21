import { PM_WS_METHODS } from "@t3tools/contracts";

type PmMethod = (typeof PM_WS_METHODS)[keyof typeof PM_WS_METHODS];

/** Trace aggregate label for every `pm.*` method. */
export const PM_RPC_AGGREGATES = Object.fromEntries(
  Object.values(PM_WS_METHODS).map((method) => [method, "pm"]),
) as { readonly [K in PmMethod]: "pm" };
