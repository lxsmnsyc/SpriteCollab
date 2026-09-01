import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { SpriteAnim } from './anims.ts';
import { MINIMUM_ANIMS, missingCommon, missingMinimum } from './anims.ts';
import readAnimData from './anim-data.ts';
import type { Archive } from './archive.ts';
import readArchive from './archive.ts';
import type { Authors } from './credits.ts';
import readCreditNames from './credits.ts';
import type { Frames } from './frames.ts';
import { decodeFrames, encodeFrames } from './frames.ts';
import type { Derived, Refused } from './merge.ts';
import { decode } from './raster.ts';
import type { SheetData, SheetResult } from './sheet.ts';
import { buildSheet, layoutsFor } from './sheet.ts';
import type { CoatKey, Slot } from './slots.ts';
import type { Region } from './regions.ts';
import { pad, slotsOf, speciesIn } from './slots.ts';
import type { Tracker } from './tracker.ts';
import readTracker from './tracker.ts';
import verifySheet, { type Mismatch } from './verify.ts';
import type { Dropped, Index, Written } from './write.ts';
import {
  FILENAMES,
  outputPath,
  removeSource,
  staleCoats,
  updateIndex,
  writeSheet,
} from './write.ts';

/**
 * One run of the optimizer, from a list of species to a written tree.
 *
 * Kept apart from the command line so a test can run the whole thing
 * against a folder it made up, and so the reporting is a value rather
 * than a pile of `console.log` calls nobody can assert on.
 */

export interface RunOptions {
  /** Where the source folders are: the collection's `sprite`. */
  root: string;
  /** Where the compact tree goes. */
  output: string;
  /** The species to process, by their number. */
  species: number[];
  /** Whether every frame is cropped to the grid's content. */
  compact?: boolean;
  /** Whether a coat missing an animation its pair has gets it. */
  merge?: boolean;
  /** Whether every frame is read back off the sheet and compared. */
  verify?: boolean;
  /** Whether the source folders are deleted once the sheet checks out. */
  prune?: boolean;
  /**
   * Whether to check the sheets already written instead of building
   * them again. Packing and encoding are most of a run and neither
   * changes the answer, so a prune of a tree that is already built need
   * not pay for them.
   */
  check?: boolean;
  /**
   * Whether a form the collection has barely drawn is built anyway.
   *
   * Off, a form whose regular coat is short of one of the six
   * bare-minimum animations is left where it is: it cannot be put on
   * screen in a normal turn of play, so packing it and taking its
   * folder away buys nothing and loses the folder a later revision
   * would be finished in.
   */
  all?: boolean;
  /** Whether anything is written at all. */
  dryRun?: boolean;
  /** Where the collection's record of names is, where it is to be read. */
  tracker?: string;
  /** Where `credit_names.txt` is, so an author has a name and not a number. */
  creditNames?: string;
  /** The authors already read, so a run reads that table once. */
  authors?: Authors;
  /** The names already read, so a run reads the record once. */
  names?: Tracker;
  /** Called as each form finishes, for a command line to report on. */
  onSlot?: (report: SlotReport) => void;
  /** Called for each form left alone, for the same reason. */
  onSkip?: (report: SkippedSlot) => void;
  /** Called as each species finishes, once every form of it is done. */
  onSpecies?: (report: SpeciesReport) => void;
}

/**
 * How many frames carry each anchor.
 *
 * Reported because a marker read off the wrong colour does not fail
 * anything — the sheet still checks out pixel for pixel, and the anchor
 * is simply absent. Coverage is the only thing that shows it: every one
 * of these should be at or near every frame, and `center` reading 0%
 * is what a broken matcher looks like
 */
export interface Anchors {
  frames: number;
  shadow: number;
  center: number;
  head: number;
  left: number;
  right: number;
}

/** Every anchor of every frame of one sheet, counted. */
export function countAnchors(frames: Frames, into?: Anchors): Anchors {
  const held: Anchors = into ?? { frames: 0, shadow: 0, center: 0, head: 0, left: 0, right: 0 };

  for (const at of frames.indices) {
    const record = frames.records[at];

    if (record == null) {
      continue;
    }
    held.frames += 1;
    for (const key of ['shadow', 'center', 'head', 'left', 'right'] as const) {
      if (record[key] != null) {
        held[key] += 1;
      }
    }
  }
  return held;
}

/** What one form cost before and after, and whether it survived. */
export interface SlotReport {
  dex: number;
  form: number;
  path: string;
  coats: CoatKey[];
  width: number;
  height: number;
  /** Distinct pictures kept, against frames read. */
  pictures: number;
  frames: number;
  /** What the source folders weighed, and what the sheet does. */
  before: number;
  after: number;
  /** Which container each coat ended up in. */
  containers: string[];
  mismatches: Mismatch[];
  /** How many of its frames carry each anchor. */
  anchors: Anchors;
  /** Animations one coat gained by recolouring the other of its pair. */
  derived: Derived[];
  /** Animations one coat could not be given, and why. */
  refused: Refused[];
  /** Coat files this build did not write, and took away. */
  dropped: Dropped[];
  /** Which of the common animations the form has not got. */
  missing: SpriteAnim[];
  /** The files and folders taken away, where pruning was asked for. */
  removed: string[];
  /** Where the sheet was filed. */
  region: Region;
}

/**
 * One species, whole: what its folder weighed against what the tree
 * that replaced it does.
 *
 * A form's own numbers leave out anything the species folder holds
 * beside its sprites, and it is the folders on disk that a person is
 * actually trying to get rid of — so this is measured over the trees
 * themselves rather than added up from the forms
 */
export interface SpeciesReport {
  dex: number;
  /** What the collection calls it, where its record was read. */
  name: string | null;
  /**
   * The regions its forms were filed under. Usually one, but a species
   * with a regional form has that form filed elsewhere
   */
  regions: Region[];
  /** How many forms of it were built. */
  forms: number;
  /** Everything under `sprite/{dex}`, before any of it was taken away. */
  before: number;
  /** Everything under `compact/sprite/{dex}` once the run had written it. */
  after: number;
}

/** One form the run left where it was, and what it was short of. */
export interface SkippedSlot {
  dex: number;
  form: number;
  /** Which of the six its regular coat has not got. All six, where it has no regular coat. */
  missing: SpriteAnim[];
}

export interface RunReport {
  slots: SlotReport[];
  /** The forms below the bare minimum, which were not built. */
  skipped: SkippedSlot[];
  species: SpeciesReport[];
  /** Every anchor of every frame the run wrote, counted. */
  anchors: Anchors;
  failed: { dex: number; form: number; error: string }[];
  before: number;
  after: number;
}

/** What every file in one folder weighs, not counting its subfolders. */
function weigh(folder: string): number {
  let total = 0;

  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isFile()) {
      total += statSync(join(folder, entry.name)).size;
    }
  }
  return total;
}

/** What a whole folder tree weighs, or nothing where there is none. */
export function weighTree(folder: string): number {
  if (!existsSync(folder)) {
    return 0;
  }
  let total = 0;

  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);

    total += entry.isDirectory() ? weighTree(path) : statSync(path).size;
  }
  return total;
}

/** Every species the collection holds, or the ones that were asked for. */
export function speciesFor(root: string, asked: number[]): number[] {
  return asked.length > 0 ? [...new Set(asked)].sort((one, two) => one - two) : speciesIn(root);
}

/** Where one form's sheet is, out of the index that lists it. */
function builtAt(output: string, dex: number, form: number): string {
  const listing = join(output, 'index.json');

  if (!existsSync(listing)) {
    throw new Error(`${listing} is not there: build the tree before checking it`);
  }
  const index = JSON.parse(readFileSync(listing, 'utf8')) as Index;
  const slot = index.slots.find((one) => one.dex === dex && one.form === form);

  if (slot == null) {
    throw new Error(`${dex}/${form} is not built`);
  }
  return join(output, slot.path);
}

/**
 * One form: the sheet already written, read back and compared with the
 * folders it came from.
 *
 * The same check a build does, without the build. Packing and encoding
 * are most of the work of a run and neither of them decides whether the
 * sheet on disk draws what the folders draw, so a prune of a tree that
 * is already built does not have to pay for them — and, unlike a
 * rebuild, this leaves the sheets alone, so a coat somebody made by
 * hand is still there afterwards.
 */
function checkSlot(
  slot: Slot,
  archives: { key: CoatKey; archive: Archive }[],
  options: RunOptions,
): SlotReport {
  const folder = builtAt(options.output, slot.dex, slot.form);
  const meta = JSON.parse(readFileSync(join(folder, 'sheet.json'), 'utf8')) as SheetData;
  const frames = decodeFrames(readFileSync(join(folder, 'frames.bin')));
  const sheets = meta.coats
    .filter((key) => existsSync(join(folder, FILENAMES[key])))
    .map((key) => ({ key, raster: decode(readFileSync(join(folder, FILENAMES[key]))) }));
  const layouts = layoutsFor(archives, { compact: meta.compact, merge: options.merge });
  // A coat drawn in the folders that the sheet has not got is a coat
  // the check would pass over in silence, and it is the silence that
  // would let its folder be deleted
  const absent = slot.present.filter((key) => !sheets.some((one) => one.key === key));
  const mismatches: Mismatch[] = [
    ...absent.map((key) => ({ coat: key, anim: 'every', row: 0, column: 0, x: 0, y: 0 })),
    ...verifySheet(meta, frames, layouts, archives, sheets),
  ];
  const removed: string[] = [];
  // Weighed before anything is taken away, since that is what is about
  // to go
  const before = slot.present.reduce(
    (total, key) => total + weigh(join(options.root, slot.coats[key])),
    0,
  );
  const after = weighTree(folder);

  if (options.prune === true && mismatches.length === 0 && options.dryRun !== true) {
    for (const key of slot.present) {
      removed.push(...removeSource(options.root, join(options.root, slot.coats[key])));
    }
  }
  return {
    dex: slot.dex,
    form: slot.form,
    path: relative(options.output, folder),
    region: meta.region,
    coats: slot.present,
    width: meta.sheet.width,
    height: meta.sheet.height,
    pictures: meta.sheet.pictures.length,
    frames: frames.indices.length,
    before,
    after,
    containers: sheets.map((one) => one.key),
    mismatches,
    anchors: countAnchors(frames),
    derived: meta.derived,
    refused: [],
    dropped: [],
    missing: missingCommon(meta.anims.map((one) => one.anim)),
    removed,
  };
}

/**
 * Which of the bare minimum a form's regular coat is short of.
 *
 * Read out of `AnimData.xml` alone — a form is judged before anything
 * of it is decoded, so the ones that are not going to be built cost a
 * few kilobytes of XML rather than a sheet's worth of PNG.
 */
export function belowMinimum(root: string, slot: Slot): SpriteAnim[] {
  if (!slot.present.includes('regular')) {
    return MINIMUM_ANIMS;
  }
  const file = join(root, slot.coats.regular, 'AnimData.xml');
  const data = readAnimData(readFileSync(file, 'utf8'));

  return missingMinimum(data.anims.map((one) => one.anim));
}

/** One form: read, built, checked, written, and its source taken away. */
export function runSlot(slot: Slot, options: RunOptions): SlotReport {
  const archives = slot.present.map((key) => ({
    key,
    archive: readArchive(join(options.root, slot.coats[key]), options.authors),
  }));

  if (options.check === true) {
    return checkSlot(slot, archives, options);
  }
  const result: SheetResult = buildSheet(slot, archives, {
    compact: options.compact,
    merge: options.merge,
    names: options.names?.(slot.dex, slot.form),
  });
  const mismatches =
    options.verify === false
      ? []
      : verifySheet(
          result.meta,
          result.frames,
          result.layouts,
          archives,
          result.coats.map((coat) => ({ key: coat.key, raster: decode(coat.bytes) })),
        );
  const before = slot.present.reduce(
    (total, key) => total + weigh(join(options.root, slot.coats[key])),
    0,
  );
  const after =
    result.coats.reduce((total, coat) => total + coat.bytes.length, 0) +
    JSON.stringify(result.meta).length +
    encodeFrames(result.frames).length;
  let written: Written | null = null;
  const removed: string[] = [];
  const region = result.meta.region;

  // A dry run is how a change is looked at before it is made, so it
  // says what it would take away as well as what it would write
  const dropped =
    options.dryRun === true
      ? staleCoats(
          join(options.output, outputPath(region, slot.dex, slot.form)),
          new Set(result.coats.map((coat) => coat.key)),
        )
      : [];

  if (options.dryRun !== true) {
    written = writeSheet(options.output, slot, result);
    // Nothing is taken away on the strength of a sheet that did not
    // read back as what it replaced
    if (options.prune === true && mismatches.length === 0) {
      for (const key of slot.present) {
        removed.push(...removeSource(options.root, join(options.root, slot.coats[key])));
      }
    }
  }

  return {
    dex: slot.dex,
    form: slot.form,
    path: written?.entry.path ?? `${region}/${slot.dex}/${slot.form}`,
    region,
    coats: slot.present,
    width: result.width,
    height: result.height,
    pictures: result.pictures,
    frames: result.frameCount,
    before,
    after,
    containers: result.coats.map((coat) => `${coat.key}: ${coat.as}`),
    mismatches,
    anchors: countAnchors(result.frames),
    derived: result.meta.derived,
    refused: result.refused,
    dropped: written?.dropped ?? dropped,
    missing: missingCommon(result.meta.anims.map((one) => one.anim)),
    removed,
  };
}

/**
 * Every form of every species asked for.
 *
 * A form that throws is recorded and the run carries on: one broken
 * folder in a collection of a thousand should not cost the other nine
 * hundred and ninety-nine
 */
export default function run(options: RunOptions): RunReport {
  const slots: SlotReport[] = [];
  const skipped: SkippedSlot[] = [];
  const species: SpeciesReport[] = [];
  const failed: RunReport['failed'] = [];
  let wrote = false;
  // Read once for the whole run: the record is ten megabytes, and
  // every form of every species would otherwise read it again
  const names = options.names ?? (options.tracker == null ? undefined : readTracker(options.tracker));
  const authors =
    options.authors ??
    (options.creditNames == null ? undefined : readCreditNames(options.creditNames));

  for (const dex of speciesFor(options.root, options.species)) {
    // Measured before anything is built, since a pruning run is about
    // to take the folders this is weighing
    const before = weighTree(join(options.root, pad(dex)));
    let forms = 0;
    let built = 0;
    const regions = new Set<Region>();

    for (const slot of slotsOf(options.root, dex)) {
      try {
        const short = options.all === true ? [] : belowMinimum(options.root, slot);

        if (short.length > 0) {
          const missed: SkippedSlot = { dex: slot.dex, form: slot.form, missing: short };

          skipped.push(missed);
          options.onSkip?.(missed);
          continue;
        }
        const report = runSlot(slot, { ...options, names, authors });

        forms += 1;
        built += report.after;
        regions.add(report.region);
        slots.push(report);
        options.onSlot?.(report);
        // A check writes no sheet, so the index it would rebuild is
        // the one already there
        wrote ||= options.dryRun !== true && options.check !== true;
      } catch (error) {
        failed.push({
          dex: slot.dex,
          form: slot.form,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (forms > 0) {
      const report: SpeciesReport = {
        dex,
        name: names?.(dex, 0).name ?? null,
        regions: [...regions],
        forms,
        before,
        // A dry run has written nothing to weigh, so its own numbers
        // stand in for the tree it would have left. A species with a
        // regional form is filed in more than one place
        after:
          options.dryRun === true
            ? built
            : [...regions].reduce(
                (total, region) => total + weighTree(join(options.output, region, pad(dex))),
                0,
              ),
      };

      species.push(report);
      options.onSpecies?.(report);
    }
  }
  if (wrote) {
    updateIndex(options.output);
  }
  return {
    slots,
    skipped,
    species,
    anchors: slots.reduce(
      (total, slot) => {
        for (const key of ['frames', 'shadow', 'center', 'head', 'left', 'right'] as const) {
          total[key] += slot.anchors[key];
        }
        return total;
      },
      { frames: 0, shadow: 0, center: 0, head: 0, left: 0, right: 0 },
    ),
    failed,
    // The species trees, which take in whatever else the folders hold
    before: species.reduce((total, held) => total + held.before, 0),
    after: species.reduce((total, held) => total + held.after, 0),
  };
}
