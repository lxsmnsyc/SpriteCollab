import { describe, expect, it } from 'vitest';
import computeTrim from '../src/trim.ts';
import { COLORS, fill, raster } from './helpers.ts';

describe('computeTrim', () => {
  it('is the rectangle that holds every frame, not each frame in turn', () => {
    // Two frames side by side in a 20x20 grid: one drawn low and left,
    // the other high and right
    const image = raster(40, 20);

    fill(image, { x: 2, y: 12, width: 4, height: 4 }, COLORS.red);
    fill(image, { x: 20 + 10, y: 3, width: 4, height: 4 }, COLORS.blue);
    expect(computeTrim(image, 20, 20, 2, 1)).toEqual({ x: 2, y: 3, width: 12, height: 13 });
  });

  it('leaves an empty grid at the size it came with', () => {
    expect(computeTrim(raster(40, 20), 20, 20, 2, 1)).toEqual({
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });
  });

  it('is the bounding box of a single loose image', () => {
    const image = raster(16, 16);

    fill(image, { x: 5, y: 6, width: 2, height: 3 }, COLORS.green);
    expect(computeTrim(image, 16, 16, 1, 1)).toEqual({ x: 5, y: 6, width: 2, height: 3 });
  });
});
