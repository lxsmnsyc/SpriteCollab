import { describe, expect, it } from 'vitest';
import pack from '../src/packing.ts';

describe('pack', () => {
  it('places every box', () => {
    const boxes = [
      { at: 0, w: 10, h: 20 },
      { at: 1, w: 30, h: 5 },
      { at: 2, w: 7, h: 7 },
      { at: 3, w: 12, h: 18 },
    ];
    const packed = pack(boxes);

    expect(packed.placed).toHaveLength(boxes.length);
    expect(packed.placed.map((placed) => placed.box.at).sort()).toEqual([0, 1, 2, 3]);
  });

  it('places nothing outside the sheet it grew', () => {
    const packed = pack(
      Array.from({ length: 40 }, (_unused, at) => ({ at, w: 3 + (at % 7), h: 2 + (at % 5) })),
    );

    for (const placed of packed.placed) {
      expect(placed.x + placed.box.w).toBeLessThanOrEqual(packed.width);
      expect(placed.y + placed.box.h).toBeLessThanOrEqual(packed.height);
    }
  });

  it('never overlaps two boxes', () => {
    const packed = pack(
      Array.from({ length: 30 }, (_unused, at) => ({ at, w: 4 + (at % 9), h: 4 + (at % 6) })),
    );

    for (let one = 0; one < packed.placed.length; one += 1) {
      for (let two = one + 1; two < packed.placed.length; two += 1) {
        const a = packed.placed[one];
        const b = packed.placed[two];
        const apart =
          a.x + a.box.w <= b.x || b.x + b.box.w <= a.x || a.y + a.box.h <= b.y || b.y + b.box.h <= a.y;

        expect(apart).toBe(true);
      }
    }
  });

  it('is an empty sheet for no boxes at all', () => {
    expect(pack([])).toEqual({ width: 0, height: 0, placed: [] });
  });
});
