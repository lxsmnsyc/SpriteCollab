import { describe, expect, it } from 'vitest';
import regionOf, { REGIONS, spanOf } from '../src/regions.ts';

describe('regionOf', () => {
  it('reads a region off the dex number', () => {
    expect(regionOf(1)).toBe('kanto');
    expect(regionOf(151)).toBe('kanto');
    expect(regionOf(152)).toBe('johto');
    expect(regionOf(493)).toBe('sinnoh');
    expect(regionOf(722)).toBe('alola');
    expect(regionOf(1025)).toBe('paldea');
  });

  it('files a regional form with the region it is named for', () => {
    // Alolan Raichu is dex 26, which is Kanto's stretch
    expect(regionOf(26, 'Alola')).toBe('alola');
    expect(regionOf(58, 'Hisui')).toBe('hisui');
    expect(regionOf(52, 'Galar')).toBe('galar');
    expect(regionOf(194, 'Paldea')).toBe('paldea');
  });

  it('reads the region off the first word of a longer form name', () => {
    expect(regionOf(83, 'Galar_Alternate')).toBe('galar');
  });

  it('leaves a form that is not regional where its dex puts it', () => {
    expect(regionOf(6, 'Mega_X')).toBe('kanto');
    expect(regionOf(6, 'Gigantamax')).toBe('kanto');
    expect(regionOf(1, 'Altcolor')).toBe('kanto');
    expect(regionOf(1, null)).toBe('kanto');
  });

  it('has nowhere to put something that is not a pokemon', () => {
    expect(regionOf(0)).toBe('unknown');
    expect(regionOf(9999)).toBe('unknown');
  });

  it('names every region once, in the order the games came', () => {
    expect(new Set(REGIONS).size).toBe(REGIONS.length);
    expect(REGIONS[0]).toBe('kanto');
    expect(REGIONS[REGIONS.length - 1]).toBe('unknown');
  });

  it('gives the stretch a region covers, where it has one', () => {
    expect(spanOf('kanto')).toEqual([1, 151]);
    // Hisui is Sinnoh some centuries earlier, and has no dex of its own
    expect(spanOf('hisui')).toBeNull();
    expect(spanOf('unknown')).toBeNull();
  });

  it('leaves no gap between one region and the next', () => {
    for (let at = 1; at < REGIONS.length; at += 1) {
      const before = spanOf(REGIONS[at - 1]);
      const after = spanOf(REGIONS[at]);

      if (before != null && after != null) {
        expect(after[0]).toBe(before[1] + 1);
      }
    }
  });
});
