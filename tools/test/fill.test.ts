import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpriteAnim } from '../src/anims.ts';
import fillTree from '../src/fill.ts';
import { decodeFrames } from '../src/frames.ts';
import { layoutsFor } from '../src/sheet.ts';
import { decode } from '../src/raster.ts';
import run from '../src/run.ts';
import unpack from '../src/unpack.ts';
import verifySheet from '../src/verify.ts';
import { FILENAMES } from '../src/write.ts';
import { ANIMS, writeFixture } from './fixture.ts';
import { COLORS } from './helpers.ts';

/** A tree built from a form with no Hop, and nothing made for it. */
function built(): { output: string; folder: string } {
  const held = mkdtempSync(join(tmpdir(), 'fill-'));
  const root = join(held, 'sprite');
  const output = join(held, 'compact');

  writeFixture(
    root,
    ANIMS.filter((anim) => anim.name !== 'Hop'),
    [
      { path: '0001', color: COLORS.green },
      { path: '0001/0000/0001', color: COLORS.blue },
    ],
  );
  run({ root, output, species: [1], polyfill: false });
  return { output, folder: join(output, 'kanto', '0001', '0000') };
}

describe('unpacking a sheet', () => {
  it('gives back folders the sheet reads back as', () => {
    const { folder } = built();
    const { meta, archives } = unpack(folder);
    const frames = decodeFrames(readFileSync(join(folder, 'frames.bin')));
    const sheets = meta.coats.map((key) => ({
      key,
      raster: decode(readFileSync(join(folder, FILENAMES[key]))),
    }));

    expect(verifySheet(meta, frames, layoutsFor(archives, { compact: meta.compact }), archives, sheets)).toEqual([]);
  });
});

describe('filling a built sheet', () => {
  it('makes what the sheet has not got, and says so in the sheet and the index', () => {
    const { output, folder } = built();
    const filled = fillTree(output);
    const meta = JSON.parse(readFileSync(join(folder, 'sheet.json'), 'utf8'));
    const index = JSON.parse(readFileSync(join(output, 'index.json'), 'utf8'));

    expect(filled[0].mismatches).toEqual([]);
    expect(meta.anims.map((one: { anim: number }) => one.anim)).toContain(SpriteAnim.Hop);
    expect(meta.polyfilled.map((one: { anim: number }) => one.anim)).toContain(SpriteAnim.Hop);
    expect(index.slots[0].polyfilled).toEqual(meta.polyfilled);
    expect(index.slots[0].missing).not.toContain(SpriteAnim.Hop);
  });

  it('keeps the frames it had', () => {
    const { output, folder } = built();
    const before = unpack(folder).archives;

    fillTree(output);
    const after = unpack(folder).archives;

    for (const coat of before) {
      const again = after.find((one) => one.key === coat.key)!;

      for (const [anim, images] of coat.archive.images) {
        expect(again.archive.images.get(anim)?.animation?.data.equals(images.animation!.data)).toBe(true);
      }
    }
  });

  it('leaves a sheet alone under a dry run', () => {
    const { output, folder } = built();
    const sheet = readFileSync(join(folder, 'sheet.json'), 'utf8');
    const filled = fillTree(output, { dryRun: true });

    expect(filled[0].added.length).toBeGreaterThan(0);
    expect(readFileSync(join(folder, 'sheet.json'), 'utf8')).toBe(sheet);
  });
});
