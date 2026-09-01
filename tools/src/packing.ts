/**
 * Where each picture goes on the sheet.
 *
 * Boxes are fitted with MaxRects — the free space is kept as a list of
 * overlapping maximal rectangles, and each box goes into the one that
 * wastes the least along its shorter side. It beats the obvious
 * alternatives on exactly the shape of problem a sprite sheet is: a few
 * hundred small boxes of every proportion, where a shelf packer leaves
 * a stripe of waste above every short box in a tall row.
 *
 * The sheet has no width to fit into, so the width is searched for:
 * a packing is tried at a range of widths around the square root of the
 * total area and the smallest sheet that comes out of any of them wins.
 * That costs a few dozen packs of a few hundred boxes, which is nothing
 * beside reading the images in the first place.
 *
 * Nothing here touches a canvas or a file: it is arithmetic on boxes,
 * which is what makes it testable.
 */

export interface Box {
  w: number;
  h: number;
}

/** One box and where it ended up. */
export interface Placed<T extends Box> {
  box: T;
  x: number;
  y: number;
}

export interface Packed<T extends Box> {
  width: number;
  height: number;
  placed: Placed<T>[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whether one rectangle is wholly inside another. */
function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/**
 * The free rectangles left when a box is placed over one of them.
 *
 * Up to four, one on each side of the box, each as large as it can be.
 * They overlap each other, which is the whole point of the method: a
 * later box may be able to use a rectangle that a disjoint split would
 * have cut in half
 */
function split(free: Rect, used: Rect): Rect[] {
  if (
    used.x >= free.x + free.w ||
    used.x + used.w <= free.x ||
    used.y >= free.y + free.h ||
    used.y + used.h <= free.y
  ) {
    return [free];
  }
  const pieces: Rect[] = [];

  if (used.y > free.y) {
    pieces.push({ x: free.x, y: free.y, w: free.w, h: used.y - free.y });
  }
  if (used.y + used.h < free.y + free.h) {
    pieces.push({
      x: free.x,
      y: used.y + used.h,
      w: free.w,
      h: free.y + free.h - (used.y + used.h),
    });
  }
  if (used.x > free.x) {
    pieces.push({ x: free.x, y: free.y, w: used.x - free.x, h: free.h });
  }
  if (used.x + used.w < free.x + free.w) {
    pieces.push({
      x: used.x + used.w,
      y: free.y,
      w: free.x + free.w - (used.x + used.w),
      h: free.h,
    });
  }
  return pieces;
}

/** Drops every free rectangle that another one already covers. */
function prune(rects: Rect[]): Rect[] {
  const kept: Rect[] = [];

  for (let one = 0; one < rects.length; one += 1) {
    let covered = false;

    for (let two = 0; two < rects.length && !covered; two += 1) {
      covered = one !== two && contains(rects[two], rects[one]) &&
        // Of two identical rectangles exactly one is dropped
        (!contains(rects[one], rects[two]) || two < one);
    }
    if (!covered) {
      kept.push(rects[one]);
    }
  }
  return kept;
}

/**
 * How a free rectangle is judged against the box going into it.
 *
 * Neither rule wins everywhere: fitting the shorter side keeps long
 * thin gaps intact, and fitting the area keeps a large gap whole. Both
 * are tried and whichever gave the smaller sheet is kept
 */
export type Fit = 'short' | 'area';

/**
 * Fits every box into a sheet of the given width, growing downwards.
 *
 * Resolves nothing where a box is wider than the sheet, since a width
 * that cannot hold every box is not a width worth reporting on
 */
function packAt<T extends Box>(boxes: T[], width: number, fit: Fit): Packed<T> | null {
  let free: Rect[] = [{ x: 0, y: 0, w: width, h: Number.MAX_SAFE_INTEGER }];
  const placed: Placed<T>[] = [];
  let height = 0;

  for (const box of boxes) {
    if (box.w > width) {
      return null;
    }
    let best: Rect | null = null;
    let bestOne = Number.POSITIVE_INFINITY;
    let bestTwo = Number.POSITIVE_INFINITY;

    for (const rect of free) {
      if (rect.w < box.w || rect.h < box.h) {
        continue;
      }
      const spare = { w: rect.w - box.w, h: rect.h - box.h };
      // Short side fit, or area fit; each falls back to the other for
      // a tie, which is what keeps the choice from being arbitrary
      const one =
        fit === 'short' ? Math.min(spare.w, spare.h) : rect.w * rect.h - box.w * box.h;
      const two = fit === 'short' ? Math.max(spare.w, spare.h) : Math.min(spare.w, spare.h);

      // A tie is broken towards the top of the sheet, so the packing
      // does not depend on the order the free list happens to be in
      if (
        one < bestOne ||
        (one === bestOne && two < bestTwo) ||
        (one === bestOne && two === bestTwo && best != null && rect.y < best.y)
      ) {
        best = rect;
        bestOne = one;
        bestTwo = two;
      }
    }
    if (best == null) {
      return null;
    }
    const used: Rect = { x: best.x, y: best.y, w: box.w, h: box.h };

    placed.push({ box, x: used.x, y: used.y });
    height = Math.max(height, used.y + used.h);
    free = prune(free.flatMap((rect) => split(rect, used)));
  }
  return { width, height, placed };
}

/** The widths worth trying, given the boxes and the room they need. */
function widthsFor(boxes: Box[], area: number): number[] {
  const widest = Math.max(...boxes.map((box) => box.w));
  const square = Math.ceil(Math.sqrt(area));
  const tried = new Set<number>([widest, square]);

  // Around the square, since a sheet is packed tightest somewhere near
  // it and the best width is rarely the square exactly
  for (let share = 0.6; share <= 2.01; share += 0.1) {
    tried.add(Math.max(widest, Math.round(square * share)));
  }
  return [...tried].sort((one, two) => one - two);
}

/**
 * The orders worth placing the boxes in.
 *
 * A greedy packer is only as good as what it puts down first — the
 * awkward pieces have to go while there is still room to choose where
 * they go — and which measure of awkward wins depends on the sheet.
 * Each ordering is a tie-break chain rather than one number, so the
 * result does not depend on the sort being stable
 */
const ORDERS: ((one: Box, two: Box) => number)[] = [
  (one, two) =>
    Math.max(two.w, two.h) - Math.max(one.w, one.h) ||
    two.w * two.h - one.w * one.h ||
    two.h - one.h,
  (one, two) => two.w * two.h - one.w * one.h || two.h - one.h || two.w - one.w,
  (one, two) => two.h - one.h || two.w - one.w,
  (one, two) => two.w - one.w || two.h - one.h,
];

const FITS: Fit[] = ['short', 'area'];

/**
 * Fits every box into the smallest sheet any of the tried packings
 * gives.
 *
 * Every ordering, every fitting rule and every width is tried, which is
 * a few hundred packs of a few hundred boxes — nothing beside reading
 * the images in the first place, and worth several percent of the sheet
 */
export default function pack<T extends Box>(boxes: T[]): Packed<T> {
  if (boxes.length === 0) {
    return { width: 0, height: 0, placed: [] };
  }
  const area = boxes.reduce((total, box) => total + box.w * box.h, 0);
  const widths = widthsFor(boxes, area);
  const tries: { order: T[]; fit: Fit; width: number }[] = [];

  for (const compare of ORDERS) {
    const order = [...boxes].sort(compare);

    for (const fit of FITS) {
      for (const width of widths) {
        tries.push({ order, fit, width });
      }
    }
  }
  let best: Packed<T> | null = null;

  for (const { order, fit, width } of tries) {
    const packed = packAt(order, width, fit);

    if (packed == null) {
      continue;
    }
    if (best == null) {
      best = packed;
      continue;
    }
    const area = packed.width * packed.height;
    const held = best.width * best.height;
    const squarer =
      Math.abs(packed.width - packed.height) < Math.abs(best.width - best.height);

    // Area first, but a sheet within a fiftieth of the best is close
    // enough that being squarer is worth more than the difference: a
    // long ribbon of a texture is awkward wherever it ends up, and the
    // bytes it saves are bytes deflate was giving away anyway
    if (area < held * 0.98 || (squarer && area < held * 1.02)) {
      best = packed;
    }
  }
  if (best == null) {
    throw new Error('No sheet width could hold every picture');
  }
  return best;
}
