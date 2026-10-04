import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isShowable, spriteAnimName } from './anims.ts';
import type { Derived } from './merge.ts';
import type { Polyfilled } from './polyfill.ts';
import { POLYFILLS, polyfillCoats } from './polyfill.ts';
import { decode } from './raster.ts';
import { buildSheet } from './sheet.ts';
import unpack from './unpack.ts';
import verifySheet, { type Mismatch } from './verify.ts';
import type { Index } from './write.ts';
import { updateIndex, writeSheet } from './write.ts';

/**
 * Polyfilling a sheet that is already built.
 *
 * A build polyfills a form from its folders, but most forms' folders
 * were taken away when their region was built, and a sheet made by
 * hand never had any. This works from the sheet instead: unpacked into
 * folders, given what it has not drawn, built again and checked against
 * what it was unpacked from. A coat made by hand survives, since the
 * sheet it is read out of is the one it is written back into.
 */

export interface Filled {
  path: string;
  /** What was made, by coat. Empty where there was nothing to add. */
  added: Polyfilled[];
  mismatches: Mismatch[];
}

/** Fills one built sheet, or says what it would fill under `dryRun`. */
export function fillSheet(output: string, path: string, dryRun = false): Filled {
  const folder = join(output, path);
  const { meta, archives: read } = unpack(folder);

  if (!isShowable(meta.anims.map((one) => one.anim))) {
    return { path, added: [], mismatches: [] };
  }
  const { archives, polyfilled: added } = polyfillCoats(read);

  if (added.length === 0 || dryRun) {
    return { path, added, mismatches: [] };
  }
  const result = buildSheet({ dex: meta.dex, form: meta.form }, archives, {
    compact: meta.compact,
    names: { name: meta.name, formName: meta.formName },
  });
  const mismatches = verifySheet(
    result.meta,
    result.frames,
    result.layouts,
    archives,
    result.coats.map((coat) => ({ key: coat.key, raster: decode(coat.bytes) })),
  );

  if (mismatches.length > 0) {
    return { path, added, mismatches };
  }
  // The rebuild sees every coat as drawn, so what the sheet already said
  // was ours has to be carried across rather than worked out again
  const same = (one: Derived, two: Derived): boolean =>
    one.coat === two.coat && one.anim === two.anim && one.from === two.from;

  result.meta.region = meta.region;
  result.meta.derived = [
    ...meta.derived,
    ...result.meta.derived.filter((one) => !meta.derived.some((held) => same(held, one))),
  ];
  result.meta.polyfilled = [...(meta.polyfilled ?? []), ...added];
  writeSheet(output, { dex: meta.dex, form: meta.form }, result);
  return { path, added, mismatches };
}

/** Fills every built sheet missing one of the animations polyfilling makes. */
export default function fillTree(
  output: string,
  options: { species?: number[]; dryRun?: boolean } = {},
): Filled[] {
  const listing = join(output, 'index.json');

  if (!existsSync(listing)) {
    throw new Error(`${listing} is not there: build the tree first`);
  }
  const index = JSON.parse(readFileSync(listing, 'utf8')) as Index;
  const filled = index.slots
    .filter((slot) => options.species == null || options.species.includes(slot.dex))
    .filter((slot) => slot.missing.some((anim) => POLYFILLS.includes(anim)))
    .map((slot) => fillSheet(output, slot.path, options.dryRun));

  if (options.dryRun !== true && filled.some((one) => one.added.length > 0 && one.mismatches.length === 0)) {
    updateIndex(output);
  }
  return filled;
}

/** One line a sheet, for a command line. */
export function describe(one: Filled): string {
  const made = [...new Set(one.added.map((held) => held.anim))].map(spriteAnimName).join(' ');

  return one.mismatches.length > 0
    ? `${one.path}  not written: ${one.mismatches.length} frames did not read back`
    : `${one.path}  ${made.length > 0 ? made : 'nothing to make'}`;
}
