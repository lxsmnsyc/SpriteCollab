import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeTruecolor } from '../src/png.ts';
import type { Raster } from '../src/raster.ts';

/** Colours a test paints with, so a frame can be told from its neighbour. */
export const COLORS: Record<string, [number, number, number, number]> = {
  clear: [0, 0, 0, 0],
  black: [0, 0, 0, 255],
  red: [255, 0, 0, 255],
  green: [0, 255, 0, 255],
  blue: [0, 0, 255, 255],
  white: [255, 255, 255, 255],
};

/** An empty image to paint into. */
export function raster(width: number, height: number): Raster {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

/** One pixel. */
export function put(target: Raster, x: number, y: number, color: [number, number, number, number]): void {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) {
    return;
  }
  const at = (y * target.width + x) * 4;

  target.data[at] = color[0];
  target.data[at + 1] = color[1];
  target.data[at + 2] = color[2];
  target.data[at + 3] = color[3];
}

/** A filled rectangle. */
export function fill(
  target: Raster,
  box: { x: number; y: number; width: number; height: number },
  color: [number, number, number, number],
): void {
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      put(target, box.x + x, box.y + y, color);
    }
  }
}

/** One image as the bytes of a PNG file. */
export function png(source: Raster): Buffer {
  return encodeTruecolor({ width: source.width, height: source.height, rgba: source.data }, 'none');
}

/** Writes an image into a folder as a PNG. */
export function writePng(folder: string, name: string, source: Raster): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), png(source));
}
