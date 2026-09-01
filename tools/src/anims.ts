/**
 * The animations a sheet carries, as numbers.
 *
 * A PMD folder names its animations, and the collection draws those
 * names from a closed vocabulary — but it is a much larger vocabulary
 * than anything downstream draws. `EventSleep`, `Laying`, `LostBalance`
 * and twenty more are cutscene poses: real art, submitted by real
 * people, and pixels no game here ever asks for. Packing them costs
 * sheet space and description for nothing.
 *
 * So this is the list the engines that read these sheets actually
 * support, and it is the filter the optimizer packs against. Numbers 0
 * to 39 are `src/data/ids/sprite-anims.ts` in both Overwander and
 * Poketerra, where the two files are identical.
 *
 * Numbers 40 and up are ours, and those two files do not have them yet.
 * They are the rest of the collection's ordinary animations — drawn in
 * all eight facings by every coat that has them, and drawn more than
 * once — as against the cutscene poses, which are a single facing or
 * inconsistent between coats. An engine that does not know a number
 * ignores it, so packing them costs the engines nothing and saves
 * rebuilding the tree when they do learn them.
 *
 * **The numbers are written into every sheet's description, so they are
 * append-only.** A new animation takes the next free number; an
 * existing one never moves, and nothing is ever removed. The folder's
 * own `Index` is no use for this — it numbers within one folder, so
 * half a dozen different animations are all `2`.
 */
export const SpriteAnim = {
  // The eleven every sheet carries
  Idle: 0,
  Sleep: 1,
  Hurt: 2,
  Attack: 3,
  Charge: 4,
  Shoot: 5,
  Double: 6,
  Hop: 7,
  Rotate: 8,
  Walk: 9,
  Swing: 10,
  // Drawn for some pokemon and not others
  Slice: 11,
  SpAttack: 12,
  Shock: 13,
  QuickStrike: 14,
  Strike: 15,
  Jab: 16,
  Punch: 17,
  Kick: 18,
  MultiStrike: 19,
  Slam: 20,
  Withdraw: 21,
  Twirl: 22,
  RearUp: 23,
  Shake: 24,
  Lick: 25,
  Dance: 26,
  Uppercut: 27,
  Gas: 28,
  Stomp: 29,
  Emit: 30,
  Swell: 31,
  Ricochet: 32,
  MultiScratch: 33,
  Bite: 34,
  Appeal: 35,
  Chop: 36,
  Hover: 37,
  Rumble: 38,
  Sound: 39,
  // Ours: eight facings everywhere they are drawn, and drawn more than once
  FlapAround: 40,
  TailWhip: 41,
  Scratch: 42,
  CarefulWalk: 43,
  RaiseArms: 44,
  Sing: 45,
  Yawn: 46,
  Slap: 47,
} as const;

export type SpriteAnim = (typeof SpriteAnim)[keyof typeof SpriteAnim];

/** Every animation there is, in the order they are numbered. */
export const SPRITE_ANIMS: SpriteAnim[] = Object.values(SpriteAnim);

/**
 * The animations a sheet is expected to have.
 *
 * These ten are what a pokemon needs to stand, move, act and be hit —
 * anything downstream can assume them and has nowhere to fall back to
 * when one is absent. The rest are particular to a move or a species
 * and a renderer is expected to cope without them.
 *
 * Nearly every coat in the collection draws all ten. A sheet short of
 * one is a gap in the art rather than a fault in the build, so the
 * index says which are missing instead of the build refusing them.
 */
export const COMMON_ANIMS: SpriteAnim[] = [
  SpriteAnim.Idle,
  SpriteAnim.Sleep,
  SpriteAnim.Hurt,
  SpriteAnim.Attack,
  SpriteAnim.Double,
  SpriteAnim.Swing,
  SpriteAnim.Charge,
  SpriteAnim.Rotate,
  SpriteAnim.Walk,
  SpriteAnim.Hop,
];

/**
 * The six a sheet is no use at all without.
 *
 * A subset of the common ten, and the harder line: standing, moving,
 * attacking, being hit, resting and the hop that stands in for
 * everything else. A sheet short of one of these cannot be put on
 * screen in a normal turn of play, where a sheet missing `Rotate` or
 * `Charge` is merely incomplete.
 */
export const MINIMUM_ANIMS: SpriteAnim[] = [
  SpriteAnim.Idle,
  SpriteAnim.Attack,
  SpriteAnim.Walk,
  SpriteAnim.Sleep,
  SpriteAnim.Hurt,
  SpriteAnim.Hop,
];

/** Which of the common animations a sheet's animations do not cover. */
export function missingCommon(held: Iterable<SpriteAnim>): SpriteAnim[] {
  const have = new Set(held);

  return COMMON_ANIMS.filter((anim) => !have.has(anim));
}

/** Which of the six it does not have, which is the serious list. */
export function missingMinimum(held: Iterable<SpriteAnim>): SpriteAnim[] {
  const have = new Set(held);

  return MINIMUM_ANIMS.filter((anim) => !have.has(anim));
}

const NAMED = new Map<number, string>(
  Object.entries(SpriteAnim).map(([name, anim]) => [anim, name]),
);

const NUMBERED = new Map<string, SpriteAnim>(
  Object.entries(SpriteAnim).map(([name, anim]) => [name.toLowerCase(), anim]),
);

/**
 * Which animation a folder means by a name, matched without regard to
 * case. Nothing for a name nothing downstream supports, which is an
 * animation to leave in the collection rather than one to pack
 */
export function spriteAnimOf(name: string): SpriteAnim | null {
  return NUMBERED.get(name.trim().toLowerCase()) ?? null;
}

/** What an animation is called, for a message or a document. */
export function spriteAnimName(anim: number): string {
  return NAMED.get(anim) ?? String(anim);
}
