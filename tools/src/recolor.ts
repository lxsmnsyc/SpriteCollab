import decodePng, { encodeSmallest, paletteOf } from './png.ts';
import type { Color, Image } from './png.ts';
import type { CoatKey } from './slots.ts';

/**
 * Swapping the colours of a coat without touching anything else.
 *
 * A form's coats are the same pokemon drawn in other colours: same
 * frames, same layout, same description. That is what makes a recolour
 * a colour substitution rather than a redraw — take one coat's sheet,
 * put different colours in it, and it drops into the same slot with the
 * same `frames.bin` and the same `sheet.json` describing it.
 *
 * The collection has always worked this way: `!recolorsprite` hands out
 * a sheet with a palette bar across the top for exactly this. This is
 * the same idea against the compact sheets, and it goes three ways —
 * take a coat's palette out, learn a mapping from a pair of coats that
 * already exist, and put a mapping back in as a new coat.
 *
 * Nothing here changes a pixel's shape or its alpha. A recolour that
 * moved a pixel or made one transparent would be a sheet the shared
 * description no longer describes
 */

/** One colour becoming another. */
export interface Swap {
  from: Color;
  to: Color;
}

/** A colour as `#rrggbbaa`. */
export function hexOf(color: Color): string {
  return `#${[...color].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

/** A colour written as `#rgb`, `#rrggbb` or `#rrggbbaa`. */
export function colorOf(hex: string): Color {
  const body = hex.trim().replace(/^#/, '');
  const wide =
    body.length === 3 || body.length === 4
      ? [...body].map((part) => part + part).join('')
      : body;

  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(wide)) {
    throw new Error(`${hex} is not a colour`);
  }
  const part = (at: number): number => Number.parseInt(wide.slice(at, at + 2), 16);

  return [part(0), part(2), part(4), wide.length === 8 ? part(6) : 255];
}

/** A key a colour can be looked up by. */
function keyOf(color: Color): number {
  return ((color[0] << 24) | (color[1] << 16) | (color[2] << 8) | color[3]) >>> 0;
}

/**
 * Every colour a sheet uses, in the order they are first met.
 *
 * Reading order rather than sorted, so the same sheet always gives the
 * same list and a palette strip lines up with it column for column.
 * Every fully transparent pixel counts as one colour, whatever was
 * stored in its channels
 */
export function paletteFor(image: Image): Color[] {
  const held = paletteOf(image);

  if (held != null) {
    return held.colors;
  }
  // More colours than an indexed PNG can hold, which no sprite sheet in
  // the collection has, but a recolour of one might be handed to us
  const seen = new Map<number, Color>();

  for (let at = 0; at < image.rgba.length; at += 4) {
    const color: Color =
      image.rgba[at + 3] === 0
        ? [0, 0, 0, 0]
        : [image.rgba[at], image.rgba[at + 1], image.rgba[at + 2], image.rgba[at + 3]];

    if (!seen.has(keyOf(color))) {
      seen.set(keyOf(color), color);
    }
  }
  return [...seen.values()];
}

/** How wide one colour is drawn in a palette strip. */
export const CELL = 8;

/**
 * A palette as an image, one block a colour.
 *
 * Meant to be opened in whatever the artist already uses: change the
 * blocks, keep the order and the count, and hand it back. Blocks rather
 * than single pixels because a one-pixel-tall image is not something a
 * person can paint in
 */
export function stripOf(colors: Color[]): Buffer {
  const width = Math.max(colors.length, 1) * CELL;
  const rgba = Buffer.alloc(width * CELL * 4);

  for (let at = 0; at < colors.length; at += 1) {
    for (let y = 0; y < CELL; y += 1) {
      for (let x = 0; x < CELL; x += 1) {
        const to = (y * width + at * CELL + x) * 4;

        rgba[to] = colors[at][0];
        rgba[to + 1] = colors[at][1];
        rgba[to + 2] = colors[at][2];
        rgba[to + 3] = colors[at][3];
      }
    }
  }
  return encodeSmallest({ width, height: CELL, rgba }).bytes;
}

/**
 * The colours of a palette strip, read out of the middle of each block
 * so a soft-edged brush at a boundary does not change the answer
 */
export function colorsIn(strip: Buffer): Color[] {
  const image = decodePng(strip);
  const count = Math.floor(image.width / CELL);
  const colors: Color[] = [];
  const y = Math.floor(image.height / 2);

  for (let at = 0; at < count; at += 1) {
    const from = (y * image.width + at * CELL + Math.floor(CELL / 2)) * 4;

    colors.push([
      image.rgba[from],
      image.rgba[from + 1],
      image.rgba[from + 2],
      image.rgba[from + 3],
    ]);
  }
  return colors;
}

/** A colour that is drawn under two different colours in the other coat. */
export interface Ambiguity {
  from: Color;
  to: Color[];
}

export interface Learned {
  swaps: Swap[];
  /** Colours the pair disagrees about, which are left out of the swaps. */
  ambiguous: Ambiguity[];
}

/**
 * The mapping between two coats of one form.
 *
 * Both are the same drawing in different colours on the same layout, so
 * a pixel of one stands over a pixel of the other and the pair of
 * colours is one entry of the mapping. Only where both have drawn
 * something: one coat is often finished for an animation the other is
 * not, and its part of the sheet is clear there.
 *
 * A colour that stands over two different colours is reported rather
 * than guessed at: the two coats were drawn with different palettes,
 * and no substitution can turn one into the other
 */
export function learn(one: Image, two: Image): Learned {
  return learnAll([[one, two]]);
}

/**
 * The mapping across several pairs at once.
 *
 * One clip is often too little to see every colour a pokemon is drawn
 * in, so a mapping meant to carry a whole animation over is learned
 * from every clip the two coats have in common. A colour that maps one
 * way in one clip and another way in another is ambiguous just the same
 */
export function learnAll(pairs: [Image, Image][]): Learned {
  const found = new Map<number, { from: Color; to: Map<number, Color> }>();

  for (const [one, two] of pairs) {
    if (one.width !== two.width || one.height !== two.height) {
      throw new Error('Two coats of one form are the same size, and these are not');
    }
    gather(one, two, found);
  }
  return resolve(found);
}

/** Every pair of colours one clip stands over. */
function gather(
  one: Image,
  two: Image,
  found: Map<number, { from: Color; to: Map<number, Color> }>,
): void {
  for (let at = 0; at < one.rgba.length; at += 4) {
    // Only where both coats have drawn something. A colour standing
    // over nothing says nothing about what it maps to: the other coat
    // is simply not drawn there, which happens whenever one coat is
    // finished for an animation the other is not, and taking it for a
    // mapping makes every colour of the sheet look ambiguous
    if (one.rgba[at + 3] === 0 || two.rgba[at + 3] === 0) {
      continue;
    }
    const from: Color = [one.rgba[at], one.rgba[at + 1], one.rgba[at + 2], one.rgba[at + 3]];
    const to: Color = [two.rgba[at], two.rgba[at + 1], two.rgba[at + 2], two.rgba[at + 3]];
    const held = found.get(keyOf(from)) ?? { from, to: new Map<number, Color>() };

    held.to.set(keyOf(to), to);
    found.set(keyOf(from), held);
  }
}

/** The pairs that are agreed on, and the ones that are not. */
function resolve(found: Map<number, { from: Color; to: Map<number, Color> }>): Learned {
  const swaps: Swap[] = [];
  const ambiguous: Ambiguity[] = [];

  for (const held of found.values()) {
    const targets = [...held.to.values()];

    if (targets.length === 1) {
      swaps.push({ from: held.from, to: targets[0] });
      continue;
    }
    ambiguous.push({ from: held.from, to: targets });
  }
  return { swaps, ambiguous };
}

export interface Recolored {
  image: Image;
  /** How many pixels changed colour. */
  changed: number;
  /** Colours of the sheet that no swap named. */
  untouched: Color[];
}

/**
 * One sheet with its colours swapped.
 *
 * A colour no swap names is left as it was rather than dropped, and is
 * reported so a half-written palette is visible rather than silent. A
 * swap that would make a drawn pixel transparent, or a clear one drawn,
 * is refused: the description says which pixels a frame has, and a
 * recolour does not get to disagree with it
 */
export function recolor(image: Image, swaps: Swap[]): Recolored {
  const lookup = new Map<number, Color>();

  for (const swap of swaps) {
    if (swap.from[3] === 0 || swap.to[3] === 0) {
      throw new Error('A recolour cannot add or take away a transparent pixel');
    }
    lookup.set(keyOf(swap.from), swap.to);
  }
  const rgba = Buffer.from(image.rgba);
  const missed = new Map<number, Color>();
  let changed = 0;

  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at + 3] === 0) {
      continue;
    }
    const from: Color = [rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]];
    const to = lookup.get(keyOf(from));

    if (to == null) {
      missed.set(keyOf(from), from);
      continue;
    }
    if (keyOf(to) !== keyOf(from)) {
      changed += 1;
    }
    rgba[at] = to[0];
    rgba[at + 1] = to[1];
    rgba[at + 2] = to[2];
    rgba[at + 3] = to[3];
  }
  return {
    image: { width: image.width, height: image.height, rgba },
    changed,
    untouched: [...missed.values()],
  };
}

/** A mapping as it is written to disk. */
export interface Mapping {
  version: 1;
  /** Which coat it was taken from, where it was taken from one. */
  from?: CoatKey;
  swaps: { from: string; to: string }[];
}

/** A mapping, as JSON a person can edit. */
export function writeMapping(swaps: Swap[], from?: CoatKey): string {
  const mapping: Mapping = {
    version: 1,
    ...(from == null ? {} : { from }),
    swaps: swaps.map((swap) => ({ from: hexOf(swap.from), to: hexOf(swap.to) })),
  };

  return `${JSON.stringify(mapping, null, 2)}\n`;
}

/** Reads back what `writeMapping` wrote. */
export function readMapping(source: string): Swap[] {
  const held = JSON.parse(source) as Mapping;

  if (held.version !== 1) {
    throw new Error(`This mapping is version ${held.version}, which is not the one read here`);
  }
  return held.swaps.map((swap) => ({ from: colorOf(swap.from), to: colorOf(swap.to) }));
}

/** A palette strip against the palette it was made from. */
export function swapsFromStrip(before: Color[], after: Color[]): Swap[] {
  if (before.length !== after.length) {
    throw new Error(
      `The strip has ${after.length} colours and the sheet has ${before.length}: keep the order and the count`,
    );
  }
  return before
    .map((from, at) => ({ from, to: after[at] }))
    // A colour left alone is not a swap, and a transparent one is not a
    // colour the sheet lets anybody change
    .filter((swap) => swap.from[3] !== 0 && keyOf(swap.from) !== keyOf(swap.to));
}
