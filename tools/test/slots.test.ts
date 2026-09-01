import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { formsOf, pad, slotAt, slotsOf, speciesIn, spritePath } from '../src/slots.ts';
import { ANIMS, writeFixture } from './fixture.ts';
import { COLORS } from './helpers.ts';

describe('spritePath', () => {
  it('is the species alone for its ordinary drawing', () => {
    expect(spritePath(1, 0, 0, 0)).toBe('0001');
  });

  it('writes the folders a coat needs and no more', () => {
    expect(spritePath(1, 0, 1, 0)).toBe('0001/0000/0001');
    expect(spritePath(1, 0, 0, 2)).toBe('0001/0000/0000/0002');
    expect(spritePath(1, 0, 1, 2)).toBe('0001/0000/0001/0002');
  });

  it('writes the folder a male drawing needs', () => {
    // The gender level is three-valued: 0 for the drawing used whatever
    // the pokemon is, 1 for male and 2 for female
    expect(spritePath(178, 0, 0, 1)).toBe('0178/0000/0000/0001');
    expect(spritePath(178, 0, 1, 1)).toBe('0178/0000/0001/0001');
  });

  it('drops the trailing defaults of a form as well', () => {
    expect(spritePath(25, 6, 0, 0)).toBe('0025/0006');
    expect(spritePath(25, 6, 1, 0)).toBe('0025/0006/0001');
  });

  it('writes every number as four digits', () => {
    expect(pad(1)).toBe('0001');
    expect(pad(1025)).toBe('1025');
  });
});

describe('reading a sprite root', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'slots-'));
    // Bulbasaur, with a shiny and a female
    writeFixture(root, ANIMS, [
      { path: '0001', color: COLORS.green },
      { path: '0001/0000/0001', color: COLORS.blue },
      { path: '0001/0000/0000/0002', color: COLORS.red },
    ]);
    // Pikachu, whose base form and Libre form are both drawn
    writeFixture(root, ANIMS, [
      { path: '0025', color: COLORS.green },
      { path: '0025/0006', color: COLORS.blue },
    ]);
    // A folder that is only there to hold something else
    mkdirSync(join(root, '0099', '0000', '0001'), { recursive: true });
    writeFileSync(join(root, '0099', 'notes.txt'), 'nothing drawn here');
    // A form drawn as a shiny and nothing else, which the collection
    // does for a couple of the Altcolor forms
    writeFixture(root, ANIMS, [{ path: '0050/0004/0001', color: COLORS.blue }]);
  });

  it('lists the species that are folders', () => {
    expect(speciesIn(root)).toEqual([1, 25, 50, 99]);
  });

  it('lists the base form and the forms beside it', () => {
    expect(formsOf(root, 1)).toEqual([0]);
    expect(formsOf(root, 25)).toEqual([0, 6]);
  });

  it("does not take a coat's folder for a form", () => {
    expect(formsOf(root, 25)).not.toContain(1);
  });

  it('lists a form that is drawn as a shiny and nothing else', () => {
    expect(formsOf(root, 50)).toEqual([4]);
    expect(slotAt(root, 50, 4).present).toEqual(['shiny']);
    expect(slotsOf(root, 50).map((slot) => slot.form)).toEqual([4]);
  });

  it('lists nothing for a species nobody has drawn', () => {
    expect(formsOf(root, 99)).toEqual([]);
    expect(slotsOf(root, 99)).toEqual([]);
  });

  it('finds the coats a form actually has', () => {
    expect(slotAt(root, 1, 0).present).toEqual(['regular', 'shiny', 'female']);
    expect(slotAt(root, 25, 6).present).toEqual(['regular']);
  });

  it('takes the male drawing as the ordinary coat, and the base as the female', () => {
    // Xatu and Camerupt are the only two drawn separately for males,
    // and neither has a folder for females: the one under no gender is
    // the female, with the male filed beside it
    writeFixture(root, ANIMS, [
      { path: '0178', color: COLORS.green },
      { path: '0178/0000/0001', color: COLORS.white },
      { path: '0178/0000/0000/0001', color: COLORS.blue },
      { path: '0178/0000/0001/0001', color: COLORS.red },
    ]);
    const slot = slotAt(root, 178, 0);

    expect(slot.present).toEqual(['regular', 'shiny', 'female', 'shinyFemale']);
    expect(slot.coats).toEqual({
      regular: '0178/0000/0000/0001',
      shiny: '0178/0000/0001/0001',
      female: '0178',
      shinyFemale: '0178/0000/0001',
    });
  });

  it('reads a form with no male drawing the ordinary way round', () => {
    expect(slotAt(root, 1, 0).coats).toMatchObject({
      regular: '0001',
      shiny: '0001/0000/0001',
      female: '0001/0000/0000/0002',
    });
  });
});
