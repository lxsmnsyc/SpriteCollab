/**
 * Which region a sprite belongs to.
 *
 * The compact tree is filed by region because that is how anything
 * reading it wants to load: a game set in Kanto wants Kanto's sheets
 * and nothing else, and a thousand species in one directory is a
 * directory nobody can look at.
 *
 * A dex number settles it for most of them — the first hundred and
 * fifty-one are Kanto's, and each generation took the next stretch —
 * but not for the regional forms. An Alolan Raichu is dex 26, which is
 * Kanto's, and it belongs with Alola: it was drawn for that region and
 * it is that region's game that wants it. So the form's name is read
 * first, and the dex only where the name says nothing.
 *
 * Hisui has no dex range of its own, being Sinnoh some centuries
 * earlier, and exists here only as the region its forms are filed under.
 */

export type Region =
  | 'kanto'
  | 'johto'
  | 'hoenn'
  | 'sinnoh'
  | 'unova'
  | 'kalos'
  | 'alola'
  | 'galar'
  | 'hisui'
  | 'paldea'
  | 'misc';

/** The dex numbers each region covers, ends included. */
const RANGES: { region: Region; from: number; to: number }[] = [
  { region: 'kanto', from: 1, to: 151 },
  { region: 'johto', from: 152, to: 251 },
  { region: 'hoenn', from: 252, to: 386 },
  { region: 'sinnoh', from: 387, to: 493 },
  { region: 'unova', from: 494, to: 649 },
  { region: 'kalos', from: 650, to: 721 },
  { region: 'alola', from: 722, to: 809 },
  { region: 'galar', from: 810, to: 905 },
  { region: 'paldea', from: 906, to: 1025 },
];

/**
 * Every region there is, in the order the games came.
 *
 * `misc` is last and is where anything outside every range lands: the
 * collection numbers Missingno like a pokemon without its being one
 */
export const REGIONS: Region[] = [
  'kanto',
  'johto',
  'hoenn',
  'sinnoh',
  'unova',
  'kalos',
  'alola',
  'galar',
  'hisui',
  'paldea',
  'misc',
];

/**
 * A form whose name says which region it is from.
 *
 * Matched on the first word of the name, since the collection writes
 * `Galar_Alternate` for the second Galarian form of a species and
 * `Alola` for the plain one
 */
const REGIONAL: Record<string, Region | undefined> = {
  alola: 'alola',
  galar: 'galar',
  hisui: 'hisui',
  paldea: 'paldea',
};

/** The dex numbers one region covers, ends included, or nothing. */
export function spanOf(region: Region): [from: number, to: number] | null {
  const range = RANGES.find((one) => one.region === region);

  return range == null ? null : [range.from, range.to];
}

/**
 * Where a form is filed: the region its name gives, or the one its dex
 * number falls in
 */
export default function regionOf(dex: number, formName?: string | null): Region {
  const first = formName?.trim().split(/[_\s-]/)[0]?.toLowerCase();
  const named = first == null ? undefined : REGIONAL[first];

  if (named != null) {
    return named;
  }
  return RANGES.find((range) => dex >= range.from && dex <= range.to)?.region ?? 'misc';
}
