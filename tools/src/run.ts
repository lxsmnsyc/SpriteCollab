import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import readArchive from './archive.ts';
import type { Authors } from './credits.ts';
import readCreditNames from './credits.ts';
import type { Frames } from './frames.ts';
import { encodeFrames } from './frames.ts';
import { decode } from './raster.ts';
import type { SheetResult } from './sheet.ts';
import { buildSheet } from './sheet.ts';
import type { CoatKey, Slot } from './slots.ts';
import type { Region } from './regions.ts';
import { pad, slotsOf, speciesIn } from './slots.ts';
import type { Tracker } from './tracker.ts';
import readTracker from './tracker.ts';
import verifySheet, { type Mismatch } from './verify.ts';
import type { IndexEntry } from './write.ts';
import { removeSource, updateIndex, writeSheet } from './write.ts';

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
  /** Whether every frame is read back off the sheet and compared. */
  verify?: boolean;
  /** Whether the source folders are deleted once the sheet checks out. */
  prune?: boolean;
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

export interface RunReport {
  slots: SlotReport[];
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

/** One form: read, built, checked, written, and its source taken away. */
export function runSlot(slot: Slot, options: RunOptions): SlotReport {
  const archives = slot.present.map((key) => ({
    key,
    archive: readArchive(join(options.root, slot.coats[key]), options.authors),
  }));
  const result: SheetResult = buildSheet(slot, archives, {
    compact: options.compact,
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
  let entry: IndexEntry | null = null;
  const removed: string[] = [];
  const region = result.meta.region;

  if (options.dryRun !== true) {
    entry = writeSheet(options.output, slot, result);
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
    path: entry?.path ?? `${region}/${slot.dex}/${slot.form}`,
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
  const species: SpeciesReport[] = [];
  const failed: RunReport['failed'] = [];
  const written: IndexEntry[] = [];
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
        const report = runSlot(slot, { ...options, names, authors });

        forms += 1;
        built += report.after;
        regions.add(report.region);
        slots.push(report);
        options.onSlot?.(report);
        if (options.dryRun !== true) {
          written.push({
            region: report.region,
            dex: slot.dex,
            form: slot.form,
            path: report.path,
            coats: report.coats,
            width: report.width,
            height: report.height,
          });
        }
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
  if (written.length > 0) {
    updateIndex(options.output, written);
  }
  return {
    slots,
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
