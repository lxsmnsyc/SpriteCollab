import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import readAnimData from './anim-data.ts';
import type { SpriteAnim } from './anims.ts';
import { SPRITE_ANIMS, spriteAnimOf } from './anims.ts';
import { sizeOf } from './png.ts';
import type { CoatKey, Slot } from './slots.ts';
import { COATS, pad, slotsOf, speciesIn } from './slots.ts';
import type { Region } from './regions.ts';
import regionOf from './regions.ts';
import type { Names, Tracker } from './tracker.ts';
import { outputPath } from './write.ts';

/**
 * What is actually drawn, and what the optimizer would do with it.
 *
 * The collection's own `tracker.json` records how far along a sprite is
 * as one number a moderator sets, which answers a different question
 * from the one somebody building against these sheets asks: which of
 * the four coats exist, which animations are drawn, which are drawn in
 * some coats and not others, and which of them anything downstream
 * supports at all.
 *
 * Nothing here decodes an image. An animation's grid is its frame size
 * out of `AnimData.xml` against the size in the PNG's header, which is
 * thirty-three bytes, so a report over the whole collection is a second
 * or two rather than the minutes a build takes.
 */

/** One coat of one form, and what it holds. */
export interface CoatStatus {
  key: CoatKey;
  /** Where it is, relative to the sprite root. */
  path: string;
  /** The supported animations it draws. */
  anims: SpriteAnim[];
  /** Animations it draws that nothing downstream supports, by name. */
  unsupported: string[];
  /**
   * Animations it draws on a grid the first coat's cannot be lined up
   * with — a different number of frames, rather than a different cell
   * size. These are left out of the sheet
   */
  misaligned: SpriteAnim[];
  /** Animations whose cell is a different size from the first coat's. */
  repadded: SpriteAnim[];
}

/** One form: its coats, and what they add up to. */
export interface FormStatus {
  dex: number;
  form: number;
  name: string | null;
  formName: string | null;
  /** Where the compact tree files it. */
  region: Region;
  coats: CoatStatus[];
  /** The coats that are missing, in the order they are filed. */
  absent: CoatKey[];
  /** Every supported animation any coat draws. */
  anims: SpriteAnim[];
  /** Supported animations that only some of the coats draw. */
  partial: SpriteAnim[];
  /** Supported animations nobody draws. */
  missing: SpriteAnim[];
  /** Whether the compact tree holds this form. */
  built: boolean;
  /**
   * Whether a source file has been touched since the sheet was written.
   * Nothing where there is no sheet to be older than anything
   */
  stale: boolean | null;
  /** How far along the collection's own record says it is, out of two. */
  complete: number | null;
}

/** One animation, in one coat's folder. */
interface Drawn {
  anim: SpriteAnim | null;
  name: string;
  /** The cell it is drawn on, where its description names one. */
  cell: { width: number; height: number } | null;
  columns: number;
  rows: number;
}

/** When the newest file under a folder was last written. */
function newestIn(folder: string): number {
  let newest = 0;

  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    newest = Math.max(newest, statSync(join(folder, entry.name)).mtimeMs);
  }
  return newest;
}

/** What one coat's folder draws, without decoding any of it. */
function drawingsIn(folder: string): Drawn[] {
  const data = readAnimData(readFileSync(join(folder, 'AnimData.xml'), 'utf8'));
  const sizes = new Map<SpriteAnim, { width: number; height: number }>();

  for (const anim of data.anims) {
    if (!sizes.has(anim.target) && anim.frameWidth > 0 && anim.frameHeight > 0) {
      sizes.set(anim.target, { width: anim.frameWidth, height: anim.frameHeight });
    }
  }
  const found: Drawn[] = [];

  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('-Anim.png')) {
      continue;
    }
    const name = entry.name.slice(0, -'-Anim.png'.length);
    const anim = spriteAnimOf(name);
    const cell = anim == null ? null : (sizes.get(anim) ?? null);
    let image: { width: number; height: number };

    try {
      image = sizeOf(readFileSync(join(folder, entry.name)).subarray(0, 33));
    } catch {
      continue;
    }
    found.push({
      anim,
      name,
      cell,
      columns: cell == null ? 1 : Math.max(Math.floor(image.width / cell.width), 1),
      rows: cell == null ? 1 : Math.max(Math.floor(image.height / cell.height), 1),
    });
  }
  return found.sort((one, two) => one.name.localeCompare(two.name));
}

/** Everything worth saying about one form. */
export function statusOf(
  root: string,
  output: string,
  slot: Slot,
  names?: Tracker,
  complete?: (dex: number, form: number) => number | null,
): FormStatus {
  const read = slot.present.map((key) => ({
    key,
    folder: join(root, slot.coats[key]),
    drawings: drawingsIn(join(root, slot.coats[key])),
  }));
  const base = read[0];
  const coats: CoatStatus[] = read.map((held) => {
    const supported = held.drawings.filter((drawn) => drawn.anim != null);

    return {
      key: held.key,
      path: slot.coats[held.key],
      anims: supported.map((drawn) => drawn.anim as SpriteAnim).sort((one, two) => one - two),
      unsupported: held.drawings
        .filter((drawn) => drawn.anim == null)
        .map((drawn) => drawn.name),
      misaligned: supported
        .filter((drawn) => {
          const against = base.drawings.find((other) => other.anim === drawn.anim);

          return (
            against != null && (against.columns !== drawn.columns || against.rows !== drawn.rows)
          );
        })
        .map((drawn) => drawn.anim as SpriteAnim),
      repadded: supported
        .filter((drawn) => {
          const against = base.drawings.find((other) => other.anim === drawn.anim);

          return (
            against?.cell != null &&
            drawn.cell != null &&
            (against.cell.width !== drawn.cell.width || against.cell.height !== drawn.cell.height)
          );
        })
        .map((drawn) => drawn.anim as SpriteAnim),
    };
  });
  const drawn = new Set(coats.flatMap((coat) => coat.anims));
  const held = names?.(slot.dex, slot.form);
  const region = regionOf(slot.dex, held?.formName);
  const folder = join(output, outputPath(region, slot.dex, slot.form));
  const sheet = join(folder, 'sheet.json');
  const built = existsSync(sheet);

  return {
    dex: slot.dex,
    form: slot.form,
    name: held?.name ?? null,
    formName: held?.formName ?? null,
    region,
    coats,
    absent: COATS.map((coat) => coat.key).filter((key) => !slot.present.includes(key)),
    anims: [...drawn].sort((one, two) => one - two),
    // Drawn by some coats and not others, which is a coat with a gap in
    // it rather than an animation nobody has done
    partial: [...drawn]
      .filter((anim) => coats.some((coat) => !coat.anims.includes(anim)))
      .sort((one, two) => one - two),
    missing: SPRITE_ANIMS.filter((anim) => !drawn.has(anim)),
    built,
    stale: built
      ? read.some((coat) => newestIn(coat.folder) > statSync(sheet).mtimeMs)
      : null,
    complete: complete?.(slot.dex, slot.form) ?? null,
  };
}

/** The record's own count of how far along a sprite is, out of two. */
export function completeness(path: string): (dex: number, form: number) => number | null {
  if (!existsSync(path)) {
    return () => null;
  }
  interface Node {
    sprite_complete?: number;
    subgroups?: Record<string, Node>;
  }
  const held = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Node>;

  return (dex, form) => {
    const species = held[pad(dex)];
    const node = form === 0 ? species?.subgroups?.[pad(0)] : species?.subgroups?.[pad(form)];

    return node?.sprite_complete ?? species?.sprite_complete ?? null;
  };
}

/** Every form of every species asked for, or of all of them. */
export default function statuses(
  root: string,
  output: string,
  species: number[],
  names?: Tracker,
  complete?: (dex: number, form: number) => number | null,
): FormStatus[] {
  const asked = species.length > 0 ? [...new Set(species)].sort((one, two) => one - two) : speciesIn(root);

  return asked.flatMap((dex) =>
    slotsOf(root, dex).map((slot) => statusOf(root, output, slot, names, complete)),
  );
}

export type { Names };
