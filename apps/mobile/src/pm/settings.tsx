import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react-native";

import { ListToggleRow } from "../components/ui/ListToggleRow";
import { SettingsSection } from "../features/settings/components/SettingsSection";
import { useEnvironmentServerConfig } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { runPm } from "./actions";
import { pmCommands, pmSettingsQuery } from "./state";

/** The environment's PM switch. Off hides every PM view; nothing is deleted. */
export function PmSettingsSection(props: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const config = useEnvironmentServerConfig(props.environmentId);
  const served = config?.environment.capabilities.pm === true;
  const query = useEnvironmentQuery(
    served ? pmSettingsQuery({ environmentId: props.environmentId, input: {} }) : null,
  );
  if (!served || query.data === null) return null;
  return (
    <SettingsSection
      title={gt("Project managers")}
      footer={gt(
        "Off hides PM views, tools and watchers on this environment. PM threads stay as normal threads and nothing is deleted.",
      )}
    >
      <ListToggleRow
        icon="list.number"
        label={gt("Project managers (t3code-pm)")}
        value={query.data.enabled}
        onValueChange={async (enabled) => {
          const saved = await runPm(
            pmCommands.settingsSet,
            { environmentId: props.environmentId, input: { enabled } },
            gt("Could not save the setting"),
          );
          if (saved !== null) query.refresh();
        }}
      />
    </SettingsSection>
  );
}
