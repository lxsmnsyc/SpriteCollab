import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Color, Image } from '../src/png.ts';
import decodePng, { encodeTruecolor, sameImage } from '../src/png.ts';
import {
  CELL,
  colorOf,
  colorsIn,
  hexOf,
  learn,
  paletteFor,
  readMapping,
  recolor,
  stripOf,
  swapsFromStrip,
  writeMapping,
} from '../src/recolor.ts';
import main, { coatOf, folderOf, parseArguments, parseForm } from '../src/recolor-cli.ts';
import type { SheetData } from '../src/sheet.ts';
import type { Index } from '../src/write.ts';
import { COLORS, fill, raster } from './helpers.ts';

/** A small picture in a handful of flat colours. */
function flat(one = COLORS.red, two = COLORS.green, three = COLORS.blue): Image {
  const image = raster(8, 8);

  fill(image, { x: 0, y: 0, width: 4, height: 8 }, one);
  fill(image, { x: 4, y: 0, width: 4, height: 4 }, two);
  fill(image, { x: 4, y: 4, width: 2, height: 4 }, three);
  return { width: image.width, height: image.height, rgba: image.data };
}

describe('colours as text', () => {
  it('writes a colour with its alpha', () => {
    expect(hexOf([255, 0, 0, 255])).toBe('#ff0000ff');
    expect(hexOf([0, 0, 0, 0])).toBe('#00000000');
  });

  it('reads one back however it was written', () => {
    expect(colorOf('#ff0000ff')).toEqual([255, 0, 0, 255]);
    expect(colorOf('ff0000')).toEqual([255, 0, 0, 255]);
    expect(colorOf('#f00')).toEqual([255, 0, 0, 255]);
    expect(colorOf('#f008')).toEqual([255, 0, 0, 136]);
  });

  it('refuses something that is not a colour', () => {
    expect(() => colorOf('mauve')).toThrow(/not a colour/);
    expect(() => colorOf('#ff000')).toThrow(/not a colour/);
  });
});

describe('paletteFor', () => {
  it('lists the colours in the order they are first met', () => {
    // The corner the third colour does not reach is the fourth
    expect(paletteFor(flat())).toEqual([COLORS.red, COLORS.green, COLORS.blue, COLORS.clear]);
  });

  it('counts every clear pixel as one colour, whatever it holds', () => {
    const image = flat();

    // Two transparent pixels that differ in their unused channels
    image.rgba.writeUInt32BE(0xaabbcc00, (6 * 8 + 6) * 4);
    image.rgba.writeUInt32BE(0x11223300, (7 * 8 + 7) * 4);
    expect(paletteFor(image).filter((color) => color[3] === 0)).toEqual([[0, 0, 0, 0]]);
  });
});

describe('a palette strip', () => {
  it('reads back the colours it was drawn from', () => {
    const colors = paletteFor(flat());

    expect(colorsIn(stripOf(colors))).toEqual(colors);
  });

  it('is one block a colour', () => {
    const strip = decodePng(stripOf([COLORS.red, COLORS.green]));

    expect(strip.width).toBe(2 * CELL);
    expect(strip.height).toBe(CELL);
  });

  it('reads a repainted block as the swap it is', () => {
    const before = paletteFor(flat());
    const after = [...before];

    after[1] = COLORS.white;
    expect(swapsFromStrip(before, colorsIn(stripOf(after)))).toEqual([
      { from: COLORS.green, to: COLORS.white },
    ]);
  });

  it('refuses a strip whose colours were added to or taken away', () => {
    expect(() => swapsFromStrip(paletteFor(flat()), [COLORS.red])).toThrow(/keep the order/);
  });
});

describe('learn', () => {
  it('reads the mapping between two coats of one form', () => {
    const held = learn(flat(), flat(COLORS.white, COLORS.blue, COLORS.green));

    expect(held.ambiguous).toEqual([]);
    expect(held.swaps).toEqual([
      { from: COLORS.red, to: COLORS.white },
      { from: COLORS.green, to: COLORS.blue },
      { from: COLORS.blue, to: COLORS.green },
    ]);
  });

  it('leaves out a colour that stands over two different ones', () => {
    const one = flat();
    const two = flat(COLORS.white, COLORS.blue, COLORS.green);

    // One pixel of the first colour's area painted something else
    two.rgba.writeUInt32BE(0x00ff00ff, 0);
    const held = learn(one, two);

    expect(held.swaps.map((swap) => swap.from)).not.toContainEqual(COLORS.red);
    expect(held.ambiguous).toHaveLength(1);
    expect(held.ambiguous[0].from).toEqual(COLORS.red);
    expect(held.ambiguous[0].to).toHaveLength(2);
  });

  it('learns nothing from a place one coat does not draw', () => {
    const one = flat();
    const two = flat(COLORS.white, COLORS.blue, COLORS.green);

    // A clip the second coat was never finished for: clear, not a
    // colour, and it must not make the first coat's colour ambiguous
    for (let at = 0; at < 4 * 8; at += 1) {
      two.rgba.writeUInt32BE(0, at * 4);
    }
    const held = learn(one, two);

    expect(held.ambiguous).toEqual([]);
    expect(held.swaps).toContainEqual({ from: COLORS.red, to: COLORS.white });
  });

  it('refuses two coats that are not the same size', () => {
    const small = raster(4, 4);

    expect(() =>
      learn(flat(), { width: 4, height: 4, rgba: small.data }),
    ).toThrow(/the same size/);
  });
});

describe('recolor', () => {
  it('puts the swapped colours in and leaves the shape alone', () => {
    const before = flat();
    const held = recolor(before, [{ from: COLORS.red, to: COLORS.white }]);

    expect(held.changed).toBe(32);
    expect(paletteFor(held.image)).toContainEqual(COLORS.white);
    expect(paletteFor(held.image)).not.toContainEqual(COLORS.red);
    // Every pixel that was drawn is still drawn, and no other is
    for (let at = 3; at < before.rgba.length; at += 4) {
      expect(held.image.rgba[at]).toBe(before.rgba[at]);
    }
  });

  it('says which colours no swap named', () => {
    const held = recolor(flat(), [{ from: COLORS.red, to: COLORS.white }]);

    expect(held.untouched).toEqual([COLORS.green, COLORS.blue]);
  });

  it('refuses a swap that would add or take away a transparent pixel', () => {
    expect(() => recolor(flat(), [{ from: COLORS.red, to: [0, 0, 0, 0] }])).toThrow(
      /transparent/,
    );
    expect(() => recolor(flat(), [{ from: [0, 0, 0, 0], to: COLORS.red }])).toThrow(
      /transparent/,
    );
  });

  it('leaves the sheet as it was for a mapping of identities', () => {
    const before = flat();
    const held = recolor(
      before,
      paletteFor(before)
        .filter((color) => color[3] !== 0)
        .map((color) => ({ from: color, to: color })),
    );

    expect(held.changed).toBe(0);
    expect(sameImage(before, held.image)).toBe(true);
  });

  it('turns one coat into another, given the mapping between them', () => {
    // What the tool is for: the mapping from one pair of coats, put on
    // a third, gives the fourth
    const regular = flat();
    const shiny = flat(COLORS.white, COLORS.blue, COLORS.green);
    const female = flat(COLORS.red, COLORS.green, COLORS.blue);
    const { swaps } = learn(regular, shiny);

    expect(sameImage(recolor(female, swaps).image, shiny)).toBe(true);
  });
});

describe('a mapping on disk', () => {
  it('reads back what it wrote', () => {
    const swaps = [{ from: COLORS.red as Color, to: COLORS.white as Color }];

    expect(readMapping(writeMapping(swaps, 'regular'))).toEqual(swaps);
  });

  it('says which coat it came from', () => {
    expect(JSON.parse(writeMapping([], 'female'))).toMatchObject({ version: 1, from: 'female' });
  });

  it('refuses a mapping written by something newer', () => {
    expect(() => readMapping(JSON.stringify({ version: 9, swaps: [] }))).toThrow(/version 9/);
  });
});

describe('the recolour command line', () => {
  it('reads a species and a form however they were written', () => {
    expect(parseForm('1/0')).toEqual({ dex: 1, form: 0 });
    expect(parseForm('0026/0001')).toEqual({ dex: 26, form: 1 });
    // A form nobody named is the base one
    expect(parseForm('25')).toEqual({ dex: 25, form: 0 });
    // A path out of the index reads as the numbers in it
    expect(parseForm('kanto/0003/0000')).toEqual({ dex: 3, form: 0 });
  });

  it('refuses something that names no species', () => {
    expect(() => parseForm('bulbasaur')).toThrow(/does not name a species/);
  });

  it('names a coat however it was written', () => {
    expect(coatOf('regular')).toBe('regular');
    expect(coatOf('ShinyFemale')).toBe('shinyFemale');
  });

  it('refuses a coat there is no such thing as', () => {
    expect(() => coatOf('golden')).toThrow(/is not a coat/);
  });

  it('takes the defaults where nothing is said', () => {
    expect(parseArguments(['extract', '1/0'])).toMatchObject({
      command: 'extract',
      form: '1/0',
      output: 'compact',
      coat: 'regular',
      as: null,
      file: null,
      dryRun: false,
    });
  });

  it('takes each switch it knows', () => {
    expect(
      parseArguments([
        'apply', '3/0',
        '--coat', 'female',
        '--as', 'shinyFemale',
        '--map', 'venusaur.json',
        '--out', 'elsewhere',
        '--dry-run',
      ]),
    ).toMatchObject({
      command: 'apply',
      form: '3/0',
      coat: 'female',
      as: 'shinyFemale',
      file: 'venusaur.json',
      output: 'elsewhere',
      dryRun: true,
    });
  });

  it('refuses a switch it does not know', () => {
    expect(() => parseArguments(['extract', '1/0', '--hue'])).toThrow(/no --hue option/);
  });

  it('refuses to work against a tree that is not there', () => {
    expect(() => folderOf(join(tmpdir(), 'no-such-tree'), 1, 0)).toThrow(/build the tree/);
  });
});

/** A one-form tree with a single coat in it, enough to recolour. */
function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'recolor-'));
  const folder = join(root, 'kanto/0001/0000');

  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'regular.png'), encodeTruecolor(flat(), 'none'));
  writeFileSync(
    join(folder, 'sheet.json'),
    JSON.stringify({
      version: 2,
      region: 'kanto',
      dex: 1,
      form: 0,
      coats: ['regular'],
      sheet: { width: 8, height: 8, pictures: [] },
      anims: [{ anim: 0 }],
      derived: [],
    }),
  );
  writeFileSync(
    join(root, 'index.json'),
    JSON.stringify({
      version: 1,
      regions: [{ region: 'kanto', forms: 1 }],
      slots: [
        {
          region: 'kanto',
          dex: 1,
          form: 0,
          path: 'kanto/0001/0000',
          coats: ['regular'],
          width: 8,
          height: 8,
          derived: [],
        },
      ],
    }),
  );
  return root;
}

describe('applying a mapping', () => {
  it('lists the new coat in the index as well as the sheet', () => {
    const root = tree();
    const mapping = join(root, 'map.json');

    writeFileSync(mapping, writeMapping([{ from: COLORS.red as Color, to: COLORS.blue as Color }]));
    expect(
      main(['apply', '1/0', '--coat', 'regular', '--as', 'shiny', '--map', mapping, '--out', root]),
    ).toBe(0);

    const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')) as Index;

    expect(index.slots[0].coats).toEqual(['regular', 'shiny']);
  });

  it('records the coat as ours in the sheet and the index', () => {
    const root = tree();
    const mapping = join(root, 'map.json');

    writeFileSync(mapping, writeMapping([{ from: COLORS.red as Color, to: COLORS.blue as Color }]));
    main(['apply', '1/0', '--coat', 'regular', '--as', 'shiny', '--map', mapping, '--out', root]);

    const sheet = JSON.parse(
      readFileSync(join(root, 'kanto/0001/0000/sheet.json'), 'utf8'),
    ) as SheetData;
    const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')) as Index;
    const ours = [{ coat: 'shiny', anim: null, from: 'regular' }];

    expect(sheet.derived).toEqual(ours);
    expect(index.slots[0].derived).toEqual(ours);
  });

  it('does not list the same coat twice when applied again', () => {
    const root = tree();
    const mapping = join(root, 'map.json');

    writeFileSync(mapping, writeMapping([{ from: COLORS.red as Color, to: COLORS.blue as Color }]));
    main(['apply', '1/0', '--coat', 'regular', '--as', 'shiny', '--map', mapping, '--out', root]);
    main(['apply', '1/0', '--coat', 'regular', '--as', 'shiny', '--map', mapping, '--out', root]);

    const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')) as Index;

    expect(index.slots[0].derived).toHaveLength(1);
  });

  it('leaves the coat list alone when the coat is already there', () => {
    const root = tree();
    const mapping = join(root, 'map.json');

    writeFileSync(mapping, writeMapping([{ from: COLORS.red as Color, to: COLORS.blue as Color }]));
    main(['apply', '1/0', '--coat', 'regular', '--as', 'regular', '--map', mapping, '--out', root]);

    const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')) as Index;

    expect(index.slots[0].coats).toEqual(['regular']);
  });
});
