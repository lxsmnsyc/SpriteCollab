import { describe, expect, it } from 'vitest';
import main, { bytes, parseArguments, parseIndex, saved } from '../src/cli.ts';

describe('parseIndex', () => {
  it('reads a species however it is written', () => {
    expect(parseIndex('0025')).toEqual([25]);
    expect(parseIndex('25')).toEqual([25]);
  });

  it('reads a range as every species in it', () => {
    expect(parseIndex('1-4')).toEqual([1, 2, 3, 4]);
    expect(parseIndex('4..1')).toEqual([1, 2, 3, 4]);
  });

  it('reads a list, ranges and all', () => {
    expect(parseIndex('1,4-6,9')).toEqual([1, 4, 5, 6, 9]);
  });

  it('refuses something that is not a species at all', () => {
    expect(() => parseIndex('pikachu')).toThrow(/not a species number/);
  });
});

describe('parseArguments', () => {
  it('is the whole collection with its defaults where nothing is said', () => {
    expect(parseArguments([])).toMatchObject({
      species: [],
      root: 'sprite',
      tracker: 'tracker.json',
      output: 'compact',
      compact: true,
      verify: true,
      check: false,
      prune: false,
      dryRun: false,
    });
  });

  it('takes --check', () => {
    expect(parseArguments(['1', '--check']).check).toBe(true);
  });

  it('gathers every index it was given', () => {
    expect(parseArguments(['1-3', '25']).species).toEqual([1, 2, 3, 25]);
  });

  it('takes the folders it is pointed at', () => {
    expect(parseArguments(['--root', 'a', '--out', 'b', '--tracker', 'c'])).toMatchObject({
      root: 'a',
      output: 'b',
      tracker: 'c',
    });
  });

  it('takes each switch it knows', () => {
    expect(parseArguments(['--no-compact', '--no-verify', '--prune', '--dry-run', '--quiet'])).toMatchObject(
      { compact: false, verify: false, prune: true, dryRun: true, quiet: true },
    );
  });

  it('refuses a switch it does not know', () => {
    expect(() => parseArguments(['--rebuild'])).toThrow(/no --rebuild option/);
  });
});

describe('reporting', () => {
  it('writes bytes as something a person reads', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(2048)).toBe('2.0 K');
    expect(bytes(3 * 1024 * 1024)).toBe('3.0 M');
  });

  it('writes how much smaller a thing got', () => {
    expect(saved(1000, 250)).toBe('75.0%');
    expect(saved(0, 0)).toBe('—');
  });
});

describe('the flags that must not go together', () => {
  it('refuses to prune without checking', () => {
    expect(main(['1', '--prune', '--no-verify'])).toBe(1);
  });

  it('refuses a check that checks nothing', () => {
    expect(main(['1', '--check', '--no-verify'])).toBe(1);
  });
});
