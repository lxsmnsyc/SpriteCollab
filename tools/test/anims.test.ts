import { describe, expect, it } from 'vitest';
import {
  COMMON_ANIMS,
  MINIMUM_ANIMS,
  SPRITE_ANIMS,
  SpriteAnim,
  missingCommon,
  missingMinimum,
  spriteAnimName,
  spriteAnimOf,
} from '../src/anims.ts';

describe('the supported animations', () => {
  it('numbers each one once, from zero and without a gap', () => {
    expect(SPRITE_ANIMS).toEqual([...SPRITE_ANIMS].sort((one, two) => one - two));
    expect(new Set(SPRITE_ANIMS).size).toBe(SPRITE_ANIMS.length);
    expect(SPRITE_ANIMS[0]).toBe(0);
    expect(SPRITE_ANIMS[SPRITE_ANIMS.length - 1]).toBe(SPRITE_ANIMS.length - 1);
  });

  it('reads a name however it was written', () => {
    expect(spriteAnimOf('Walk')).toBe(SpriteAnim.Walk);
    expect(spriteAnimOf('walk')).toBe(SpriteAnim.Walk);
    expect(spriteAnimOf(' QuickStrike ')).toBe(SpriteAnim.QuickStrike);
  });

  it('resolves nothing for an animation nothing downstream draws', () => {
    for (const name of ['EventSleep', 'Laying', 'LostBalance', 'TumbleBack', 'HitGround']) {
      expect(spriteAnimOf(name)).toBeNull();
    }
  });

  it('names every number it has', () => {
    for (const anim of SPRITE_ANIMS) {
      expect(spriteAnimOf(spriteAnimName(anim))).toBe(anim);
    }
  });
});

describe('the common animations', () => {
  it('is the ten a sheet is expected to have', () => {
    expect(COMMON_ANIMS.map(spriteAnimName)).toEqual([
      'Idle', 'Sleep', 'Hurt', 'Attack', 'Double',
      'Swing', 'Charge', 'Rotate', 'Walk', 'Hop',
    ]);
  });

  it('is every one of them a real animation', () => {
    for (const anim of COMMON_ANIMS) {
      expect(SPRITE_ANIMS).toContain(anim);
    }
  });

  it('says which of them a sheet has not got', () => {
    expect(missingCommon(COMMON_ANIMS)).toEqual([]);
    expect(missingCommon([SpriteAnim.Idle, SpriteAnim.Sleep])).toEqual(
      COMMON_ANIMS.filter((anim) => anim !== SpriteAnim.Idle && anim !== SpriteAnim.Sleep),
    );
  });

  it('does not count an animation that is not common', () => {
    expect(missingCommon([...COMMON_ANIMS, SpriteAnim.Bite])).toEqual([]);
  });
});

describe('the bare minimum', () => {
  it('is the six a sheet is no use without', () => {
    expect(MINIMUM_ANIMS.map(spriteAnimName)).toEqual([
      'Idle', 'Attack', 'Walk', 'Sleep', 'Hurt', 'Hop',
    ]);
  });

  it('is inside the common ten', () => {
    for (const anim of MINIMUM_ANIMS) {
      expect(COMMON_ANIMS).toContain(anim);
    }
  });

  it('says which of the six a sheet has not got', () => {
    expect(missingMinimum(COMMON_ANIMS)).toEqual([]);
    expect(missingMinimum([SpriteAnim.Idle])).toEqual(
      MINIMUM_ANIMS.filter((anim) => anim !== SpriteAnim.Idle),
    );
  });

  it('is never longer than what the common ten is missing', () => {
    const held = [SpriteAnim.Idle, SpriteAnim.Rotate];

    expect(missingMinimum(held).length).toBeLessThanOrEqual(missingCommon(held).length);
  });
});
