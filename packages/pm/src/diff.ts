const paragraphsOf = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

export interface PmParagraphDiff {
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

/** What `pm_guide` with `changes` returns: paragraphs added and removed since the last read. */
export function diffPmParagraphs(before: string, after: string): PmParagraphDiff {
  const old = new Set(paragraphsOf(before));
  const next = paragraphsOf(after);
  const kept = new Set(next);
  return {
    added: next.filter((paragraph) => !old.has(paragraph)),
    removed: [...old].filter((paragraph) => !kept.has(paragraph)),
  };
}
