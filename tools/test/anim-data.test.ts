import { describe, expect, it } from 'vitest';
import readAnimData from '../src/anim-data.ts';
import { SpriteAnim } from '../src/anims.ts';

/** An archive's description, written the way SpriteBot writes it. */
function animData(body: string): string {
  return `<?xml version="1.0" ?>\n<AnimData>\n<ShadowSize>1</ShadowSize>\n<Anims>${body}</Anims>\n</AnimData>`;
}

const WALK = `<Anim>
  <Name>Walk</Name><Index>0</Index>
  <FrameWidth>40</FrameWidth><FrameHeight>40</FrameHeight>
  <Durations><Duration>4</Duration><Duration>6</Duration></Durations>
</Anim>`;

describe('readAnimData', () => {
  it('reads a grid, its timings and its shadow', () => {
    const data = readAnimData(animData(WALK));

    expect(data.shadowSize).toBe(1);
    expect(data.anims).toHaveLength(1);
    expect(data.anims[0]).toMatchObject({
      anim: SpriteAnim.Walk,
      index: 0,
      frameWidth: 40,
      frameHeight: 40,
      durations: [4, 6],
      copyOf: null,
      target: SpriteAnim.Walk,
    });
  });

  it('keeps the frames a lunge acts on', () => {
    const data = readAnimData(
      animData(`<Anim><Name>Attack</Name><Index>1</Index><FrameWidth>64</FrameWidth>
        <FrameHeight>72</FrameHeight><RushFrame>2</RushFrame><HitFrame>5</HitFrame>
        <ReturnFrame>7</ReturnFrame></Anim>`),
    );

    expect(data.anims[0]).toMatchObject({ rushFrame: 2, hitFrame: 5, returnFrame: 7 });
  });

  it('resolves a copy onto the grid it copies', () => {
    const data = readAnimData(
      animData(`${WALK}<Anim><Name>Strike</Name><Index>2</Index><CopyOf>Walk</CopyOf></Anim>`),
    );
    const strike = data.anims.find((anim) => anim.anim === SpriteAnim.Strike);

    expect(strike).toMatchObject({
      index: 2,
      frameWidth: 40,
      frameHeight: 40,
      durations: [4, 6],
      copyOf: SpriteAnim.Walk,
      target: SpriteAnim.Walk,
    });
  });

  it('resolves a copy written before what it copies', () => {
    const data = readAnimData(
      animData(`<Anim><Name>Strike</Name><CopyOf>Walk</CopyOf></Anim>${WALK}`),
    );

    expect(data.anims.map((anim) => anim.anim)).toEqual([SpriteAnim.Strike, SpriteAnim.Walk]);
    expect(data.anims[0].target).toBe(SpriteAnim.Walk);
  });

  it('leaves out an animation nothing downstream supports', () => {
    const data = readAnimData(
      animData(`${WALK}<Anim><Name>EventSleep</Name><Index>9</Index>
        <FrameWidth>8</FrameWidth><FrameHeight>8</FrameHeight></Anim>`),
    );

    expect(data.anims.map((anim) => anim.anim)).toEqual([SpriteAnim.Walk]);
  });

  it('leaves out a copy of an animation nothing supports', () => {
    const data = readAnimData(
      animData(`${WALK}<Anim><Name>Laying</Name><FrameWidth>8</FrameWidth>
        <FrameHeight>8</FrameHeight></Anim><Anim><Name>Sleep</Name><CopyOf>Laying</CopyOf></Anim>`),
    );

    expect(data.anims.map((anim) => anim.anim)).toEqual([SpriteAnim.Walk]);
  });

  it('refuses a copy of something the archive does not have', () => {
    expect(() =>
      readAnimData(animData('<Anim><Name>Strike</Name><CopyOf>Walk</CopyOf></Anim>')),
    ).toThrow(/does not have/);
  });

  it('refuses a document that is not a description at all', () => {
    expect(() => readAnimData('<Sheet></Sheet>')).toThrow(/Expected an AnimData/);
  });
});
