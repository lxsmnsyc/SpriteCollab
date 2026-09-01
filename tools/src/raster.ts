import decodePng, { type Encoded, type Image, encodeSmallest } from './png.ts';

/**
 * Pixels, as everything here passes them around.
 *
 * Every image in this collection is a PNG, so the codec in
 * [`png.ts`](./png.ts) is the only decoder needed and the tool carries
 * no native image library at all. An image is a flat RGBA buffer and
 * compositing is arithmetic over it.
 */

/** One decoded image: straight RGBA, four bytes to the pixel. */
export interface Raster {
  width: number;
  height: number;
  data: Buffer;
}

/** Reads a PNG into RGBA, whatever container it was stored in. */
export function decode(bytes: Buffer): Raster {
  const image = decodePng(bytes);

  return { width: image.width, height: image.height, data: image.rgba };
}

/** A transparent image to compose into. */
export function blank(width: number, height: number): Raster {
  return { width, height, data: Buffer.alloc(Math.max(0, width * height * 4)) };
}

/**
 * The finished sheet, as the bytes of a PNG file and what it was
 * stored as.
 *
 * A sprite sheet is pixel art in a couple of dozen colours, and the
 * tools it comes out of write it as 8-bit-per-channel truecolour with
 * an alpha channel: thirty-two bits a pixel for a picture that needs
 * four. [`encodeSmallest`](./png.ts) tries the indexed containers too
 * and keeps the smallest that gives the same pixels back
 */
export function encode(raster: Raster): Encoded {
  const image: Image = { width: raster.width, height: raster.height, rgba: raster.data };

  return encodeSmallest(image);
}

/** Whether a pixel is drawn at all. */
export function opaque(raster: Raster, x: number, y: number): boolean {
  return raster.data[(y * raster.width + x) * 4 + 3] > 0;
}
