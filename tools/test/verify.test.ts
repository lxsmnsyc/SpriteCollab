import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import readArchive from '../src/archive.ts';
import { decode } from '../src/raster.ts';
import { buildSheet } from '../src/sheet.ts';
import { slotAt } from '../src/slots.ts';
import verifySheet from '../src/verify.ts';
import { SpriteAnim } from '../src/anims.ts';
import { ANIMS, writeFixture } from './fixture.ts';
import { COLORS } from './helpers.ts';

function built() {
  const root = join(mkdtempSync(join(tmpdir(), 'verify-')), 'sprite');

  writeFixture(root, ANIMS, [
    { path: '0001', color: COLORS.green },
    { path: '0001/0000/0001', color: COLORS.blue },
  ]);
  const slot = slotAt(root, 1, 0);
  const archives = slot.present.map((key) => ({
    key,
    archive: readArchive(join(root, slot.coats[key])),
  }));

  return { archives, result: buildSheet(slot, archives) };
}

describe('verifySheet', () => {
  it('is content with a sheet the optimizer just wrote', () => {
    const { archives, result } = built();

    expect(
      verifySheet(
        result.meta,
        result.frames,
        result.layouts,
        archives,
        result.coats.map((coat) => ({ key: coat.key, raster: decode(coat.bytes) })),
      ),
    ).toEqual([]);
  });

  it('catches a sheet whose pixels were meddled with', () => {
    const { archives, result } = built();
    const sheets = result.coats.map((coat) => ({ key: coat.key, raster: decode(coat.bytes) }));

    // One pixel, anywhere something is drawn
    for (let at = 0; at < sheets[0].raster.data.length; at += 4) {
      if (sheets[0].raster.data[at + 3] > 0) {
        sheets[0].raster.data[at] ^= 0xff;
        break;
      }
    }
    expect(verifySheet(result.meta, result.frames, result.layouts, archives, sheets).length).toBeGreaterThan(0);
  });

  it('catches a description pointing at a picture that is not there', () => {
    const { archives, result } = built();
    const sheets = result.coats.map((coat) => ({ key: coat.key, raster: decode(coat.bytes) }));

    const walk = result.meta.sprites.find((target) => target.anim === SpriteAnim.Walk);
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const at = result.frames.indices[walk!.frames[0]];

    result.frames.records[at].cell = result.meta.sheet.pictures.length + 10;
    expect(verifySheet(result.meta, result.frames, result.layouts, archives, sheets).length).toBeGreaterThan(0);
  });
});
