import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { PM_PLAYBOOK } from "@t3tools/pm";
import { useGT } from "gt-react";
import { useState } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { useSearchableSetting } from "../components/settings/settingsSearch";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { usePrimaryEnvironment } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironmentScope } from "../state/session";
import { runPmCommand } from "./actions";
import { pmCommands, pmSettingsQuery } from "./state";

/** Settings, Project managers: the switch and the playbook overrides every PM follows. */
export function PmSettingsPanel() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const environmentId = usePrimaryEnvironment()?.environmentId ?? null;
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const query = useEnvironmentQuery(
    environmentId === null ? null : pmSettingsQuery({ environmentId, input: {} }),
  );
  const settings = query.data;
  const [overrides, setOverrides] = useState<string | null>(null);
  const [playbookOpen, setPlaybookOpen] = useState(false);
  const save = async (input: {
    readonly enabled?: boolean;
    readonly playbookOverrides?: ReadonlyArray<string>;
  }) => {
    if (environmentId === null) return;
    const saved = await runPmCommand(
      pmCommands.settingsSet,
      { environmentId, input },
      gt("Could not save the setting"),
    );
    if (saved !== null) query.refresh();
  };
  const overridesText = overrides ?? settings?.playbookOverrides.join("\n") ?? "";
  return (
    <SettingsPageContainer>
      <SettingsSection id="project-managers" title={gt("Project managers")}>
        <SettingsRow
          {...searchableSetting("project-managers")}
          description={gt(
            "Adds Project Manager threads: they plan work in a project, start worker threads and follow them. Turning it off hides every PM view, tool and watcher; PM threads show as normal threads, and nothing is deleted.",
          )}
          control={
            <Switch
              checked={settings?.enabled ?? false}
              disabled={settings === null || !canWrite}
              onCheckedChange={(checked) => void save({ enabled: Boolean(checked) })}
              aria-label={gt("Project Managers (t3code-pm)")}
            />
          }
        />
      </SettingsSection>
      <SettingsSection id="pm-playbook" title={gt("Playbook")}>
        <SettingsRow
          title={gt("Shipped playbook")}
          description={gt(
            "Version {version}. Every PM reads it when it starts, after a compaction, and when the version goes up.",
            { version: settings?.playbookVersion ?? 1 },
          )}
          control={
            <Button size="compact" variant="outline" onClick={() => setPlaybookOpen(true)}>
              {gt("View")}
            </Button>
          }
        />
        <SettingsRow
          {...searchableSetting("pm-playbook-overrides")}
          description={gt(
            "Rules added after the playbook for every PM, one per line. A PM's own standing instructions come after these.",
          )}
        >
          <div className="mt-2 flex flex-col gap-2">
            <Textarea
              value={overridesText}
              disabled={settings === null || !canWrite}
              aria-label={gt("Playbook overrides")}
              placeholder={gt("Brief workers in English, reply to me in short sections.")}
              onChange={(event) => setOverrides(event.target.value)}
            />
            <div className="flex justify-end">
              <Button
                size="compact"
                disabled={overrides === null || !canWrite}
                onClick={() =>
                  void save({
                    playbookOverrides: overridesText
                      .split("\n")
                      .filter((rule) => rule.trim().length > 0),
                  }).then(() => setOverrides(null))
                }
              >
                {gt("Save overrides")}
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>
      <Dialog open={playbookOpen} onOpenChange={setPlaybookOpen}>
        <DialogPopup className="max-h-[80dvh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{gt("PM playbook")}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed">{PM_PLAYBOOK}</pre>
          </DialogPanel>
          <DialogFooter>
            <Button onClick={() => setPlaybookOpen(false)}>{gt("Done")}</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SettingsPageContainer>
  );
}
