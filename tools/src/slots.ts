import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isSpriteFolder } from './archive.ts';

/**
 * Where the collection keeps a sprite, and which sprites there are.
 *
 * A sprite is filed under four numbers — the species, the form, the
 * coat and the gender — each written as four digits, each a folder
 * inside the last. Every one of the four has a default of `0000`, and
 * the defaults are not written down: a folder path stops at the last
 * number that is not one. So Bulbasaur is `sprite/0001`, his shiny is
 * `sprite/0001/0000/0001`, and Pikachu's Libre form is `sprite/0025/0006`.
 *
 * The drawings of one form are read together, because they share one
 * description and are deduplicated against each other, so a slot here is
 * a form and the folders that draw it.
 */

/** The four drawings of a form, in the order they are filed. */
export const COATS = [
  { key: 'regular', shiny: 0, gender: 0 },
  { key: 'shiny', shiny: 1, gender: 0 },
  { key: 'female', shiny: 0, gender: 2 },
  { key: 'shinyFemale', shiny: 1, gender: 2 },
] as const;

/**
 * Which gender folder each coat is under.
 *
 * The gender level has three values, not two: `0000` is the drawing
 * used whatever the pokemon is, `0002` is one drawn for females alone,
 * and `0001` for males. Only Xatu and Camerupt have a male drawing, and
 * neither has a female one — because for them the `0000` drawing *is*
 * the female, with the male filed beside it.
 *
 * So a form with a male drawing is read the other way round: the male
 * folder is the ordinary coat, and the one that would otherwise be
 * ordinary is the female. That keeps four coats meaning the same four
 * things everywhere rather than adding two more that two species use
 */
const SEXED: Record<CoatKey, number> = {
  regular: 1,
  shiny: 1,
  female: 0,
  shinyFemale: 0,
};

export type CoatKey = (typeof COATS)[number]['key'];

/** A number as the collection writes it. */
export function pad(value: number): string {
  return Math.trunc(value).toString().padStart(4, '0');
}

/**
 * The folder one drawing lives in, relative to the sprite root.
 *
 * The trailing defaults are dropped rather than written, which is the
 * convention the collection already follows and the reason a species
 * with one form and one coat is a single folder
 */
export function spritePath(dex: number, form: number, shiny: number, gender: number): string {
  const parts = [dex, form, shiny, gender];

  while (parts.length > 1 && parts[parts.length - 1] === 0) {
    parts.pop();
  }
  return parts.map(pad).join('/');
}

/** One form, and wherever each of its drawings is. */
export interface Slot {
  dex: number;
  form: number;
  /** The path each coat would be at, whether or not it is there. */
  coats: Record<CoatKey, string>;
  /** The coats that are actually drawn, in the order above. */
  present: CoatKey[];
}

/** The slot for one form, with its coats looked up on disk. */
export function slotAt(root: string, dex: number, form: number): Slot {
  const sexed = isSexed(root, dex, form);
  const coats = Object.fromEntries(
    COATS.map((coat) => [
      coat.key,
      spritePath(dex, form, coat.shiny, sexed ? SEXED[coat.key] : coat.gender),
    ]),
  ) as Record<CoatKey, string>;

  return {
    dex,
    form,
    coats,
    present: COATS.map((coat) => coat.key).filter((key) => isSpriteFolder(join(root, coats[key]))),
  };
}

/** Every folder name under one path that is four digits. */
function numberedFolders(directory: string): number[] {
  let entries: string[];

  try {
    entries = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^[0-9]{4}$/.test(name))
    .map((name) => Number.parseInt(name, 10))
    .sort((one, two) => one - two);
}

/** Whether any coat of one form is drawn, under any gender. */
function drawnAt(root: string, dex: number, form: number): boolean {
  return [0, 1, 2].some((gender) =>
    [0, 1].some((shiny) => isSpriteFolder(join(root, spritePath(dex, form, shiny, gender)))),
  );
}

/** Whether this form has a drawing for males, which changes what `0000` is. */
function isSexed(root: string, dex: number, form: number): boolean {
  return [0, 1].some((shiny) => isSpriteFolder(join(root, spritePath(dex, form, shiny, 1))));
}

/**
 * Every form of one species that is drawn at all.
 *
 * A form counts when **any** of its four coats is drawn, not when its
 * ordinary one is. That is not a nicety: Raichu's Altcolor and Muk's
 * Altcolor exist only as a shiny, with no ordinary coat under them at
 * all, and asking for the ordinary one skips both of them silently.
 *
 * The candidates are the numbered folders under the species, plus the
 * base form, which is not a folder of its own — its ordinary coat is
 * the species folder itself, and `0000` beside it is where its shiny
 * and female live rather than a form of its own
 */
export function formsOf(root: string, dex: number): number[] {
  const species = join(root, pad(dex));
  const candidates = [...new Set([0, ...numberedFolders(species)])].sort((one, two) => one - two);

  return candidates.filter((form) => drawnAt(root, dex, form));
}

/** Every species in the collection, in order. */
export function speciesIn(root: string): number[] {
  return numberedFolders(root);
}

/** Every slot of one species, base form first. */
export function slotsOf(root: string, dex: number): Slot[] {
  return formsOf(root, dex)
    .map((form) => slotAt(root, dex, form))
    .filter((slot) => slot.present.length > 0);
}
