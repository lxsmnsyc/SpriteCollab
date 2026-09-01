import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SpriteAnim } from '../src/anims.ts';
import run from '../src/run.ts';
import { slotAt } from '../src/slots.ts';
import statuses, { completeness, statusOf } from '../src/status.ts';
import { coatLetters, extrasOf, hasGap, parseArguments } from '../src/status-cli.ts';
import readTracker from '../src/tracker.ts';
import { ANIMS, writeFixture } from './fixture.ts';
import { COLORS } from './helpers.ts';

/** A sprite root and somewhere for the compact tree to go. */
function fixture(): { root: string; output: string; held: string } {
  const held = mkdtempSync(join(tmpdir(), 'status-'));

  return { held, root: join(held, 'sprite'), output: join(held, 'compact') };
}

describe('statusOf', () => {
  let root: string;
  let output: string;

  beforeEach(() => {
    ({ root, output } = fixture());
    writeFixture(root, ANIMS, [
      { path: '0001', color: COLORS.green },
      { path: '0001/0000/0001', color: COLORS.blue },
    ]);
  });

  it('says which coats are there and which are not', () => {
    const status = statusOf(root, output, slotAt(root, 1, 0));

    expect(status.coats.map((coat) => coat.key)).toEqual(['regular', 'shiny']);
    expect(status.absent).toEqual(['female', 'shinyFemale']);
    expect(coatLetters(status)).toBe('RS..');
  });

  it('names the supported animations, and only those', () => {
    const status = statusOf(root, output, slotAt(root, 1, 0));

    // Strike copies Walk, so it is described but not drawn
    expect(status.anims).toEqual([SpriteAnim.Idle, SpriteAnim.Walk]);
    expect(status.missing).toContain(SpriteAnim.Attack);
    expect(status.missing).not.toContain(SpriteAnim.Walk);
  });

  it('counts an animation nothing downstream supports as an extra', () => {
    writeFixture(
      root,
      [
        ...ANIMS,
        { name: 'EventSleep', index: 9, frameWidth: 8, frameHeight: 8, columns: 1, rows: 8, durations: [8] },
      ],
      [{ path: '0002', color: COLORS.red }],
    );
    const status = statusOf(root, output, slotAt(root, 2, 0));

    expect(status.coats[0].unsupported).toEqual(['EventSleep']);
    expect(extrasOf(status)).toEqual(['EventSleep']);
    // Only the two it draws that anything supports
    expect(status.anims).toEqual([SpriteAnim.Idle, SpriteAnim.Walk]);
  });

  it('spots an animation one coat draws and another does not', () => {
    const held = fixture();

    writeFixture(held.root, ANIMS, [{ path: '0001', color: COLORS.green }]);
    writeFixture(held.root, ANIMS.slice(0, 1), [
      { path: '0001/0000/0001', color: COLORS.blue },
    ]);
    const status = statusOf(held.root, held.output, slotAt(held.root, 1, 0));

    expect(status.partial).toEqual([SpriteAnim.Idle]);
    expect(hasGap(status)).toBe(true);
  });

  it('spots a coat padded to a cell of another size', () => {
    const held = fixture();

    writeFixture(held.root, ANIMS, [
      { path: '0001', color: COLORS.green },
      { path: '0001/0000/0001', color: COLORS.green, cell: { width: 12, height: 12 } },
    ]);
    run({ root: held.root, output: held.output, species: [1] });
    const status = statusOf(held.root, held.output, slotAt(held.root, 1, 0));
    const shiny = status.coats.find((coat) => coat.key === 'shiny');

    expect(shiny?.repadded).toEqual([SpriteAnim.Idle, SpriteAnim.Walk]);
    expect(shiny?.misaligned).toEqual([]);
    expect(coatLetters(status)).toBe('R~..');
    // Repadding is handled, so a built form with it is not a gap
    expect(hasGap(status)).toBe(false);
  });

  it('spots a coat whose frame count cannot be lined up', () => {
    const held = fixture();

    writeFixture(held.root, ANIMS, [{ path: '0001', color: COLORS.green }]);
    writeFixture(
      held.root,
      ANIMS.map((anim) => ({ ...anim, columns: anim.columns + 1 })),
      [{ path: '0001/0000/0001', color: COLORS.blue }],
    );
    const status = statusOf(held.root, held.output, slotAt(held.root, 1, 0));

    expect(status.coats.find((coat) => coat.key === 'shiny')?.misaligned).toEqual([
      SpriteAnim.Idle,
      SpriteAnim.Walk,
    ]);
    expect(coatLetters(status)).toBe('R!..');
    expect(hasGap(status)).toBe(true);
  });

  it('says whether the compact tree holds it, and whether it is current', () => {
    expect(statusOf(root, output, slotAt(root, 1, 0))).toMatchObject({
      built: false,
      stale: null,
    });
    run({ root, output, species: [1] });
    expect(statusOf(root, output, slotAt(root, 1, 0))).toMatchObject({
      built: true,
      stale: false,
    });
    // Somebody has touched the source since
    const later = new Date(Date.now() + 60_000);

    utimesSync(join(root, '0001', 'AnimData.xml'), later, later);
    expect(statusOf(root, output, slotAt(root, 1, 0)).stale).toBe(true);
  });

  it('names the species and the form where the record says', () => {
    const tracker = join(root, '..', 'tracker.json');

    writeFileSync(
      tracker,
      JSON.stringify({
        '0001': {
          name: 'Bulbasaur',
          sprite_complete: 2,
          subgroups: { '0000': { sprite_complete: 1 } },
        },
      }),
    );
    const status = statusOf(
      root,
      output,
      slotAt(root, 1, 0),
      readTracker(tracker),
      completeness(tracker),
    );

    expect(status).toMatchObject({ name: 'Bulbasaur', formName: null, complete: 1 });
  });

  it('knows nothing about completeness with no record to read', () => {
    expect(completeness(join(tmpdir(), 'no-such-tracker.json'))(1, 0)).toBeNull();
  });
});

describe('statuses', () => {
  it('covers every form of every species asked for', () => {
    const { root, output } = fixture();

    writeFixture(root, ANIMS, [
      { path: '0001', color: COLORS.green },
      { path: '0001/0002', color: COLORS.red },
      { path: '0025', color: COLORS.blue },
    ]);
    expect(statuses(root, output, [1]).map((held) => `${held.dex}/${held.form}`)).toEqual([
      '1/0',
      '1/2',
    ]);
    expect(statuses(root, output, []).map((held) => held.dex)).toEqual([1, 1, 25]);
  });
});

describe('the status command line', () => {
  it('is the whole collection with its defaults where nothing is said', () => {
    expect(parseArguments([])).toMatchObject({
      species: [],
      root: 'sprite',
      tracker: 'tracker.json',
      output: 'compact',
      anims: false,
      coverage: false,
      gaps: false,
      json: false,
    });
  });

  it('takes each switch it knows', () => {
    expect(parseArguments(['--anims', '--coverage', '--gaps', '--json'])).toMatchObject({
      anims: true,
      coverage: true,
      gaps: true,
      json: true,
    });
  });

  it('gathers every index it was given', () => {
    expect(parseArguments(['1-3', '25']).species).toEqual([1, 2, 3, 25]);
  });

  it('refuses a switch it does not know', () => {
    expect(() => parseArguments(['--rebuild'])).toThrow(/no --rebuild option/);
  });
});
