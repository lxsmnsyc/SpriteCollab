import { deflateSync, inflateSync } from 'node:zlib';
import type { Point } from './markers.ts';

/**
 * The per-frame data, as a file of its own.
 *
 * This is where a sheet's description actually goes. A form has on the
 * order of a thousand frames, each carrying five anchors, which picture
 * it is, whether it is mirrored and where it sits — fourteen small
 * whole numbers. Written as JSON that is about seventy bytes a frame
 * once the brackets, commas and `null`s are counted, and across the
 * collection it comes to three times what the drawings themselves cost.
 * The same numbers as little-endian 16-bit integers are twenty-eight
 * bytes, and the frames repeat enough between them that storing each
 * distinct one once and pointing at it costs about ten.
 *
 * So `sheet.json` describes the structure — the grids, the timings, the
 * credits, all the parts a person might read — and `frames.bin` holds
 * the numbers.
 *
 *     magic     4 bytes, "PMDF"
 *     version   uint16
 *     records   uint16, how many distinct frames there are
 *     indices   uint32, how many frames point at them
 *     deflate(records × 14 × int16, column by column
 *             ++ indices × uint16)
 *
 * A frame's record is `shadow`, `center`, `head`, `left` and `right` as
 * x and y pairs, then the picture, whether it is mirrored, and the
 * corner it sits at. An anchor the frame does not carry is written as
 * `ABSENT` in both of its slots.
 *
 * The table is written a column at a time — every frame's shadow x,
 * then every frame's shadow y, and so on — rather than a frame at a
 * time. One column holds one kind of number, so its values are alike
 * and mostly small, and deflate finds far more to say about that than
 * about fourteen unrelated numbers repeated in a row. Together the two
 * take the table to under a third of what it costs written plainly,
 * which is what makes it worth the inflate on the way in.
 */

export const MAGIC = 'PMDF';
export const VERSION = 2;

/** How many numbers one frame is written as. */
export const RECORD = 14;

/** An anchor the frame does not carry, which is not a coordinate. */
export const ABSENT = -32768;

/** One frame, as the description means it. */
export interface Frame {
  shadow: Point | null;
  center: Point | null;
  head: Point | null;
  left: Point | null;
  right: Point | null;
  /** Which picture of the sheet it is. */
  cell: number;
  /** Whether that picture is drawn mirrored. */
  flip: boolean;
  /** The picture's corner inside this frame's box. */
  at: Point;
}

/** A frame table, and the stream of frames that point into it. */
export interface Frames {
  records: Frame[];
  /** One index a frame, in the order the animations claim them. */
  indices: number[];
}

/** One anchor into two columns, `stride` apart. */
function writePoint(into: Int16Array, at: number, stride: number, point: Point | null): void {
  into[at] = point == null ? ABSENT : point[0];
  into[at + stride] = point == null ? ABSENT : point[1];
}

function readPoint(from: Int16Array, at: number, stride: number): Point | null {
  return from[at] === ABSENT && from[at + stride] === ABSENT
    ? null
    : [from[at], from[at + stride]];
}

/**
 * Something to add frames to, which keeps each distinct one once.
 *
 * Frames repeat between animations for the same reason pictures do: a
 * pose held still is the same anchors and the same picture in the same
 * place, whichever clip it is in
 */
export interface Builder {
  /** Adds frames, and resolves where in the stream they landed. */
  add(frames: Frame[]): { offset: number; count: number };
  /** Everything added so far. */
  built(): Frames;
}

/** A key that is equal exactly when two frames are the same frame. */
function keyOf(frame: Frame): string {
  const point = (held: Point | null): string => (held == null ? '' : `${held[0]},${held[1]}`);

  return [
    point(frame.shadow),
    point(frame.center),
    point(frame.head),
    point(frame.left),
    point(frame.right),
    frame.cell,
    frame.flip ? 1 : 0,
    frame.at[0],
    frame.at[1],
  ].join('|');
}

export function builder(): Builder {
  const records: Frame[] = [];
  const indices: number[] = [];
  const held = new Map<string, number>();

  return {
    add(frames) {
      const offset = indices.length;

      for (const frame of frames) {
        const key = keyOf(frame);
        let at = held.get(key);

        if (at == null) {
          at = records.length;
          records.push(frame);
          held.set(key, at);
        }
        indices.push(at);
      }
      return { offset, count: frames.length };
    },
    built() {
      return { records, indices };
    },
  };
}

/** The table and its stream, as the bytes of `frames.bin`. */
export function encodeFrames(frames: Frames): Buffer {
  if (frames.records.length > 0xffff) {
    throw new Error('A sheet cannot hold more than 65535 distinct frames');
  }
  const header = Buffer.alloc(12);

  header.write(MAGIC, 0, 'ascii');
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(frames.records.length, 6);
  header.writeUInt32LE(frames.indices.length, 8);

  const count = frames.records.length;
  const table = new Int16Array(count * RECORD);

  // Column by column: `table[column * count + at]` rather than
  // `table[at * RECORD + column]`
  for (let at = 0; at < count; at += 1) {
    const frame = frames.records[at];

    writePoint(table, at, count, frame.shadow);
    writePoint(table, at + count * 2, count, frame.center);
    writePoint(table, at + count * 4, count, frame.head);
    writePoint(table, at + count * 6, count, frame.left);
    writePoint(table, at + count * 8, count, frame.right);
    table[at + count * 10] = frame.cell;
    table[at + count * 11] = frame.flip ? 1 : 0;
    table[at + count * 12] = frame.at[0];
    table[at + count * 13] = frame.at[1];
  }
  const stream = new Uint16Array(frames.indices);

  return Buffer.concat([
    header,
    deflateSync(
      Buffer.concat([
        Buffer.from(table.buffer, table.byteOffset, table.byteLength),
        Buffer.from(stream.buffer, stream.byteOffset, stream.byteLength),
      ]),
      { level: 9 },
    ),
  ]);
}

/** Reads back what `encodeFrames` wrote. */
export function decodeFrames(bytes: Buffer): Frames {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== MAGIC) {
    throw new Error('This is not a frame table');
  }
  const version = bytes.readUInt16LE(4);

  if (version !== VERSION) {
    throw new Error(`This frame table is version ${version}, which is not the one written here`);
  }
  const count = bytes.readUInt16LE(6);
  const streamed = bytes.readUInt32LE(8);
  const body = inflateSync(bytes.subarray(12));
  const table = new Int16Array(count * RECORD);

  // Copied rather than read in place: an inflated Buffer carries no
  // promise of being aligned to two bytes
  Buffer.from(table.buffer, table.byteOffset, table.byteLength).set(
    body.subarray(0, count * RECORD * 2),
  );
  const records: Frame[] = [];

  for (let at = 0; at < count; at += 1) {
    records.push({
      shadow: readPoint(table, at, count),
      center: readPoint(table, at + count * 2, count),
      head: readPoint(table, at + count * 4, count),
      left: readPoint(table, at + count * 6, count),
      right: readPoint(table, at + count * 8, count),
      cell: table[at + count * 10],
      flip: table[at + count * 11] === 1,
      at: [table[at + count * 12], table[at + count * 13]],
    });
  }
  const stream = new Uint16Array(streamed);

  Buffer.from(stream.buffer, stream.byteOffset, stream.byteLength).set(
    body.subarray(count * RECORD * 2, count * RECORD * 2 + streamed * 2),
  );
  return { records, indices: [...stream] };
}
