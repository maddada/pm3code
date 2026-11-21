import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { runPmCommand } from "./actions";
import { clearMissionEdit, useMissionEditRequest } from "./missionEdit";
import { pmCommands, pmKey, usePmThreadDetail } from "./state";

type ThreadRef = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

/** Saves both fields; each change reaches the PM as one labelled message. */
export async function savePmMission(
  threadRef: ThreadRef,
  before: { readonly mission: string; readonly instructions: string },
  after: { readonly mission: string; readonly instructions: string },
  failureTitle: string,
): Promise<boolean> {
  const { environmentId, threadId } = threadRef;
  if (after.mission.trim() !== before.mission.trim()) {
    const saved = await runPmCommand(
      pmCommands.setMission,
      { environmentId, input: { pm: threadId, mission: after.mission } },
      failureTitle,
    );
    if (saved === null) return false;
  }
  if (after.instructions.trim() !== before.instructions.trim()) {
    const saved = await runPmCommand(
      pmCommands.setInstructions,
      { environmentId, input: { pm: threadId, instructions: after.instructions } },
      failureTitle,
    );
    if (saved === null) return false;
  }
  return true;
}

/** The row menu's "Edit mission…": the same two fields as the details panel's pencil. */
export function PmMissionDialog(props: { readonly threadRef: ThreadRef }) {
  const request = useMissionEditRequest();
  const open = request === pmKey(props.threadRef.environmentId, props.threadRef.threadId);
  const detail = usePmThreadDetail(props.threadRef.environmentId, props.threadRef.threadId, open);
  if (!open || detail === null) return null;
  return (
    <MissionDialogBody
      threadRef={props.threadRef}
      mission={detail.mission}
      instructions={detail.instructions}
    />
  );
}

function MissionDialogBody(props: {
  readonly threadRef: ThreadRef;
  readonly mission: string;
  readonly instructions: string;
}) {
  const gt = useGT();
  const [mission, setMission] = useState(props.mission);
  const [instructions, setInstructions] = useState(props.instructions);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const saved = await savePmMission(
      props.threadRef,
      props,
      { mission, instructions },
      gt("Could not save the mission"),
    );
    setSaving(false);
    if (saved) clearMissionEdit();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : clearMissionEdit())}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{gt("Edit mission")}</DialogTitle>
          <DialogDescription>
            {gt("The PM gets each change as a message, so its next turn knows.")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <Label htmlFor="pm-mission">{gt("Mission")}</Label>
            <Textarea
              id="pm-mission"
              value={mission}
              onChange={(event) => setMission(event.target.value)}
            />
            <Label htmlFor="pm-instructions">{gt("Standing instructions")}</Label>
            <Textarea
              id="pm-instructions"
              value={instructions}
              placeholder={gt("One per line.")}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => clearMissionEdit()}>
            {gt("Cancel")}
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {gt("Save")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
