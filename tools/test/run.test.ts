import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { decode } from '../src/raster.ts';
import run, { runSlot, weighTree } from '../src/run.ts';
import type { SheetData } from '../src/sheet.ts';
import { slotAt } from '../src/slots.ts';
import verifySheet from '../src/verify.ts';
import readArchive from '../src/archive.ts';
import { buildSheet } from '../src/sheet.ts';
import type { Index } from '../src/write.ts';
import { SpriteAnim } from '../src/anims.ts';
import { decodeFrames } from '../src/frames.ts';
import { ANIMS, writeFixture } from './fixture.ts';
import { COLORS } from './helpers.ts';

/** A sprite root with one two-coat form in it. */
function fixture(): { root: string; output: string } {
  const held = mkdtempSync(join(tmpdir(), 'optimize-'));
  const root = join(held, 'sprite');

  writeFixture(root, ANIMS, [
    { path: '0001', color: COLORS.green },
    { path: '0001/0000/0001', color: COLORS.blue },
  ]);
  return { root, output: join(held, 'compact') };
}

describe('building one form', () => {
  let root: string;
  let output: string;

  beforeEach(() => {
    ({ root, output } = fixture());
  });

  it('reads every frame back as the thing it was drawn from', () => {
    const slot = slotAt(root, 1, 0);
    const archives = slot.present.map((key) => ({
      key,
      archive: readArchive(join(root, slot.coats[key])),
    }));
    const result = buildSheet(slot, archives);

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

  it('stores a mirrored row as its reflection rather than again', () => {
    const report = runSlot(slotAt(root, 1, 0), { root, output, species: [], dryRun: true });
    const flipped = Object.values(report.mismatches);

    expect(flipped).toEqual([]);
    // Every frame of the fixture is one of a handful of drawings, and
    // half the rows are the other half mirrored
    expect(report.pictures).toBeLessThan(report.frames / 2);
  });

  it('describes both coats with one description', () => {
    const report = runSlot(slotAt(root, 1, 0), { root, output, species: [], dryRun: true });

    expect(report.coats).toEqual(['regular', 'shiny']);
  });

  it('comes out smaller than the folders it was built from', () => {
    const report = runSlot(slotAt(root, 1, 0), { root, output, species: [], dryRun: true });

    expect(report.after).toBeLessThan(report.before);
  });

  it('reads a coat drawn for fewer directions than the rest', () => {
    const held = mkdtempSync(join(tmpdir(), 'optimize-'));
    const short = join(held, 'sprite');

    writeFixture(short, ANIMS, [
      { path: '0001', color: COLORS.green },
      { path: '0001/0000/0001', color: COLORS.blue, rows: 6 },
    ]);
    const slot = slotAt(short, 1, 0);
    const archives = slot.present.map((key) => ({
      key,
      archive: readArchive(join(short, slot.coats[key])),
    }));
    const result = buildSheet(slot, archives);

    expect(result.meta.sprites.find((target) => target.anim === SpriteAnim.Walk)?.rows).toBe(8);
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

  it('lines up a coat padded to a cell of another size', () => {
    const held = mkdtempSync(join(tmpdir(), 'optimize-'));
    const other = join(held, 'sprite');

    // The same drawing, padded to a 12x12 cell rather than an 8x8 one
    writeFixture(other, ANIMS, [
      { path: '0001', color: COLORS.green },
      { path: '0001/0000/0001', color: COLORS.green, cell: { width: 12, height: 12 } },
    ]);
    const slot = slotAt(other, 1, 0);
    const archives = slot.present.map((key) => ({
      key,
      archive: readArchive(join(other, slot.coats[key])),
    }));
    const result = buildSheet(slot, archives);
    const alone = buildSheet(slot, archives.slice(0, 1));

    // Lined up on the cell's centre the two coats are the same drawing,
    // so the pair costs exactly what the ordinary coat costs alone
    expect(result.pictures).toBe(alone.pictures);
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

  it('leaves out a coat that disagrees about how many frames there are', () => {
    const held = mkdtempSync(join(tmpdir(), 'optimize-'));
    const other = join(held, 'sprite');

    writeFixture(other, ANIMS, [{ path: '0001', color: COLORS.green }]);
    // A coat drawn with an extra frame in every clip: there is no
    // lining that up against one with fewer
    writeFixture(
      other,
      ANIMS.map((anim) => ({ ...anim, columns: anim.columns + 1 })),
      [{ path: '0001/0000/0001', color: COLORS.blue }],
    );
    const slot = slotAt(other, 1, 0);
    const archives = slot.present.map((key) => ({
      key,
      archive: readArchive(join(other, slot.coats[key])),
    }));
    const result = buildSheet(slot, archives);

    expect(result.layouts[0].coats[0]).not.toBeNull();
    expect(result.layouts[0].coats[1]).toBeNull();
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

  it('keeps every frame whole where it is told not to compact', () => {
    const report = runSlot(slotAt(root, 1, 0), {
      root,
      output,
      species: [],
      compact: false,
      dryRun: true,
    });

    expect(report.mismatches).toEqual([]);
    expect(report.width).toBeGreaterThan(0);
  });

  it('writes nothing at all for a dry run', () => {
    runSlot(slotAt(root, 1, 0), { root, output, species: [], dryRun: true });
    expect(existsSync(output)).toBe(false);
  });
});

describe('a whole run', () => {
  let root: string;
  let output: string;

  beforeEach(() => {
    ({ root, output } = fixture());
  });

  it('writes a sheet for each coat and one description beside them', () => {
    run({ all: true, root, output, species: [1] });

    const folder = join(output, 'kanto', '0001', '0000');

    expect(existsSync(join(folder, 'regular.png'))).toBe(true);
    expect(existsSync(join(folder, 'shiny.png'))).toBe(true);
    expect(existsSync(join(folder, 'female.png'))).toBe(false);
    expect(existsSync(join(folder, 'sheet.json'))).toBe(true);
    expect(existsSync(join(folder, 'frames.bin'))).toBe(true);
  });

  it('describes the sheet in a shape a reader can follow', () => {
    run({ all: true, root, output, species: [1] });

    const meta = JSON.parse(
      readFileSync(join(output, 'kanto', '0001', '0000', 'sheet.json'), 'utf8'),
    ) as SheetData;

    expect(meta).toMatchObject({
      version: 2,
      dex: 1,
      form: 0,
      region: 'kanto',
      compact: true,
      shadowSize: 1,
    });
    expect(meta.name).toBeNull();
    expect(meta.coats).toEqual(['regular', 'shiny']);
    expect(meta.sheet.pictures.length).toBeGreaterThan(0);
    // The copy is described, and points at what it copies
    expect(meta.anims.map((anim) => anim.anim)).toEqual([
      SpriteAnim.Walk,
      SpriteAnim.Idle,
      SpriteAnim.Strike,
    ]);
    expect(meta.anims.find((anim) => anim.anim === SpriteAnim.Strike)).toMatchObject({
      copyOf: SpriteAnim.Walk,
      target: SpriteAnim.Walk,
    });
    // Only the animations that are drawn have frames of their own
    expect(meta.sprites.map((target) => target.anim)).toEqual([SpriteAnim.Idle, SpriteAnim.Walk]);

    const walk = meta.sprites.find((target) => target.anim === SpriteAnim.Walk);

    expect(walk?.rows).toBe(8);
    expect(walk?.frames[1]).toBe(16);
    expect(meta.credits.regular?.[0]).toMatchObject({ name: 'CHUNSOFT', license: 'Unspecified' });
  });

  it('names the species and the form where the record says', () => {
    const tracker = join(root, '..', 'tracker.json');

    writeFileSync(
      tracker,
      JSON.stringify({ '0001': { name: 'Bulbasaur', subgroups: { '0002': { name: 'Altcolor' } } } }),
    );
    writeFixture(root, ANIMS, [{ path: '0001/0002', color: COLORS.red }]);
    run({ all: true, root, output, species: [1], tracker });

    const read = (form: string): SheetData =>
      JSON.parse(readFileSync(join(output, 'kanto', '0001', form, 'sheet.json'), 'utf8')) as SheetData;

    expect(read('0000')).toMatchObject({ name: 'Bulbasaur', formName: null });
    expect(read('0002')).toMatchObject({ name: 'Bulbasaur', formName: 'Altcolor' });
  });

  it('writes the frames as a table beside the description', () => {
    run({ all: true, root, output, species: [1] });

    const folder = join(output, 'kanto', '0001', '0000');
    const meta = JSON.parse(readFileSync(join(folder, 'sheet.json'), 'utf8')) as SheetData;
    const frames = decodeFrames(readFileSync(join(folder, 'frames.bin')));
    const walk = meta.sprites.find((target) => target.anim === SpriteAnim.Walk);

    expect(walk).toBeDefined();
    expect(frames.indices).toHaveLength(
      meta.sprites.reduce((total, target) => total + target.frames[1], 0),
    );
    // Every frame points at a record, and every record at a picture
    for (const index of frames.indices) {
      expect(frames.records[index]).toBeDefined();
      expect(meta.sheet.pictures[frames.records[index].cell]).toBeDefined();
    }
    // The table holds each distinct frame once
    expect(frames.records.length).toBeLessThanOrEqual(frames.indices.length);
    expect(new Set(frames.records.map((record) => JSON.stringify(record))).size).toBe(
      frames.records.length,
    );
  });

  it('files a regional form under the region it is named for', () => {
    const tracker = join(root, '..', 'tracker.json');

    writeFileSync(
      tracker,
      JSON.stringify({ '0001': { name: 'Bulbasaur', subgroups: { '0002': { name: 'Alola' } } } }),
    );
    writeFixture(root, ANIMS, [{ path: '0001/0002', color: COLORS.red }]);
    const report = run({ all: true, root, output, species: [1], tracker });

    expect(report.slots.map((slot) => slot.region)).toEqual(['kanto', 'alola']);
    expect(existsSync(join(output, 'alola', '0001', '0002', 'sheet.json'))).toBe(true);
    expect(existsSync(join(output, 'kanto', '0001', '0000', 'sheet.json'))).toBe(true);
    // And the species is weighed across both places it landed in
    expect(report.species[0].regions).toEqual(['kanto', 'alola']);
    expect(report.species[0].after).toBe(
      weighTree(join(output, 'kanto', '0001')) + weighTree(join(output, 'alola', '0001')),
    );
  });

  it('weighs each species folder against the tree that replaced it', () => {
    writeFixture(root, ANIMS, [{ path: '0001/0002', color: COLORS.red }]);
    // Something in the species folder that is not a sprite at all
    writeFileSync(join(root, '0001', 'notes.txt'), 'x'.repeat(4096));

    const report = run({ all: true, root, output, species: [1] });

    expect(report.species).toHaveLength(1);
    expect(report.species[0]).toMatchObject({ dex: 1, forms: 2 });
    // The whole folder, including what is not a sprite
    expect(report.species[0].before).toBe(weighTree(join(root, '0001')));
    expect(report.species[0].after).toBe(weighTree(join(output, 'kanto', '0001')));
    expect(report.species[0].after).toBeLessThan(report.species[0].before);
    // And the run's own totals are the species totals
    expect(report.before).toBe(report.species[0].before);
    expect(report.after).toBe(report.species[0].after);
  });

  it('weighs a species it only pretended to write', () => {
    const report = run({ all: true, root, output, species: [1], dryRun: true });

    expect(report.species[0].before).toBe(weighTree(join(root, '0001')));
    expect(report.species[0].after).toBe(report.slots[0].after);
  });

  it('measures a species before pruning takes it away', () => {
    const before = weighTree(join(root, '0001'));
    const report = run({ all: true, root, output, species: [1], prune: true });

    expect(report.species[0].before).toBe(before);
    expect(existsSync(join(root, '0001'))).toBe(false);
  });

  it('says nothing about a species it built nothing for', () => {
    expect(run({ all: true, root, output, species: [999] }).species).toEqual([]);
  });

  it('gives a coat the animation its pair has and it has not', () => {
    const held = mkdtempSync(join(tmpdir(), 'optimize-'));
    const other = join(held, 'sprite');

    writeFixture(other, ANIMS, [{ path: '0001', color: COLORS.green }]);
    // A shiny finished for Idle and not for Walk
    writeFixture(other, ANIMS.slice(1, 2), [
      { path: '0001/0000/0001', color: COLORS.blue },
    ]);
    const report = run({ all: true, root: other, output, species: [1] });
    const meta = JSON.parse(
      readFileSync(join(output, 'kanto', '0001', '0000', 'sheet.json'), 'utf8'),
    ) as SheetData;

    expect(report.slots[0].refused).toEqual([]);
    expect(meta.derived).toEqual([
      { coat: 'shiny', anim: SpriteAnim.Walk, from: 'regular' },
    ]);
    expect(report.slots[0].mismatches).toEqual([]);
  });

  it('leaves the gap where it is told not to merge', () => {
    const held = mkdtempSync(join(tmpdir(), 'optimize-'));
    const other = join(held, 'sprite');

    writeFixture(other, ANIMS, [{ path: '0001', color: COLORS.green }]);
    writeFixture(other, ANIMS.slice(1, 2), [
      { path: '0001/0000/0001', color: COLORS.blue },
    ]);
    const report = run({ all: true, root: other, output, species: [1], merge: false });

    expect(report.slots[0].derived).toEqual([]);
  });

  it('counts how many frames carry each anchor', () => {
    const report = run({ all: true, root, output, species: [1] });

    // The fixture marks a shadow, a body and a head on every frame, and
    // no hands at all
    expect(report.anchors.frames).toBe(
      report.slots.reduce((total, slot) => total + slot.frames, 0),
    );
    expect(report.anchors.shadow).toBe(report.anchors.frames);
    expect(report.anchors.center).toBe(report.anchors.frames);
    expect(report.anchors.head).toBe(report.anchors.frames);
    expect(report.anchors.left).toBe(0);
    expect(report.anchors.right).toBe(0);
  });

  it('lists what it wrote in an index', () => {
    const report = run({ all: true, root, output, species: [1] });

    const index = JSON.parse(readFileSync(join(output, 'index.json'), 'utf8')) as Index;

    expect(index.slots).toHaveLength(1);
    expect(index.slots[0]).toMatchObject({
      region: 'kanto',
      dex: 1,
      form: 0,
      path: 'kanto/0001/0000',
    });
    expect(index.regions).toEqual([{ region: 'kanto', forms: 1 }]);
    // So the whole tree can be told from the collection's art without
    // opening every sheet
    expect(index.slots[0].derived).toEqual(report.slots[0].derived);
  });

  it('takes away a coat it has no art to rebuild, and says whose it was', () => {
    run({ all: true, root, output, species: [1] });

    const folder = join(output, 'kanto/0001/0000');
    const sheet = JSON.parse(readFileSync(join(folder, 'sheet.json'), 'utf8')) as SheetData;

    // A coat somebody recoloured by hand: the collection has no art for
    // it, so the next build cannot make it again
    writeFileSync(join(folder, 'shiny_female.png'), readFileSync(join(folder, 'regular.png')));
    sheet.coats = [...sheet.coats, 'shinyFemale'];
    sheet.derived = [{ coat: 'shinyFemale', anim: null, from: 'female' }];
    writeFileSync(join(folder, 'sheet.json'), JSON.stringify(sheet));

    const report = run({ all: true, root, output, species: [1] });

    expect(existsSync(join(folder, 'shiny_female.png'))).toBe(false);
    expect(report.slots[0].dropped).toEqual([{ coat: 'shinyFemale', ours: true }]);

    const after = JSON.parse(readFileSync(join(folder, 'sheet.json'), 'utf8')) as SheetData;

    expect(after.coats).not.toContain('shinyFemale');
  });

  it('does not call a leftover coat ours when the sheet never claimed it', () => {
    run({ all: true, root, output, species: [1] });

    const folder = join(output, 'kanto/0001/0000');

    writeFileSync(join(folder, 'female.png'), readFileSync(join(folder, 'regular.png')));

    const report = run({ all: true, root, output, species: [1] });

    expect(report.slots[0].dropped).toEqual([{ coat: 'female', ours: false }]);
  });

  it('says what a dry run would drop without dropping it', () => {
    run({ all: true, root, output, species: [1] });

    const folder = join(output, 'kanto/0001/0000');

    writeFileSync(join(folder, 'female.png'), readFileSync(join(folder, 'regular.png')));

    const report = run({ all: true, root, output, species: [1], dryRun: true });

    expect(report.slots[0].dropped).toEqual([{ coat: 'female', ours: false }]);
    expect(existsSync(join(folder, 'female.png'))).toBe(true);
  });

  it('drops nothing when every coat it wrote is one it drew', () => {
    run({ all: true, root, output, species: [1] });

    expect(run({ all: true, root, output, species: [1] }).slots[0].dropped).toEqual([]);
  });

  it('says which of the common animations a form has not got', () => {
    const report = run({ all: true, root, output, species: [1] });

    const index = JSON.parse(readFileSync(join(output, 'index.json'), 'utf8')) as Index;
    // The fixture draws Walk and Idle and nothing else common
    const short = [
      SpriteAnim.Sleep,
      SpriteAnim.Hurt,
      SpriteAnim.Attack,
      SpriteAnim.Double,
      SpriteAnim.Swing,
      SpriteAnim.Charge,
      SpriteAnim.Rotate,
      SpriteAnim.Hop,
    ];

    expect(report.slots[0].missing).toEqual(short);
    expect(index.slots[0].missing).toEqual(short);
  });

  it('reads the index off the tree, so it cannot drift from the sheets', () => {
    writeFixture(root, ANIMS, [{ path: '0025', color: COLORS.red }]);
    run({ all: true, root, output, species: [1] });
    run({ all: true, root, output, species: [25] });

    const index = JSON.parse(readFileSync(join(output, 'index.json'), 'utf8')) as Index;

    for (const slot of index.slots) {
      const sheet = JSON.parse(
        readFileSync(join(output, slot.path, 'sheet.json'), 'utf8'),
      ) as SheetData;

      expect(slot.coats).toEqual(sheet.coats);
      expect(slot.width).toBe(sheet.sheet.width);
      expect(slot.height).toBe(sheet.sheet.height);
    }
  });

  it('checks a sheet already written without building it again', () => {
    run({ all: true, root, output, species: [1] });

    const report = run({ all: true, root, output, species: [1], check: true });

    expect(report.slots[0].mismatches).toEqual([]);
    expect(report.slots[0].width).toBe(run({ all: true, root, output, species: [1] }).slots[0].width);
  });

  it('takes the folders away on the strength of a check', () => {
    run({ all: true, root, output, species: [1] });
    const report = run({ all: true, root, output, species: [1], check: true, prune: true });

    expect(report.failed).toEqual([]);
    expect(report.slots[0].mismatches).toEqual([]);
    expect(report.slots[0].removed.length).toBeGreaterThan(0);
    expect(existsSync(join(root, '0001'))).toBe(false);
  });

  it('leaves a hand-made coat alone where a rebuild would drop it', () => {
    run({ all: true, root, output, species: [1] });

    const folder = join(output, 'kanto/0001/0000');
    const sheet = JSON.parse(readFileSync(join(folder, 'sheet.json'), 'utf8')) as SheetData;

    writeFileSync(join(folder, 'shiny_female.png'), readFileSync(join(folder, 'regular.png')));
    sheet.coats = [...sheet.coats, 'shinyFemale'];
    writeFileSync(join(folder, 'sheet.json'), JSON.stringify(sheet));

    const report = run({ all: true, root, output, species: [1], check: true });

    expect(report.slots[0].mismatches).toEqual([]);
    expect(existsSync(join(folder, 'shiny_female.png'))).toBe(true);
  });

  it('will not pass a check where the sheet has no coat the folders drew', () => {
    run({ all: true, root, output, species: [1] });

    const folder = join(output, 'kanto/0001/0000');
    const sheet = JSON.parse(readFileSync(join(folder, 'sheet.json'), 'utf8')) as SheetData;

    sheet.coats = sheet.coats.filter((coat) => coat !== 'regular');
    writeFileSync(join(folder, 'sheet.json'), JSON.stringify(sheet));

    const report = run({ all: true, root, output, species: [1], check: true, prune: true });

    expect(report.slots[0].mismatches).toHaveLength(1);
    expect(report.slots[0].removed).toEqual([]);
    expect(existsSync(join(root, '0001'))).toBe(true);
  });

  it('adds to the index rather than replacing it', () => {
    writeFixture(root, ANIMS, [{ path: '0025', color: COLORS.red }]);
    run({ all: true, root, output, species: [1] });
    run({ all: true, root, output, species: [25] });

    const index = JSON.parse(readFileSync(join(output, 'index.json'), 'utf8')) as Index;

    expect(index.slots.map((slot) => slot.dex)).toEqual([1, 25]);
  });

  it('does every species where none is named', () => {
    writeFixture(root, ANIMS, [{ path: '0025', color: COLORS.red }]);

    expect(run({ all: true, root, output, species: [] }).slots.map((slot) => slot.dex)).toEqual([1, 25]);
  });

  it('takes the source folders away only where it is asked to', () => {
    run({ all: true, root, output, species: [1] });
    expect(existsSync(join(root, '0001', 'AnimData.xml'))).toBe(true);

    const report = run({ all: true, root, output, species: [1], prune: true });

    expect(report.slots[0].removed.length).toBeGreaterThan(0);
    expect(existsSync(join(root, '0001', 'AnimData.xml'))).toBe(false);
    expect(existsSync(join(root, '0001', '0000', '0001'))).toBe(false);
    // The species folder went with the last thing in it
    expect(existsSync(join(root, '0001'))).toBe(false);
    // And the sheet it was replaced by is still there
    expect(existsSync(join(output, 'kanto', '0001', '0000', 'regular.png'))).toBe(true);
  });

  it('leaves the other forms of a species alone when it prunes one', () => {
    writeFixture(root, ANIMS, [{ path: '0001/0002', color: COLORS.red }]);
    // The base form alone: its regular coat is the species folder, which
    // is also where every other form lives
    runSlot(slotAt(root, 1, 0), { root, output, species: [], prune: true });

    expect(existsSync(join(root, '0001', 'AnimData.xml'))).toBe(false);
    expect(existsSync(join(root, '0001', '0002', 'AnimData.xml'))).toBe(true);
  });

  it('carries on past a form it cannot read', () => {
    writeFixture(root, ANIMS, [{ path: '0025', color: COLORS.red }]);
    // A description naming an animation that copies one it does not have
    const broken = join(root, '0025', 'AnimData.xml');

    writeFileSync(
      broken,
      '<?xml version="1.0" ?><AnimData><ShadowSize>1</ShadowSize><Anims><Anim><Name>Walk</Name><CopyOf>Idle</CopyOf></Anim></Anims></AnimData>',
    );
    const report = run({ all: true, root, output, species: [1, 25] });

    expect(report.slots.map((slot) => slot.dex)).toEqual([1]);
    expect(report.failed).toEqual([{ dex: 25, form: 0, error: expect.stringContaining('Idle') }]);
  });
});

describe('the bare minimum', () => {
  /** The six a form has to have, as fixture animations. */
  const SIX = ['Idle', 'Attack', 'Walk', 'Sleep', 'Hurt', 'Hop'].map((name, index) => ({
    name,
    index,
    frameWidth: 8,
    frameHeight: 8,
    columns: 1,
    rows: 8,
    durations: [8],
  }));

  it('leaves a form whose regular coat is short of one of the six', () => {
    const held = mkdtempSync(join(tmpdir(), 'optimize-'));
    const root = join(held, 'sprite');
    const output = join(held, 'compact');

    writeFixture(root, SIX.slice(0, 5), [{ path: '0001', color: COLORS.green }]);
    const report = run({ root, output, species: [1] });

    expect(report.slots).toHaveLength(0);
    expect(report.skipped).toEqual([{ dex: 1, form: 0, missing: [SpriteAnim.Hop] }]);
    expect(existsSync(join(output, 'kanto', '0001'))).toBe(false);
  });

  it('builds one that has all six', () => {
    const held = mkdtempSync(join(tmpdir(), 'optimize-'));
    const root = join(held, 'sprite');
    const output = join(held, 'compact');

    writeFixture(root, SIX, [{ path: '0001', color: COLORS.green }]);
    const report = run({ root, output, species: [1] });

    expect(report.skipped).toHaveLength(0);
    expect(report.slots).toHaveLength(1);
  });

  it('counts a form with no regular coat as short of all six', () => {
    const held = mkdtempSync(join(tmpdir(), 'optimize-'));
    const root = join(held, 'sprite');
    const output = join(held, 'compact');

    // Drawn as a shiny and nothing else, the way Gimmighoul is
    writeFixture(root, SIX, [{ path: '0001/0000/0001', color: COLORS.blue }]);
    const report = run({ root, output, species: [1] });

    expect(report.slots).toHaveLength(0);
    expect(report.skipped[0].missing).toHaveLength(6);
  });

  it('builds it anyway when asked for all of them', () => {
    const held = mkdtempSync(join(tmpdir(), 'optimize-'));
    const root = join(held, 'sprite');
    const output = join(held, 'compact');

    writeFixture(root, SIX.slice(0, 5), [{ path: '0001', color: COLORS.green }]);
    const report = run({ root, output, species: [1], all: true });

    expect(report.skipped).toHaveLength(0);
    expect(report.slots).toHaveLength(1);
  });

  it('does not take the folders of a form it did not build', () => {
    const held = mkdtempSync(join(tmpdir(), 'optimize-'));
    const root = join(held, 'sprite');
    const output = join(held, 'compact');

    writeFixture(root, SIX.slice(0, 5), [{ path: '0001', color: COLORS.green }]);
    run({ root, output, species: [1], prune: true });

    expect(existsSync(join(root, '0001', 'AnimData.xml'))).toBe(true);
  });
});
