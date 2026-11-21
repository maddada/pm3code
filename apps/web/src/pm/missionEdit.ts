import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";

/** The PM whose mission editor the row menu's "Edit mission…" asked to open. */
const missionEditRequestAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("pm-mission-edit-request"),
);

export const requestMissionEdit = (pmThreadKey: string) =>
  appAtomRegistry.set(missionEditRequestAtom, pmThreadKey);

export const clearMissionEdit = () => appAtomRegistry.set(missionEditRequestAtom, null);

export const useMissionEditRequest = (): string | null => {
  const request: unknown = useAtomValue(missionEditRequestAtom);
  return typeof request === "string" ? request : null;
};
