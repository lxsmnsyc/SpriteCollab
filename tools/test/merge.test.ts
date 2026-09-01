import { describe, expect, it } from 'vitest';
import type { AnimData } from '../src/anim-data.ts';
import type { Archive, SpriteImages } from '../src/archive.ts';
import { SpriteAnim } from '../src/anims.ts';
import mergeCoats from '../src/merge.ts';
import type { Raster } from '../src/raster.ts';
import type { CoatKey } from '../src/slots.ts';
import { COLORS, fill, raster } from './helpers.ts';

type Color = [number, number, number, number];

/** One clip, drawn in two flat colours so a mapping is learnable. */
function clip(body: Color, mark: Color = COLORS.white): Raster {
  const image = raster(8, 8);

  fill(image, { x: 1, y: 1, width: 5, height: 5 }, body);
  fill(image, { x: 2, y: 2, width: 2, height: 2 }, mark);
  return image;
}

/** An archive holding the given clips and nothing else. */
function archive(clips: [SpriteAnim, Raster][]): Archive {
  const images = new Map<SpriteAnim, SpriteImages>();

  for (const [anim, animation] of clips) {
    images.set(anim, { animation });
  }
  return { animData: '', images, credits: [] };
}

/** The description that goes with those clips. */
function grid(anims: SpriteAnim[]): AnimData {
  return {
    shadowSize: 1,
    anims: anims.map((anim) => ({
      anim,
      index: anim,
      frameWidth: 8,
      frameHeight: 8,
      durations: [1],
      rushFrame: null,
      hitFrame: null,
      returnFrame: null,
      copyOf: null,
      target: anim,
    })),
  };
}

/** What a coat draws, by animation. */
function drawn(held: { archive: Archive }): SpriteAnim[] {
  return [...held.archive.images.keys()].sort((one, two) => one - two);
}

describe('mergeCoats', () => {
  it('carries a clip the shiny is missing over from the ordinary coat', () => {
    const coats: { key: CoatKey; archive: Archive }[] = [
      {
        key: 'regular',
        archive: archive([
          [SpriteAnim.Idle, clip(COLORS.green)],
          [SpriteAnim.Chop, clip(COLORS.green)],
        ]),
      },
      { key: 'shiny', archive: archive([[SpriteAnim.Idle, clip(COLORS.blue)]]) },
    ];
    const grids = [grid([SpriteAnim.Idle, SpriteAnim.Chop]), grid([SpriteAnim.Idle])];
    const held = mergeCoats(coats, grids);

    expect(held.refused).toEqual([]);
    expect(held.derived).toEqual([
      { coat: 'shiny', anim: SpriteAnim.Chop, from: 'regular' },
    ]);
    expect(drawn(coats[1])).toEqual([SpriteAnim.Idle, SpriteAnim.Chop]);
    // And it is the shiny's colours, not the ordinary coat's
    expect(coats[1].archive.images.get(SpriteAnim.Chop)?.animation?.data).toEqual(
      clip(COLORS.blue).data,
    );
    // The coat that gained it can now be read on a grid that describes it
    expect(grids[1].anims.map((one) => one.target)).toContain(SpriteAnim.Chop);
  });

  it('carries one the other way just as readily', () => {
    const coats: { key: CoatKey; archive: Archive }[] = [
      { key: 'regular', archive: archive([[SpriteAnim.Idle, clip(COLORS.green)]]) },
      {
        key: 'shiny',
        archive: archive([
          [SpriteAnim.Idle, clip(COLORS.blue)],
          [SpriteAnim.Attack, clip(COLORS.blue)],
        ]),
      },
    ];
    const held = mergeCoats(coats, [grid([SpriteAnim.Idle]), grid([SpriteAnim.Idle, SpriteAnim.Attack])]);

    expect(held.derived).toEqual([
      { coat: 'regular', anim: SpriteAnim.Attack, from: 'shiny' },
    ]);
    expect(drawn(coats[0])).toEqual([SpriteAnim.Idle, SpriteAnim.Attack]);
  });

  it('gives both coats the union where each has one the other lacks', () => {
    const coats: { key: CoatKey; archive: Archive }[] = [
      {
        key: 'regular',
        archive: archive([
          [SpriteAnim.Idle, clip(COLORS.green)],
          [SpriteAnim.Attack, clip(COLORS.green)],
        ]),
      },
      {
        key: 'shiny',
        archive: archive([
          [SpriteAnim.Idle, clip(COLORS.blue)],
          [SpriteAnim.Charge, clip(COLORS.blue)],
        ]),
      },
    ];
    const held = mergeCoats(coats, [
      grid([SpriteAnim.Idle, SpriteAnim.Attack]),
      grid([SpriteAnim.Idle, SpriteAnim.Charge]),
    ]);

    expect(held.refused).toEqual([]);
    expect(held.derived).toHaveLength(2);
    const union = [SpriteAnim.Idle, SpriteAnim.Attack, SpriteAnim.Charge].sort(
      (one, two) => one - two,
    );

    expect(drawn(coats[0])).toEqual(union);
    expect(drawn(coats[1])).toEqual(union);
  });

  it('refuses a clip using a colour the shared clips never showed', () => {
    const coats: { key: CoatKey; archive: Archive }[] = [
      {
        key: 'regular',
        archive: archive([
          [SpriteAnim.Idle, clip(COLORS.green)],
          // A colour the shiny was never seen alongside
          [SpriteAnim.Chop, clip(COLORS.red)],
        ]),
      },
      { key: 'shiny', archive: archive([[SpriteAnim.Idle, clip(COLORS.blue)]]) },
    ];
    const held = mergeCoats(coats, [grid([SpriteAnim.Idle, SpriteAnim.Chop]), grid([SpriteAnim.Idle])]);

    expect(held.derived).toEqual([]);
    expect(held.refused).toEqual([
      { coat: 'shiny', anim: SpriteAnim.Chop, from: 'regular', reason: 'unknown colours' },
    ]);
    expect(drawn(coats[1])).toEqual([SpriteAnim.Idle]);
  });

  it('refuses where the two coats are not one palette swapped for another', () => {
    const one = clip(COLORS.green, COLORS.green);
    const two = clip(COLORS.blue, COLORS.white);
    const coats: { key: CoatKey; archive: Archive }[] = [
      {
        key: 'regular',
        archive: archive([
          [SpriteAnim.Idle, one],
          [SpriteAnim.Chop, clip(COLORS.green, COLORS.green)],
        ]),
      },
      { key: 'shiny', archive: archive([[SpriteAnim.Idle, two]]) },
    ];
    const held = mergeCoats(coats, [grid([SpriteAnim.Idle, SpriteAnim.Chop]), grid([SpriteAnim.Idle])]);

    expect(held.derived).toEqual([]);
    expect(held.refused[0]).toMatchObject({ reason: 'ambiguous' });
  });

  it('leaves a coat alone where its pair is not there', () => {
    const coats: { key: CoatKey; archive: Archive }[] = [
      { key: 'regular', archive: archive([[SpriteAnim.Idle, clip(COLORS.green)]]) },
      { key: 'female', archive: archive([[SpriteAnim.Attack, clip(COLORS.red)]]) },
    ];
    const held = mergeCoats(coats, [grid([SpriteAnim.Idle]), grid([SpriteAnim.Attack])]);

    // An ordinary coat and a female coat are different drawings, and no
    // palette turns one into the other
    expect(held).toEqual({ derived: [], refused: [] });
    expect(drawn(coats[0])).toEqual([SpriteAnim.Idle]);
    expect(drawn(coats[1])).toEqual([SpriteAnim.Attack]);
  });

  it('has nothing to learn from where the pair shares no clip', () => {
    const coats: { key: CoatKey; archive: Archive }[] = [
      { key: 'regular', archive: archive([[SpriteAnim.Idle, clip(COLORS.green)]]) },
      { key: 'shiny', archive: archive([[SpriteAnim.Attack, clip(COLORS.blue)]]) },
    ];
    const held = mergeCoats(coats, [grid([SpriteAnim.Idle]), grid([SpriteAnim.Attack])]);

    expect(held).toEqual({ derived: [], refused: [] });
  });
});
