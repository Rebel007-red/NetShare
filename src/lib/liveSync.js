import DiffMatchPatch from 'diff-match-patch';

/**
 * Client half of live editing. The server merges patches in
 * server/lib/notes.js (syncNote); keep the match settings below identical to
 * the ones there, because the client uses the same fuzzy matching to re-apply
 * what the user typed while a request was in flight.
 */
const dmp = new DiffMatchPatch();
dmp.Match_Distance = 20000;
dmp.Match_Threshold = 0.4;
dmp.Patch_DeleteThreshold = 0.5;

/** The edit that turns `from` into `to`, as text the server can apply. */
export function makePatch(from, to) {
  if (from === to) return '';
  return dmp.patch_toText(dmp.patch_make(from, to));
}

/** Applies a patch to `text`; hunks that no longer fit are dropped. */
export function applyPatch(patchText, text) {
  if (!patchText) return text;
  const [merged] = dmp.patch_apply(dmp.patch_fromText(patchText), text);
  return merged;
}

/**
 * Where a caret at `position` in `before` lands in `after`, so remote edits
 * above the cursor do not make it jump.
 */
export function mapPosition(before, after, position) {
  if (before === after) return position;
  const diffs = dmp.diff_main(before, after);
  return dmp.diff_xIndex(diffs, position);
}

/**
 * Random id for a tab or a request. getRandomValues is used instead of
 * randomUUID because the latter needs a secure context, and internal tools are
 * often served over plain http.
 */
export function randomId(bytes = 12) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}
