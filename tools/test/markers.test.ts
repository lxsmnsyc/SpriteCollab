import { describe, expect, it } from 'vitest';
import markersFor, { SPRITE_DIRECTIONS } from '../src/markers.ts';
import { COLORS, put, raster } from './helpers.ts';

describe('markersFor', () => {
  it('reads each anchor off the colour that marks it', () => {
    const offsets = raster(8, 8);
    const shadow = raster(8, 8);

    // Black is the body, and the three pure channels are the rest
    put(offsets, 3, 4, COLORS.black);
    put(offsets, 3, 1, COLORS.red);
    put(offsets, 1, 4, COLORS.green);
    put(offsets, 5, 4, COLORS.blue);
    put(shadow, 4, 6, COLORS.white);

    expect(markersFor(shadow, offsets, { x: 0, y: 0, width: 8, height: 8 }, [0, 0])).toEqual({
      shadow: [4, 6],
      center: [3, 4],
      head: [3, 1],
      left: [1, 4],
      right: [5, 4],
    });
  });

  it('reads the shadow off its marker rather than off the rings round it', () => {
    const shadow = raster(8, 8);

    // The size rings, which say nothing about where the shadow is, and
    // which are not always drawn evenly about it
    for (let x = 0; x < 8; x += 1) {
      put(shadow, x, 5, COLORS.red);
      put(shadow, x, 6, COLORS.green);
    }
    put(shadow, 2, 6, COLORS.white);
    expect(markersFor(shadow, null, { x: 0, y: 0, width: 8, height: 8 }, [0, 0]).shadow).toEqual([
      2, 6,
    ]);
  });

  it('averages a marker drawn as a blob rather than a pixel', () => {
    const offsets = raster(8, 8);

    put(offsets, 2, 2, COLORS.black);
    put(offsets, 4, 2, COLORS.black);
    expect(markersFor(null, offsets, { x: 0, y: 0, width: 8, height: 8 }, [0, 0]).center).toEqual([
      3, 2,
    ]);
  });

  it('moves the anchors onto the trimmed frame, however far off it lands', () => {
    const shadow = raster(8, 8);

    put(shadow, 1, 7, COLORS.white);
    expect(markersFor(shadow, null, { x: 0, y: 0, width: 8, height: 8 }, [2, 2]).shadow).toEqual([
      -1, 5,
    ]);
  });

  it('reads the cell it is pointed at, not the whole image', () => {
    const offsets = raster(16, 8);

    put(offsets, 11, 3, COLORS.black);
    expect(markersFor(null, offsets, { x: 8, y: 0, width: 8, height: 8 }, [0, 0]).center).toEqual([
      3, 3,
    ]);
  });

  it('resolves nothing where a frame carries no such mark', () => {
    expect(markersFor(null, null, { x: 0, y: 0, width: 8, height: 8 }, [0, 0])).toEqual({
      shadow: null,
      center: null,
      head: null,
      left: null,
      right: null,
    });
  });

  it('names the eight directions a row can face', () => {
    expect(SPRITE_DIRECTIONS).toHaveLength(8);
    expect(SPRITE_DIRECTIONS[0]).toBe('Down');
  });
});
