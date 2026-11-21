import { msg } from "gt-react";

export const PM_SETTINGS_PATH = "/settings/project-managers" as const;

/** The PM page's entries in Settings search. */
export const PM_SETTINGS_SEARCH_ITEMS = [
  {
    id: "project-managers",
    title: msg("Project Managers (t3code-pm)"),
    to: PM_SETTINGS_PATH,
    searchTerms: [msg("pm project manager coordinator workers turn off on")],
  },
  {
    id: "pm-playbook-overrides",
    title: msg("Playbook overrides"),
    to: PM_SETTINGS_PATH,
    searchTerms: [msg("pm project manager playbook rules every pm")],
  },
] as const;

/** The keybinding's label in Settings, Keybindings. */
export const PM_NEW_COMMAND_LABEL = msg("Project Manager: New");

export const PM_SETTINGS_LABEL = msg("Project managers");
