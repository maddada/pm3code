// Pure: upstream's thread menu logic imports this, and its tests run without React.
import type { ContextMenuItem, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

export type PmThreadActionMenuId = "pm:new" | "pm:edit-mission";

export interface PmThreadMenuState {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly projectLabel: string | null;
  /** PMs are on where this thread lives. */
  readonly enabled: boolean;
  readonly isPm: boolean;
}

/** "New PM in <project>" beside Filter by project, and "Edit mission…" on a PM's own row. */
export function pmThreadMenuItems(
  state: PmThreadMenuState | undefined,
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<PmThreadActionMenuId>> {
  if (state === undefined || !state.enabled) return [];
  const { isPm } = state;
  return [
    ...(isPm
      ? [{ id: "pm:edit-mission" as const, label: resolve(msg("Edit mission…")), icon: "pencil" }]
      : []),
    {
      id: "pm:new" as const,
      label: state.projectLabel
        ? resolve(msg("New PM in {project}", { project: state.projectLabel }))
        : resolve(msg("New PM")),
      icon: "briefcase",
    },
  ];
}

const PM_WORDING: Record<string, string> = {
  pin: msg("Pin PM"),
  unpin: msg("Unpin PM"),
  rename: msg("Rename PM"),
  archive: msg("Archive PM"),
  delete: msg("Delete PM…"),
};

/** A PM's row keeps upstream's menu, worded for the PM where the item acts on it. */
export function pmRelabel<I extends string>(
  state: PmThreadMenuState | undefined,
  items: ReadonlyArray<ContextMenuItem<I>>,
  resolve: MessageResolver = m,
): ReadonlyArray<ContextMenuItem<I>> {
  if (state?.isPm !== true) return items;
  return items.map((item) => {
    const wording = PM_WORDING[item.id];
    return wording === undefined ? item : { ...item, label: String(resolve(wording)) };
  });
}
