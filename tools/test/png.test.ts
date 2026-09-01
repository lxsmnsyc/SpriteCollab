import { describe, expect, it } from 'vitest';
import decode, {
  depthFor,
  encodeIndexed,
  encodeSmallest,
  encodeTruecolor,
  paletteOf,
  sameImage,
} from '../src/png.ts';
import { COLORS, fill, raster } from './helpers.ts';

/** A small picture in four colours, which is what a sprite sheet is. */
function flat() {
  const image = raster(32, 32);

  fill(image, { x: 0, y: 0, width: 16, height: 32 }, COLORS.red);
  fill(image, { x: 16, y: 0, width: 16, height: 16 }, COLORS.green);
  fill(image, { x: 16, y: 16, width: 16, height: 16 }, COLORS.blue);
  return { width: image.width, height: image.height, rgba: image.data };
}

describe('png', () => {
  it('reads back exactly what it wrote, as truecolour', () => {
    const image = flat();

    expect(sameImage(image, decode(encodeTruecolor(image, 'none')))).toBe(true);
    expect(sameImage(image, decode(encodeTruecolor(image, 'adaptive')))).toBe(true);
  });

  it('reads back exactly what it wrote, as an indexed picture', () => {
    const image = flat();
    const palette = paletteOf(image);

    expect(palette).not.toBeNull();
    expect(palette?.colors.length).toBe(3);
    // oxlint-disable-next-line typescript/no-non-null-assertion
    expect(sameImage(image, decode(encodeIndexed(image, palette!, 'none')))).toBe(true);
  });

  it('has no palette for a picture with too many colours', () => {
    const image = raster(64, 64);

    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        fill(image, { x, y, width: 1, height: 1 }, [x * 4, y * 4, (x + y) * 2, 255]);
      }
    }
    expect(paletteOf({ width: 64, height: 64, rgba: image.data })).toBeNull();
  });

  it('picks a depth that just holds the palette', () => {
    expect(depthFor(2)).toBe(1);
    expect(depthFor(3)).toBe(2);
    expect(depthFor(4)).toBe(2);
    expect(depthFor(17)).toBe(8);
  });

  it('keeps the smallest container that gives the same pixels back', () => {
    const image = flat();
    const smallest = encodeSmallest(image);

    expect(smallest.as).toMatch(/indexed/);
    expect(smallest.bytes.length).toBeLessThan(smallest.plain);
    expect(sameImage(image, decode(smallest.bytes))).toBe(true);
  });

  it('tells two different pictures apart', () => {
    const one = flat();
    const two = flat();

    two.rgba[0] = 1;
    expect(sameImage(one, two)).toBe(false);
  });
});
