import { describe, expect, it } from 'vitest';
import deduper, { blankPixels, drawPictures, packedGrid } from '../src/dedupe.ts';
import { COLORS, fill, put, raster } from './helpers.ts';

/** An L shape, which is not the same thing drawn backwards. */
function shape(target: ReturnType<typeof raster>, x: number, y: number, flip = false): void {
  const at = (dx: number, dy: number): void => {
    put(target, x + (flip ? 3 - dx : dx), y + dy, COLORS.red);
  };

  at(0, 0);
  at(0, 1);
  at(0, 2);
  at(1, 2);
  at(2, 2);
}

describe('deduper', () => {
  it('keeps one picture where two frames draw the same thing', () => {
    const strip = raster(24, 8);

    shape(strip, 2, 2);
    shape(strip, 10, 2);
    const shared = deduper();
    const frames = shared.add([{ raster: strip, grid: packedGrid(0, 0, 8, 8, 3, 1) }], 0, '0');

    expect(shared.pictures).toHaveLength(2);
    expect(frames[0]).toEqual({ cell: 0, flip: false, at: [2, 2] });
    expect(frames[1]).toEqual({ cell: 0, flip: false, at: [2, 2] });
    // The third frame is empty, which is a picture of its own
    expect(frames[2].cell).toBe(1);
  });

  it('keeps one picture where a frame is another one mirrored', () => {
    const strip = raster(16, 8);

    shape(strip, 2, 2);
    shape(strip, 8 + 2, 2, true);
    const shared = deduper();
    const frames = shared.add([{ raster: strip, grid: packedGrid(0, 0, 8, 8, 2, 1) }], 0, '0');

    expect(shared.pictures).toHaveLength(1);
    expect(frames[1]).toEqual({ cell: 0, flip: true, at: [3, 2] });
  });

  it('crops each frame to what is drawn in it', () => {
    const strip = raster(8, 8);

    shape(strip, 2, 2);
    const shared = deduper();

    shared.add([{ raster: strip, grid: packedGrid(0, 0, 8, 8, 1, 1) }], 0, '0');
    expect(shared.pictures[0]).toMatchObject({ x: 2, y: 2, width: 3, height: 3 });
  });

  it('keeps whole frames where it is told not to crop', () => {
    const strip = raster(8, 8);

    shape(strip, 2, 2);
    const shared = deduper(false);

    shared.add([{ raster: strip, grid: packedGrid(0, 0, 8, 8, 1, 1) }], 0, '0');
    expect(shared.pictures[0]).toMatchObject({ x: 0, y: 0, width: 8, height: 8 });
  });

  it('only pairs two frames when they pair in every coat', () => {
    const plain = raster(16, 8);
    const other = raster(16, 8);

    // The same in the ordinary drawing, different in the second coat
    shape(plain, 2, 2);
    shape(plain, 10, 2);
    shape(other, 2, 2);
    shape(other, 10, 2);
    fill(other, { x: 10, y: 2, width: 1, height: 1 }, COLORS.blue);

    const alone = deduper();

    alone.add([{ raster: plain, grid: packedGrid(0, 0, 8, 8, 2, 1) }], 0, '0');
    expect(alone.pictures).toHaveLength(1);

    const both = deduper();

    both.add(
      [
        { raster: plain, grid: packedGrid(0, 0, 8, 8, 2, 1) },
        { raster: other, grid: packedGrid(0, 0, 8, 8, 2, 1) },
      ],
      0,
      '0,1',
    );
    expect(both.pictures).toHaveLength(2);
  });

  it('draws the pictures it kept where the packer put them', () => {
    const strip = raster(8, 8);

    shape(strip, 2, 2);
    const shared = deduper();

    shared.add([{ raster: strip, grid: packedGrid(0, 0, 8, 8, 1, 1) }], 0, '0');
    const sheet = blankPixels(4, 4);

    drawPictures(sheet, shared.pictures, [{ x: 1, y: 1 }], () => ({
      raster: strip,
      grid: packedGrid(0, 0, 8, 8, 1, 1),
    }));
    expect(sheet.data[((1 * 4 + 1) * 4) + 3]).toBe(255);
    expect(sheet.data[3]).toBe(0);
  });
});
