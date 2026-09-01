import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { SpriteAnim } from './anims.ts';
import { missingCommon } from './anims.ts';
import { encodeFrames } from './frames.ts';
import type { Derived } from './merge.ts';
import type { Region } from './regions.ts';
import { REGIONS } from './regions.ts';
import type { SheetResult } from './sheet.ts';
import type { SheetData } from './sheet.ts';
import type { CoatKey, Slot } from './slots.ts';
import { COATS, pad } from './slots.ts';

/**
 * Where a finished sheet goes, and how the folders it replaces are
 * taken away.
 *
 * The output is filed by region, then by species and form — the last
 * two always written out even where the collection would have left them
 * off, so a reader can build a path from two numbers without knowing
 * the trailing-default rule the source folders follow.
 *
 * Filing by region is what makes the tree loadable in pieces: a game
 * set in one region wants that region's sheets and nothing else. A
 * regional form goes with the region it is named for rather than with
 * its dex number, so Alolan Raichu is under `alola` and not `kanto`.
 */

export const OUTPUT_ROOT = 'compact';

/** What each coat's drawing is called. */
const FILENAMES: Record<CoatKey, string> = {
  regular: 'regular.png',
  shiny: 'shiny.png',
  female: 'female.png',
  shinyFemale: 'shiny_female.png',
};

/** The folder one form's sheet goes in, relative to the output root. */
export function outputPath(region: Region, dex: number, form: number): string {
  return `${region}/${pad(dex)}/${pad(form)}`;
}

/** One entry of the index that lists what the compact tree holds. */
export interface IndexEntry {
  region: Region;
  dex: number;
  form: number;
  path: string;
  coats: CoatKey[];
  width: number;
  height: number;
  /**
   * What of this sheet is ours rather than the collection's, so the
   * whole tree can be checked without opening a thousand sheets. Same
   * shape as the sheet's own `derived`, and empty for most forms.
   */
  derived: Derived[];
  /**
   * Which of the common animations the sheet has not got. Empty for
   * nearly every form; a reader that needs all ten can skip the rest
   * without opening them.
   */
  missing: SpriteAnim[];
}

export interface Index {
  version: 1;
  /** How many forms each region holds, in the order the games came. */
  regions: { region: Region; forms: number }[];
  slots: IndexEntry[];
}

function write(path: string, body: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** A coat this build did not draw, whose file was in the folder. */
export interface Dropped {
  coat: CoatKey;
  /** Whether the sheet it replaces called that coat our own work. */
  ours: boolean;
}

/** What writing one form's sheet did. */
export interface Written {
  entry: IndexEntry;
  dropped: Dropped[];
}

/**
 * Which of a folder's coat files this build is not going to write.
 *
 * The packing is chosen afresh every run, so a coat left over from the
 * last one describes a layout that has moved: same filename, plausible
 * size, frames pointing at the wrong pixels. Nothing downstream would
 * catch it — the check reads back what was written, and both the sheet
 * and the index list only the coats that were. So they go, and the run
 * says which, because a coat the collection has no art for is one a
 * person made and `compact/EDITS.md` says how to make again.
 */
export function staleCoats(folder: string, keeping: Set<CoatKey>): Dropped[] {
  const before = join(folder, 'sheet.json');
  const held: Derived[] = existsSync(before)
    ? ((JSON.parse(readFileSync(before, 'utf8')) as SheetData).derived ?? [])
    : [];

  return COATS.map((coat) => coat.key)
    .filter((key) => !keeping.has(key) && existsSync(join(folder, FILENAMES[key])))
    .map((coat) => ({
      coat,
      ours: held.some((one) => one.coat === coat && one.anim == null),
    }));
}

/**
 * Writes one form's sheets and its description.
 *
 * The description is written without spacing: it is read by programs
 * and by nothing else, and indenting it is three times the bytes
 */
export function writeSheet(output: string, slot: Pick<Slot, 'dex' | 'form'>, result: SheetResult): Written {
  const path = outputPath(result.meta.region, slot.dex, slot.form);
  const folder = join(output, path);
  const dropped = staleCoats(folder, new Set(result.coats.map((coat) => coat.key)));

  for (const coat of result.coats) {
    write(join(folder, FILENAMES[coat.key]), coat.bytes);
  }
  for (const stale of dropped) {
    unlinkSync(join(folder, FILENAMES[stale.coat]));
  }
  write(join(folder, 'sheet.json'), JSON.stringify(result.meta));
  write(join(folder, 'frames.bin'), encodeFrames(result.frames));
  return {
    entry: {
      region: result.meta.region,
      dex: slot.dex,
      form: slot.form,
      path,
      coats: result.coats.map((coat) => coat.key),
      width: result.width,
      height: result.height,
      derived: result.meta.derived,
      missing: missingCommon(result.meta.anims.map((one) => one.anim)),
    },
    dropped,
  };
}

/** Every sheet under a compact tree, however it got there. */
function sheetsUnder(output: string): string[] {
  if (!existsSync(output)) {
    return [];
  }
  const found: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(folder, entry.name));
      } else if (entry.name === 'sheet.json') {
        found.push(join(folder, entry.name));
      }
    }
  };

  walk(output);
  return found;
}

/** One slot of the index, read back out of the sheet it describes. */
function entryOf(sheet: SheetData): IndexEntry {
  return {
    region: sheet.region,
    dex: sheet.dex,
    form: sheet.form,
    path: outputPath(sheet.region, sheet.dex, sheet.form),
    coats: sheet.coats,
    width: sheet.sheet.width,
    height: sheet.sheet.height,
    derived: sheet.derived,
    missing: missingCommon(sheet.anims.map((one) => one.anim)),
  };
}

/**
 * Writes the index the compact tree carries.
 *
 * Read back off the tree rather than accumulated across runs. A run is
 * usually a handful of species out of a thousand and the index
 * describes the tree, so the old way was to merge new entries into
 * what was already in the file — which meant the index could disagree
 * with the sheets and nothing would say so. Reading a thousand small
 * descriptions costs a moment and cannot drift.
 */
export function updateIndex(output: string): Index {
  const path = join(output, 'index.json');
  const slots = sheetsUnder(output)
    .map((file) => entryOf(JSON.parse(readFileSync(file, 'utf8')) as SheetData))
    // By region first, so the listing reads the way the tree is laid out
    .sort(
      (one, two) =>
        REGIONS.indexOf(one.region) - REGIONS.indexOf(two.region) ||
        one.dex - two.dex ||
        one.form - two.form,
    );
  const index: Index = {
    version: 1,
    regions: REGIONS.flatMap((region) => {
      const forms = slots.filter((slot) => slot.region === region).length;

      return forms === 0 ? [] : [{ region, forms }];
    }),
    slots,
  };

  write(path, JSON.stringify(index));
  return index;
}

/**
 * Takes away the folders a sheet was built from.
 *
 * Only the files are removed, and a folder only when nothing is left
 * in it. A species folder is also the base form's own drawing, so
 * deleting it outright would take every other form and coat of that
 * species with it — the emptied folders are pruned upwards instead,
 * stopping at the sprite root and at the first folder that still holds
 * something.
 */
export function removeSource(root: string, folder: string): string[] {
  const removed: string[] = [];

  if (!existsSync(folder)) {
    return removed;
  }
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isFile()) {
      unlinkSync(join(folder, entry.name));
      removed.push(relative(root, join(folder, entry.name)));
    }
  }
  let at = folder;

  while (at.startsWith(root) && at !== root && readdirSync(at).length === 0) {
    rmdirSync(at);
    removed.push(relative(root, at));
    at = dirname(at);
  }
  return removed;
}
