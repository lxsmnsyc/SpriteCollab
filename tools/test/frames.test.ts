import { describe, expect, it } from 'vitest';
import type { Frame } from '../src/frames.ts';
import { ABSENT, builder, decodeFrames, encodeFrames } from '../src/frames.ts';

/** One frame, with everything but the anchors given. */
function frame(cell: number, at: [number, number], shadow: [number, number] | null = [1, 2]): Frame {
  return { shadow, center: [3, 4], head: null, left: [-5, 6], right: null, cell, flip: false, at };
}

describe('the frame table', () => {
  it('reads back exactly what it wrote', () => {
    const built = builder();

    built.add([frame(0, [1, 1]), frame(1, [2, 2])]);
    built.add([frame(0, [1, 1])]);
    const frames = built.built();

    expect(decodeFrames(encodeFrames(frames))).toEqual(frames);
  });

  it('keeps a coordinate that fell outside its frame', () => {
    const built = builder();

    built.add([{ ...frame(0, [0, 0]), shadow: [-9, -12] }]);
    expect(decodeFrames(encodeFrames(built.built())).records[0].shadow).toEqual([-9, -12]);
  });

  it('tells an anchor that is absent from one at the origin', () => {
    const built = builder();

    built.add([{ ...frame(0, [0, 0]), head: [0, 0] }, { ...frame(1, [0, 0]), head: null }]);
    const read = decodeFrames(encodeFrames(built.built()));

    expect(read.records[0].head).toEqual([0, 0]);
    expect(read.records[1].head).toBeNull();
    expect(ABSENT).toBe(-32768);
  });

  it('stores a repeated frame once and points at it twice', () => {
    const built = builder();
    const one = built.add([frame(0, [1, 1]), frame(1, [2, 2])]);
    const two = built.add([frame(1, [2, 2])]);
    const frames = built.built();

    expect(one).toEqual({ offset: 0, count: 2 });
    expect(two).toEqual({ offset: 2, count: 1 });
    expect(frames.records).toHaveLength(2);
    expect(frames.indices).toEqual([0, 1, 1]);
  });

  it('costs a good deal less than the same frames as JSON', () => {
    const built = builder();

    for (let at = 0; at < 500; at += 1) {
      built.add([frame(at % 40, [at % 7, at % 5])]);
    }
    const frames = built.built();

    expect(encodeFrames(frames).length).toBeLessThan(JSON.stringify(frames).length / 3);
  });

  it('refuses bytes that are not a frame table', () => {
    expect(() => decodeFrames(Buffer.from('not a frame table at all'))).toThrow(/not a frame table/);
  });

  it('refuses a table written by something newer', () => {
    const bytes = encodeFrames(builder().built());

    bytes.writeUInt16LE(99, 4);
    expect(() => decodeFrames(bytes)).toThrow(/version 99/);
  });
});
