import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpriteAnim } from './anims.ts';
import { spriteAnimOf } from './anims.ts';
import type { Authors, Credit } from './credits.ts';
import { readCredits } from './credits.ts';
import type { Raster } from './raster.ts';
import { decode } from './raster.ts';

/**
 * One coat's folder, as the collection stores it.
 *
 * A sprite folder holds an `AnimData.xml` and, for every animation,
 * three images: the drawing, a `-Shadow` image whose blob marks where
 * the shadow sits, and an `-Offsets` image whose pure-channel pixels
 * mark the anchors. Subfolders of it are other coats and other forms,
 * which are slots of their own and are not read here.
 */

/** The three images one animation ships as. */
export interface SpriteImages {
  animation?: Raster;
  shadow?: Raster;
  offsets?: Raster;
}

/** Which of the three an image is, read off the end of its name. */
const KINDS: { suffix: string; key: keyof SpriteImages }[] = [
  { suffix: '-Anim.png', key: 'animation' },
  { suffix: '-Offsets.png', key: 'offsets' },
  { suffix: '-Shadow.png', key: 'shadow' },
];

export interface Archive {
  /** The text of `AnimData.xml`, unparsed. */
  animData: string;
  /** Every supported animation's images, by its number. */
  images: Map<SpriteAnim, SpriteImages>;
  /** Who drew it, or none where the folder has no `credits.txt`. */
  credits: Credit[];
}

/** Whether a folder is a sprite of its own rather than a place to put one. */
export function isSpriteFolder(directory: string): boolean {
  try {
    return readdirSync(directory).includes('AnimData.xml');
  } catch {
    return false;
  }
}

/**
 * Reads one coat's folder.
 *
 * An image whose name is not `{Anim}-{kind}.png` is left alone rather
 * than refused: the collection has stray files in it, and a folder is
 * described by its `AnimData.xml` rather than by what happens to sit
 * beside it
 */
export default function readArchive(directory: string, authors?: Authors): Archive {
  const images = new Map<SpriteAnim, SpriteImages>();
  let animData: string | undefined;
  let credits: Credit[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name === 'AnimData.xml') {
      animData = readFileSync(join(directory, entry.name), 'utf8');
      continue;
    }
    if (entry.name === 'credits.txt') {
      credits = readCredits(
        readFileSync(join(directory, entry.name), 'utf8')
          .split('\n')
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0),
        authors,
      );
      continue;
    }
    const kind = KINDS.find((known) => entry.name.endsWith(known.suffix));

    if (kind == null) {
      continue;
    }
    // An animation nothing downstream supports is left in the folder
    // rather than packed: a sheet is described in numbers
    const anim = spriteAnimOf(entry.name.slice(0, -kind.suffix.length));

    if (anim == null) {
      continue;
    }
    const held = images.get(anim) ?? {};

    held[kind.key] = decode(readFileSync(join(directory, entry.name)));
    images.set(anim, held);
  }

  if (animData == null) {
    throw new Error(`${directory} has no AnimData.xml`);
  }
  return { animData, images, credits };
}
