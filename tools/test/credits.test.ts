import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import readCreditNames, { readCredits } from '../src/credits.ts';

/** The table, in the shape the collection keeps it. */
function names(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'credits-')), 'credit_names.txt');

  writeFileSync(
    path,
    [
      'Name\tDiscord\tContact',
      'CHUNSOFT\tCHUNSOFT\thttps://www.spike-chunsoft.com/',
      'Audino\t<@!117780585635643396>\thttps://github.com/audinowho',
      'Nameless\t<@!999999999999999999>\t',
    ].join('\n'),
  );
  return path;
}

const LINE = '2020-10-07 17:58:43.323442\t<@!117780585635643396>\tCUR\tCC_BY-NC_4\tWalk,Attack';

describe('readCredits', () => {
  it('reads a line into what it says', () => {
    expect(readCredits([LINE], readCreditNames(names()))[0]).toEqual({
      date: '2020-10-07 17:58:43.323442',
      name: 'Audino',
      discord: '117780585635643396',
      contact: 'https://github.com/audinowho',
      status: 'CUR',
      license: 'CC_BY-NC_4',
      anims: ['Walk', 'Attack'],
    });
  });

  it('keeps the account behind an author the table does not know', () => {
    const credit = readCredits(
      ['2021-01-01 00:00:00\t<@!123456789012345678>\tCUR\tPMDCollab_1\tIdle'],
      readCreditNames(names()),
    )[0];

    expect(credit).toMatchObject({ name: null, discord: '123456789012345678' });
  });

  it('takes an author credited by name as already legible', () => {
    const credit = readCredits(
      ['2020-10-07 17:58:43\tCHUNSOFT\tCUR\tUnspecified\tWalk'],
      readCreditNames(names()),
    )[0];

    expect(credit).toMatchObject({
      name: 'CHUNSOFT',
      discord: null,
      contact: 'https://www.spike-chunsoft.com/',
    });
  });

  it('resolves no contact where the table leaves one blank', () => {
    const credit = readCredits(
      ['2021-01-01 00:00:00\t<@!999999999999999999>\tCUR\tPMDCollab_1\tIdle'],
      readCreditNames(names()),
    )[0];

    expect(credit).toMatchObject({ name: 'Nameless', contact: null });
  });

  it('reads a line with no table to read it against', () => {
    expect(readCredits([LINE])[0]).toMatchObject({ name: null, discord: '117780585635643396' });
  });

  it('drops a line it cannot make sense of', () => {
    expect(readCredits(['', 'nonsense'])).toEqual([]);
  });

  it('knows nothing where there is no table to read', () => {
    expect(readCreditNames(join(tmpdir(), 'no-such-credit-names.txt'))('CHUNSOFT')).toBeNull();
  });
});
