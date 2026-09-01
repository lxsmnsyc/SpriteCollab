import type { AnimData } from './anim-data.ts';
import type { Archive } from './archive.ts';
import type { SpriteAnim } from './anims.ts';
import type { Image } from './png.ts';
import type { Raster } from './raster.ts';
import { learnAll, recolor } from './recolor.ts';
import type { CoatKey } from './slots.ts';

/**
 * Carrying an animation from one coat to the other one of its pair.
 *
 * A coat is often finished for a clip its partner is not: Sunkern's
 * ordinary coat has a `Chop` and its shiny has not, and the shiny's
 * corner of the sheet would be left blank for it. The two are the same
 * drawing in different colours, so the missing clip is recoverable —
 * learn the palette mapping from the clips they do share, and put the
 * finished coat's drawing through it.
 *
 * Only within a pair: **ordinary with shiny**, and **female with shiny
 * female**. Those are the same body in other colours. A female coat is
 * a different drawing from the ordinary one, and no palette turns one
 * into the other.
 *
 * The mapping has to cover the clip completely. Where a colour maps two
 * ways, or the clip uses a colour the shared clips never showed, the
 * animation is left missing rather than drawn in the wrong colours.
 */

/** Which coats are the same body in other colours. */
const PAIRS: [CoatKey, CoatKey][] = [
  ['regular', 'shiny'],
  ['female', 'shinyFemale'],
];

/** One animation carried from one coat to another. */
export interface Derived {
  /** The coat that gained it. */
  coat: CoatKey;
  anim: SpriteAnim;
  /** The coat it was recoloured from. */
  from: CoatKey;
}

/** One animation that could not be carried, and why. */
export interface Refused extends Derived {
  reason: 'ambiguous' | 'unknown colours';
}

export interface Merged {
  derived: Derived[];
  refused: Refused[];
}

function imageOf(raster: Raster): Image {
  return { width: raster.width, height: raster.height, rgba: raster.data };
}

function rasterOf(image: Image): Raster {
  return { width: image.width, height: image.height, data: image.rgba };
}

/**
 * Fills each pair's gaps from the other coat, in place.
 *
 * The archives and their descriptions are both written to: a derived
 * clip is the other coat's pixels, so it is read on the other coat's
 * grid, and the description it needs is that coat's entry for it
 */
export default function mergeCoats(
  archives: { key: CoatKey; archive: Archive }[],
  grids: AnimData[],
): Merged {
  const derived: Derived[] = [];
  const refused: Refused[] = [];

  for (const pair of PAIRS) {
    const at = pair.map((key) => archives.findIndex((held) => held.key === key));

    if (at.some((one) => one < 0)) {
      continue;
    }
    const [one, two] = at;
    const images = [archives[one].archive.images, archives[two].archive.images];
    /** The clips both coats draw, which is what a mapping is learned from. */
    const shared: SpriteAnim[] = [...images[0].keys()].filter((anim) => {
      const first = images[0].get(anim)?.animation;
      const second = images[1].get(anim)?.animation;

      return (
        first != null &&
        second != null &&
        first.width === second.width &&
        first.height === second.height
      );
    });

    if (shared.length === 0) {
      continue;
    }
    /** One way and the other: either coat may be the finished one. */
    const mappings = [0, 1].map((from) =>
      learnAll(
        shared.map((anim): [Image, Image] => [
          // oxlint-disable-next-line typescript/no-non-null-assertion
          imageOf(images[from].get(anim)!.animation!),
          // oxlint-disable-next-line typescript/no-non-null-assertion
          imageOf(images[1 - from].get(anim)!.animation!),
        ]),
      ),
    );

    for (const from of [0, 1]) {
      const to = 1 - from;
      const mapping = mappings[from];

      for (const [anim, held] of images[from]) {
        if (held.animation == null || images[to].get(anim)?.animation != null) {
          continue;
        }
        const what: Derived = { coat: pair[to], anim, from: pair[from] };

        if (mapping.ambiguous.length > 0) {
          refused.push({ ...what, reason: 'ambiguous' });
          continue;
        }
        const made = recolor(imageOf(held.animation), mapping.swaps);

        // A colour the shared clips never showed is a colour nobody
        // knows the other coat's version of
        if (made.untouched.length > 0) {
          refused.push({ ...what, reason: 'unknown colours' });
          continue;
        }
        images[to].set(anim, { ...held, animation: rasterOf(made.image) });
        // Drawn on the coat it came from, so it is described by that
        // coat's entry rather than by nothing
        const entry = grids[from === 0 ? one : two].anims.find((each) => each.target === anim);
        const into = grids[from === 0 ? two : one];

        if (entry != null && !into.anims.some((each) => each.target === anim)) {
          into.anims.push(entry);
        }
        derived.push(what);
      }
    }
  }
  return { derived, refused };
}
