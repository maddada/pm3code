import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { PmThreadMenuState } from "./threadMenu.logic";
import type { AnyRouter } from "@tanstack/react-router";
import { msg, useGT } from "gt-react";
import { BriefcaseIcon } from "lucide-react";

import { toastManager } from "../components/ui/toast";
import { m, type MessageResolver } from "../i18n/messages";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useProjects } from "../state/entities";
import { registerCommands } from "../shortcuts/dispatcher";
import { readThreadShell } from "../state/entities";
import { createPmAndOpen } from "./actions";
import { requestMissionEdit } from "./missionEdit";
import { pmIndexAtom, pmKey, usePmIndex } from "./state";

let router: AnyRouter | null = null;

const navigate = (options: Parameters<Parameters<typeof createPmAndOpen>[0]["navigate"]>[0]) =>
  router?.navigate(options);

const openThread = (environmentId: EnvironmentId, threadId: ThreadId | string) =>
  router?.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: threadId as ThreadId },
  });

const newPm = (environmentId: EnvironmentId, projectId: ProjectId) =>
  createPmAndOpen({ environmentId, projectId, navigate });

/** The keybinding goes to the current thread's project; app-global, installed once at startup. */
export function installPmCommands(appRouter: AnyRouter): void {
  router = appRouter;
  registerCommands({
    "pm.new": (event) => {
      event.preventDefault();
      const params = (appRouter.state.matches.at(-1)?.params ?? {}) as {
        environmentId?: EnvironmentId;
        threadId?: ThreadId;
      };
      const shell =
        params.environmentId && params.threadId
          ? readThreadShell({ environmentId: params.environmentId, threadId: params.threadId })
          : null;
      if (shell === null || !appAtomRegistry.get(pmIndexAtom).enabled.has(shell.environmentId)) {
        toastManager.add({
          type: "info",
          title: m(
            msg(
              "Open a thread in a project first, or pick one with New PM in… in the command palette.",
            ),
          ),
        });
        return;
      }
      void newPm(shell.environmentId, shell.projectId);
    },
  });
}

export type { PmThreadMenuState } from "./threadMenu.logic";

export function runPmThreadAction(
  action: "pm:new" | "pm:edit-mission",
  state: PmThreadMenuState,
): void {
  if (action === "pm:new") {
    void newPm(state.environmentId, state.projectId);
    return;
  }
  requestMissionEdit(pmKey(state.environmentId, state.threadId));
  void openThread(state.environmentId, state.threadId);
}

type FolderGroup = {
  readonly environmentId: EnvironmentId;
  readonly displayName: string;
  readonly memberProjectRefs: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }>;
};

const folderProject = (group: FolderGroup) =>
  group.memberProjectRefs.find((ref) => ref.environmentId === group.environmentId);

/** The project folder's context menu item, under New thread. */
export function pmFolderMenuItems(group: FolderGroup, resolve: MessageResolver = m) {
  if (!appAtomRegistry.get(pmIndexAtom).enabled.has(group.environmentId) || !folderProject(group))
    return [];
  return [{ id: "pm:new-in-project" as const, label: resolve(msg("New PM")) }];
}

export function handlePmFolderMenuAction(action: string | null, group: FolderGroup): boolean {
  if (action !== "pm:new-in-project") return false;
  const project = folderProject(group);
  if (project !== undefined) void newPm(project.environmentId, project.projectId);
  return true;
}

/** "New PM in <current>" and "New PM in…" for the command palette. */
export function usePmPaletteItems(
  currentProject:
    | { readonly environmentId: EnvironmentId; readonly id: ProjectId; readonly title: string }
    | null
    | undefined,
) {
  const gt = useGT();
  const index = usePmIndex();
  const projects = useProjects().filter((project) => index.enabled.has(project.environmentId));
  if (projects.length === 0) return [];
  const icon = <BriefcaseIcon className="size-4 text-muted-foreground" />;
  const current =
    currentProject != null && index.enabled.has(currentProject.environmentId)
      ? [
          {
            kind: "action" as const,
            value: "action:pm-new",
            searchTerms: ["new pm", "project manager", currentProject.title],
            title: gt("New PM in {project}", { project: currentProject.title }),
            icon,
            shortcutCommand: "pm.new" as const,
            run: async () => newPm(currentProject.environmentId, currentProject.id),
          },
        ]
      : [];
  return [
    ...current,
    {
      kind: "submenu" as const,
      value: "action:pm-new-in",
      searchTerms: ["new pm", "project manager", "project"],
      title: gt("New PM in…"),
      icon,
      addonIcon: icon,
      groups: [
        {
          value: "pm-new-in",
          label: gt("Projects"),
          items: projects.map((project) => ({
            kind: "action" as const,
            value: `pm-new-in:${project.environmentId}:${project.id}`,
            searchTerms: [project.title],
            title: project.title,
            icon,
            run: async () => newPm(project.environmentId, project.id),
          })),
        },
      ],
    },
  ];
}
