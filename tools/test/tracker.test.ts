import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import readTracker from '../src/tracker.ts';

/** A record in the shape the collection keeps it. */
function record(): string {
  return JSON.stringify({
    '0025': {
      name: 'Pikachu',
      subgroups: {
        '0000': { name: '', subgroups: { '0001': { name: 'Shiny' } } },
        '0006': { name: 'Libre' },
      },
    },
    '0099': { name: '' },
  });
}

function written(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'tracker-')), 'tracker.json');

  writeFileSync(path, record());
  return path;
}

describe('readTracker', () => {
  it('names a species and its forms', () => {
    const tracker = readTracker(written());

    expect(tracker(25, 0)).toEqual({ name: 'Pikachu', formName: null });
    expect(tracker(25, 6)).toEqual({ name: 'Pikachu', formName: 'Libre' });
  });

  it('resolves nothing for a species the record does not hold', () => {
    expect(readTracker(written())(1, 0)).toEqual({ name: null, formName: null });
  });

  it('takes a blank name for no name', () => {
    expect(readTracker(written())(99, 0).name).toBeNull();
  });

  it('knows nothing where there is no record to read', () => {
    expect(readTracker(join(tmpdir(), 'no-such-tracker.json'))(25, 0)).toEqual({
      name: null,
      formName: null,
    });
  });
});
