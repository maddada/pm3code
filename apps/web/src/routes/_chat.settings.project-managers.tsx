// t3code-pm: the fork's own Settings page.
import { createFileRoute } from "@tanstack/react-router";

import { PmSettingsPanel } from "../pm/SettingsPanel";

export const Route = createFileRoute("/_chat/settings/project-managers")({
  component: PmSettingsPanel,
});
