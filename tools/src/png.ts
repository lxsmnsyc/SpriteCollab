import { constants, deflateSync, inflateSync } from 'node:zlib';

/**
 * As much of PNG as this project needs, and no more.
 *
 * `sharp` reads and writes PNGs perfectly well, but it will not say
 * *which* container to write: it hands back 8-bit RGBA whatever the
 * sheet holds, and its palette mode quantises. Choosing the smallest
 * container that gives the same pixels back means encoding candidates
 * and comparing them, which needs a codec that can be pointed at a
 * specific colour type — so here is one. PNG is a signature, a handful
 * of length-tagged chunks and a deflate stream, and `node:zlib` already
 * has the hard half.
 *
 * [`raster.ts`](./raster.ts) both reads the archive's images and
 * encodes the finished sheet with it, so the optimizer needs no native
 * image library at all.
 *
 * What is supported is what the collection contains: 8-bit samples,
 * any of the five colour types, indexed sheets down to one bit a
 * pixel, and no interlacing. Anything else throws rather than being
 * guessed at — a sheet this cannot read should stop a run, not come
 * out quietly mangled.
 *
 * Everything is normalised to RGBA on the way in, so a caller never
 * has to care how a sheet was stored, and comparing two encodings of
 * one sheet is a buffer compare rather than a discussion about colour
 * types
 */

/**
 * How many colours an indexed PNG can hold. Past this a sheet has to
 * stay truecolour, because the alternative is throwing colours away
 */
const MAX_PALETTE = 256;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;

    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = -1;

  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

interface Chunk {
  type: string;
  data: Buffer;
}

function readChunks(file: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let at = SIGNATURE.length;

  while (at + 8 <= file.length) {
    const length = file.readUInt32BE(at);

    chunks.push({
      type: file.toString('ascii', at + 4, at + 8),
      data: file.subarray(at + 8, at + 8 + length),
    });
    at += 12 + length;
  }
  return chunks;
}

function writeChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);

  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/**
 * A decoded sheet: one picture, four bytes a pixel, however it was
 * stored. Comparing two encodings of the same sheet is then a buffer
 * compare rather than a discussion about colour types
 */
export interface Image {
  width: number;
  height: number;
  rgba: Buffer;
}

/**
 * How big a PNG is, without decoding it.
 *
 * The size is in the header, which is the first chunk of every PNG, so
 * a caller that only wants the shape of an image — how many frames a
 * grid holds, say — can read thirty-three bytes rather than inflating
 * a sheet
 */
export function sizeOf(file: Buffer): { width: number; height: number } {
  if (file.length < 24 || !file.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('This is not a PNG');
  }
  if (file.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('This PNG does not start with its header');
  }
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

/**
 * Bytes per pixel for filtering purposes — a PNG filter looks back a
 * whole pixel, except at sub-byte depths where it looks back one byte
 */
function filterStep(depth: number, channels: number): number {
  return depth < 8 ? 1 : channels;
}

const CHANNELS: Record<number, number | undefined> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * PNG's Paeth predictor: of the pixel to the left, the one above and
 * the one diagonally back, whichever is closest to their combination.
 * It is the one filter that reads all three, and both the unfiltering
 * and the filtering below need it to agree exactly
 */
function paeth(left: number, up: number, corner: number): number {
  const guess = left + up - corner;
  const toLeft = Math.abs(guess - left);
  const toUp = Math.abs(guess - up);
  const toCorner = Math.abs(guess - corner);

  if (toLeft <= toUp && toLeft <= toCorner) {
    return left;
  }
  return toUp <= toCorner ? up : corner;
}

/**
 * Undo the per-scanline filters, giving the raw sample bytes.
 *
 * This is the whole of PNG's compression cleverness and it has to be
 * reversed to read anything: the deflated stream holds each row filtered
 * against the row above it or the pixel behind it, with a byte at the
 * front of each row saying which
 */
function unfilter(raw: Buffer, stride: number, height: number, step: number): Buffer {
  const bytes = Buffer.alloc(height * stride);
  let at = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    const line = raw.subarray(at, at + stride);
    const row = bytes.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? bytes.subarray((y - 1) * stride, y * stride) : null;

    at += stride;

    for (let x = 0; x < stride; x++) {
      const left = x >= step ? row[x - step] : 0;
      const up = above == null ? 0 : above[x];
      const corner = above == null || x < step ? 0 : above[x - step];
      let value = line[x];

      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4:
          value += paeth(left, up, corner);
          break;
        default:
          throw new Error(`unknown scanline filter ${filter}`);
      }
      row[x] = value & 0xff;
    }
  }
  return bytes;
}

/**
 * Read a PNG to plain RGBA.
 *
 * Interlacing and 16-bit samples are refused rather than guessed at:
 * nothing in the collection uses either, and a sheet that did should
 * stop the run rather than be quietly mangled
 */
export default function decode(file: Buffer): Image {
  if (!file.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw new Error('not a png');
  }

  const chunks = readChunks(file);
  const header = chunks.find((chunk) => chunk.type === 'IHDR')?.data;

  if (header == null) {
    throw new Error('png with no header');
  }

  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const colorType = header[9];
  const channels = CHANNELS[colorType];

  if (header[12] !== 0) {
    throw new Error('interlaced png');
  }
  if (channels == null) {
    throw new Error(`unknown colour type ${colorType}`);
  }
  if (depth !== 8 && !(depth < 8 && colorType === 3)) {
    throw new Error(`unsupported bit depth ${depth} for colour type ${colorType}`);
  }

  const perByte = 8 / depth;
  const stride = depth < 8 ? Math.ceil(width / perByte) : width * channels;
  const bytes = unfilter(
    inflateSync(
      Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)),
    ),
    stride,
    height,
    filterStep(depth, channels),
  );
  const palette = chunks.find((chunk) => chunk.type === 'PLTE')?.data;
  const alphas = chunks.find((chunk) => chunk.type === 'tRNS')?.data;
  const rgba = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4;

      if (colorType === 3) {
        const index =
          depth === 8
            ? bytes[y * stride + x]
            : (bytes[y * stride + Math.floor(x / perByte)] >> (8 - depth * ((x % perByte) + 1))) &
              ((1 << depth) - 1);

        if (palette == null) {
          throw new Error('indexed png with no palette');
        }
        rgba[to] = palette[index * 3];
        rgba[to + 1] = palette[index * 3 + 1];
        rgba[to + 2] = palette[index * 3 + 2];
        rgba[to + 3] = alphas != null && index < alphas.length ? alphas[index] : 0xff;
        continue;
      }

      const from = (y * width + x) * channels;

      switch (colorType) {
        case 6:
          bytes.copy(rgba, to, from, from + 4);
          break;
        case 2:
          bytes.copy(rgba, to, from, from + 3);
          rgba[to + 3] = 0xff;
          break;
        case 4:
          rgba.fill(bytes[from], to, to + 3);
          rgba[to + 3] = bytes[from + 1];
          break;
        default:
          rgba.fill(bytes[from], to, to + 3);
          rgba[to + 3] = 0xff;
      }
    }
  }
  return { width, height, rgba };
}

/**
 * Which scanline filters to write. `None` is what wins on flat colour;
 * `adaptive` is the usual per-row pick-the-cheapest, kept for the
 * occasional sheet with shading in it
 */
export type Filtering = 'none' | 'adaptive';

function filterRows(
  bytes: Buffer,
  stride: number,
  height: number,
  step: number,
  filtering: Filtering,
): Buffer {
  const out = Buffer.alloc(height * (stride + 1));

  if (filtering === 'none') {
    for (let y = 0; y < height; y++) {
      out[y * (stride + 1)] = 0;
      bytes.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    return out;
  }

  const attempt = Buffer.alloc(stride);
  let at = 0;

  for (let y = 0; y < height; y++) {
    const row = bytes.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? bytes.subarray((y - 1) * stride, y * stride) : null;
    let chosen = 0;
    let chosenCost = Infinity;
    let chosenRow: Buffer | null = null;

    for (let filter = 0; filter <= 4; filter++) {
      let cost = 0;

      for (let x = 0; x < stride; x++) {
        const left = x >= step ? row[x - step] : 0;
        const up = above == null ? 0 : above[x];
        const corner = above == null || x < step ? 0 : above[x - step];
        let value: number;

        switch (filter) {
          case 0:
            value = row[x];
            break;
          case 1:
            value = row[x] - left;
            break;
          case 2:
            value = row[x] - up;
            break;
          case 3:
            value = row[x] - ((left + up) >> 1);
            break;
          default:
            value = row[x] - paeth(left, up, corner);
        }
        attempt[x] = value & 0xff;
        // The standard heuristic: the row whose filtered bytes are
        // closest to zero as signed values is the one deflate does
        // best with
        cost += attempt[x] > 127 ? 256 - attempt[x] : attempt[x];
      }

      if (cost < chosenCost) {
        chosenCost = cost;
        chosen = filter;
        chosenRow = Buffer.from(attempt);
      }
    }
    out[at++] = chosen;
    chosenRow?.copy(out, at);
    at += stride;
  }
  return out;
}

const DEFLATE = { level: 9, memLevel: 9, windowBits: 15, strategy: constants.Z_DEFAULT_STRATEGY };

function assemble(header: Buffer, extra: Buffer[], body: Buffer): Buffer {
  return Buffer.concat([
    SIGNATURE,
    writeChunk('IHDR', header),
    ...extra,
    writeChunk('IDAT', deflateSync(body, DEFLATE)),
    writeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function ihdr(width: number, height: number, depth: number, colorType: number): Buffer {
  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = colorType;
  return header;
}

export function encodeTruecolor(image: Image, filtering: Filtering): Buffer {
  return assemble(
    ihdr(image.width, image.height, 8, 6),
    [],
    filterRows(image.rgba, image.width * 4, image.height, 4, filtering),
  );
}

type Color = readonly [number, number, number, number];

export interface Palette {
  /**
   * One entry per pixel, in reading order
   */
  indices: Uint8Array;
  colors: Color[];
}

/**
 * The colours a sheet actually uses, in the order they first appear.
 *
 * Every fully transparent pixel is folded into one entry whatever its
 * red, green and blue say. Canvas composites in premultiplied alpha, so
 * the colour under a transparent pixel is unreachable — it cannot be
 * drawn, sampled or smoothed into a neighbour — and keeping several
 * spellings of nothing would both grow the palette and break up the
 * long runs the empty parts of a sheet compress into.
 *
 * Null past `MAX_PALETTE`: such a sheet has to stay truecolour
 */
export function paletteOf(image: Image): Palette | null {
  const seen = new Map<number, number>();
  const indices = new Uint8Array(image.width * image.height);
  const colors: Color[] = [];

  for (let pixel = 0; pixel < indices.length; pixel++) {
    const at = pixel * 4;
    const clear = image.rgba[at + 3] === 0;
    const key = clear ? -1 : image.rgba.readUInt32BE(at);
    let index = seen.get(key);

    if (index === undefined) {
      if (colors.length >= MAX_PALETTE) {
        return null;
      }
      index = colors.length;
      seen.set(key, index);
      colors.push(
        clear
          ? [0, 0, 0, 0]
          : [image.rgba[at], image.rgba[at + 1], image.rgba[at + 2], image.rgba[at + 3]],
      );
    }
    indices[pixel] = index;
  }
  return { indices, colors };
}

/**
 * The smallest bit depth PNG offers that can hold this many colours.
 * A twelve-colour sheet is four bits a pixel, and a silhouette is one
 */
export function depthFor(colors: number): number {
  for (const depth of [1, 2, 4]) {
    if (colors <= 1 << depth) {
      return depth;
    }
  }
  return 8;
}

function packIndices(indices: Uint8Array, width: number, height: number, depth: number): Buffer {
  if (depth === 8) {
    return Buffer.from(indices);
  }

  const perByte = 8 / depth;
  const stride = Math.ceil(width / perByte);
  const rows = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rows[y * stride + Math.floor(x / perByte)] |=
        indices[y * width + x] << (8 - depth * ((x % perByte) + 1));
    }
  }
  return rows;
}

export function encodeIndexed(image: Image, palette: Palette, filtering: Filtering): Buffer {
  const depth = depthFor(palette.colors.length);
  const plte = Buffer.alloc(palette.colors.length * 3);

  palette.colors.forEach((color, index) => {
    plte[index * 3] = color[0];
    plte[index * 3 + 1] = color[1];
    plte[index * 3 + 2] = color[2];
  });

  // tRNS runs from the front of the palette, so it only has to be as
  // long as the last entry that is not fully opaque — which for these
  // sheets is the single transparent entry
  let last = -1;

  palette.colors.forEach((color, index) => {
    if (color[3] !== 0xff) {
      last = index;
    }
  });

  const extra = [writeChunk('PLTE', plte)];

  if (last >= 0) {
    extra.push(
      writeChunk('tRNS', Buffer.from(palette.colors.slice(0, last + 1).map((color) => color[3]))),
    );
  }

  const stride = depth < 8 ? Math.ceil(image.width / (8 / depth)) : image.width;

  return assemble(
    ihdr(image.width, image.height, depth, 3),
    extra,
    filterRows(
      packIndices(palette.indices, image.width, image.height, depth),
      stride,
      image.height,
      1,
      filtering,
    ),
  );
}

/**
 * Whether two decodes of the same sheet draw the same thing.
 *
 * Fully transparent pixels only have to stay fully transparent, for
 * the same reason `paletteOf` folds them together
 */
export function sameImage(one: Image, two: Image): boolean {
  if (one.width !== two.width || one.height !== two.height) {
    return false;
  }

  for (let at = 0; at < one.rgba.length; at += 4) {
    if (one.rgba[at + 3] === 0 && two.rgba[at + 3] === 0) {
      continue;
    }
    if (one.rgba.readUInt32BE(at) !== two.rgba.readUInt32BE(at)) {
      return false;
    }
  }
  return true;
}

/** A sheet encoded, and what it was stored as. */
export interface Encoded {
  bytes: Buffer;
  /** The container chosen, e.g. `indexed 4-bit, none` */
  as: string;
  /**
   * What the same sheet costs written the plainest way PNG can say it —
   * truecolour, unfiltered. It is what the choosing is worth, and it is
   * free to report since that candidate is always encoded anyway
   */
  plain: number;
}

/**
 * The smallest container this sheet fits in without losing a pixel.
 *
 * Both encodings are tried at both filterings and the smallest one that
 * **decodes back to the same picture** wins — the check is the whole
 * point, since a container that gives different pixels back is not a
 * smaller version of the sheet but a different sheet. A pokemon drawn in
 * sixteen colours ends up a fifth of the size it left `sharp` at
 */
export function encodeSmallest(image: Image): Encoded {
  const palette = paletteOf(image);
  const candidates: Encoded[] = [];

  let plain = 0;

  for (const filtering of ['none', 'adaptive'] as const) {
    if (palette != null) {
      candidates.push({
        as: `indexed ${depthFor(palette.colors.length)}-bit, ${filtering}`,
        bytes: encodeIndexed(image, palette, filtering),
        plain: 0,
      });
    }
    const truecolour = encodeTruecolor(image, filtering);

    if (filtering === 'none') {
      plain = truecolour.length;
    }
    candidates.push({ as: `truecolour, ${filtering}`, bytes: truecolour, plain: 0 });
  }
  candidates.sort((one, two) => one.bytes.length - two.bytes.length);

  for (const candidate of candidates) {
    if (sameImage(image, decode(candidate.bytes))) {
      return { ...candidate, plain };
    }
  }
  // Truecolour with no filtering is the plainest thing PNG can say, so
  // it failing to round-trip means the codec is wrong rather than the
  // sheet being unusual — and a sheet written wrong is worse than a run
  // that stops
  throw new Error('No encoding of this sheet decoded back to itself');
}
