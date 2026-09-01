import { describe, expect, it } from 'vitest';
import { SPRITE_ANIMS, SpriteAnim, spriteAnimName, spriteAnimOf } from '../src/anims.ts';

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
