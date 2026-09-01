import type { Raster } from './raster.ts';
import { opaque } from './raster.ts';

/** Where the content of an image sits inside it. */
export interface Trim {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The smallest cell rectangle that still holds every visible pixel of
 * every frame.
 *
 * Cropping all frames to one rectangle rather than each to its own is
 * what keeps them on a uniform grid, so a frame stays addressable by
 * its row and column after trimming. A loose image is the `1 × 1` case,
 * where the answer is its own bounding box
 */
export default function computeTrim(
  raster: Raster,
  frameWidth: number,
  frameHeight: number,
  columns: number,
  rows: number,
): Trim {
  const untrimmed: Trim = { x: 0, y: 0, width: frameWidth, height: frameHeight };
  let minX = frameWidth;
  let minY = frameHeight;
  let maxX = -1;
  let maxY = -1;

  /** One cell, against the running rectangle. */
  const scan = (cellX: number, cellY: number): void => {
    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        if (
          cellY + y >= raster.height ||
          cellX + x >= raster.width ||
          !opaque(raster, cellX + x, cellY + y)
        ) {
          continue;
        }
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  };

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      scan(column * frameWidth, row * frameHeight);
    }
  }

  // Nothing drawn anywhere: there is no tighter rectangle than the one
  // it came with
  if (maxX < 0) {
    return untrimmed;
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
