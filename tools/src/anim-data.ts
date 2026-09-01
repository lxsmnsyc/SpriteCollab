import type { SpriteAnim } from './anims.ts';
import { spriteAnimOf } from './anims.ts';
import type { Element } from './xml.ts';
import parseXml, { childNamed, childrenNamed, numberIn } from './xml.ts';

/**
 * `AnimData.xml`, as a sheet needs it.
 *
 * A PMD sprite folder describes its animations in XML, where an entry
 * either names its own frame grid or copies another entry's. What the
 * sheet needs is a flat list with every copy resolved, since a copy is
 * drawn from the image it copied and only the name, index and the
 * frames it acts on differ.
 *
 * Animations outside [the supported vocabulary](./anims.ts) are left
 * where they are. A sheet is described in numbers, so an animation
 * nothing downstream has a number for cannot be written at all — and
 * two thirds of the poses in the collection are cutscene animations no
 * engine here ever draws.
 */

/** One animation, with whatever it copied already resolved. */
export interface Anim {
  anim: SpriteAnim;
  index: number;
  frameWidth: number;
  frameHeight: number;
  durations: number[];
  /** Where the lunge starts, lands and comes back, where it says. */
  rushFrame: number | null;
  hitFrame: number | null;
  returnFrame: number | null;
  /** What it copied, kept so the file it came from can be rebuilt. */
  copyOf: SpriteAnim | null;
  /** The image it is drawn from, which is itself unless it is a copy. */
  target: SpriteAnim;
}

export interface AnimData {
  shadowSize: number;
  anims: Anim[];
}

/** Every `<Duration>` of one animation, in order. */
function durationsOf(anim: Element): number[] {
  const held = childNamed(anim, 'Durations');

  if (held == null) {
    return [];
  }
  return childrenNamed(held, 'Duration').map((entry) => {
    const value = Number.parseInt(entry.text, 10);

    if (!Number.isFinite(value)) {
      throw new Error(`A duration is not a number: ${entry.text}`);
    }
    return value;
  });
}

/**
 * Reads the file and resolves the copies.
 *
 * Copies are read last so that whatever they copy has already been
 * seen, which is what lets a folder list them in any order. A copy of
 * an animation nothing supports is dropped with the animation it
 * copies: it has nothing left to be drawn from
 */
export default function readAnimData(source: string): AnimData {
  const root = parseXml(source);

  if (root.name !== 'AnimData') {
    throw new Error(`Expected an AnimData document, found ${root.name}`);
  }
  const anims = childNamed(root, 'Anims');
  const listed = childrenNamed(anims ?? root, 'Anim');
  // Copies last, so whatever they copy has already been read
  const ordered = [...listed].sort(
    (one, two) =>
      (childNamed(one, 'CopyOf') == null ? 0 : 1) - (childNamed(two, 'CopyOf') == null ? 0 : 1),
  );
  const found = new Map<string, Anim>();

  for (const entry of ordered) {
    const named = childNamed(entry, 'Name')?.text;

    if (named == null || named.length === 0) {
      throw new Error('An animation was written with no name');
    }
    const copyOf = childNamed(entry, 'CopyOf')?.text ?? null;
    const anim = spriteAnimOf(named);

    if (anim == null) {
      continue;
    }
    if (copyOf != null) {
      const copied = found.get(copyOf);

      // A copy of something outside the vocabulary has no image to be
      // drawn from, so it goes the way the thing it copies went
      if (copied == null) {
        if (spriteAnimOf(copyOf) != null) {
          throw new Error(`${named} copies ${copyOf}, which the folder does not have`);
        }
        continue;
      }
      found.set(named, {
        ...copied,
        anim,
        index: numberIn(entry, 'Index') ?? copied.index,
        rushFrame: numberIn(entry, 'RushFrame') ?? copied.rushFrame,
        hitFrame: numberIn(entry, 'HitFrame') ?? copied.hitFrame,
        returnFrame: numberIn(entry, 'ReturnFrame') ?? copied.returnFrame,
        copyOf: copied.anim,
        target: copied.target,
      });
      continue;
    }
    found.set(named, {
      anim,
      index: numberIn(entry, 'Index') ?? 0,
      frameWidth: numberIn(entry, 'FrameWidth') ?? 0,
      frameHeight: numberIn(entry, 'FrameHeight') ?? 0,
      durations: durationsOf(entry),
      rushFrame: numberIn(entry, 'RushFrame'),
      hitFrame: numberIn(entry, 'HitFrame'),
      returnFrame: numberIn(entry, 'ReturnFrame'),
      copyOf: null,
      target: anim,
    });
  }

  return {
    shadowSize: numberIn(root, 'ShadowSize') ?? 0,
    // Back into the order the file listed them in, rather than the
    // order copies had to be resolved in
    anims: listed.flatMap((entry) => {
      const held = found.get(childNamed(entry, 'Name')?.text ?? '');

      return held == null ? [] : [held];
    }),
  };
}
