import type { Archive, SpriteImages } from './archive.ts';
import { SpriteAnim, spriteAnimName } from './anims.ts';
import readAnimData from './anim-data.ts';
import { PAIRS } from './merge.ts';
import type { Raster } from './raster.ts';
import { blank } from './raster.ts';
import type { CoatKey } from './slots.ts';

/**
 * Animations made from a form's standing pose, for a form whose
 * artist has not drawn them yet.
 *
 * A form whose regular coat has `Idle` or `Rotate` is showable: it has
 * a picture of the pokemon standing in every facing. Every other
 * animation a renderer expects can be stood in for by sliding that
 * picture about — a hop is the standing pose lifted, an attack is it
 * lunging forward, a hurt is it knocked back — which reads as movement
 * on screen and is plainly a placeholder up close. The sheet records
 * which animations are made this way, so they can be told from drawn
 * ones and replaced once someone draws them.
 *
 * Every motion is in whole pixels and measured from the hand-drawn
 * sheets where they share one: `Double` and `Hop` use the offsets and
 * timings every drawn `Double` and `Hop` in the collection uses.
 */

/** One generated animation, and what it was made from. */
export interface Polyfilled {
  coat: CoatKey;
  anim: SpriteAnim;
  /** The drawn animation its frames were taken from. */
  from: SpriteAnim;
}

/** The animations made this way, in the order they are added. */
export const POLYFILLS: SpriteAnim[] = [
  SpriteAnim.Idle,
  SpriteAnim.Rotate,
  SpriteAnim.Walk,
  SpriteAnim.Attack,
  SpriteAnim.Hurt,
  SpriteAnim.Sleep,
  SpriteAnim.Hop,
  SpriteAnim.Double,
  SpriteAnim.Charge,
  SpriteAnim.Swing,
];

/** One frame of a motion: where the pokemon is, and where its shadow is. */
interface Step {
  dx: number;
  dy: number;
  /** Whether the shadow stays on the ground while the body moves. */
  grounded?: boolean;
  duration: number;
}

/** Facings, in the order a folder's rows are drawn. */
const FORWARD: [number, number][] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];

/**
 * Sideways to each facing, as every drawn `Double` steps: across for
 * Down and Up, along for Left and Right, the other diagonal for the
 * diagonals.
 */
const SIDEWAYS: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
];

/** The lift of every drawn `Hop`, in pixels, frame by frame. */
const HOP_LIFT = [0, 10, 16, 20, 21, 22, 21, 17, 11, 0];
const HOP_DURATIONS = [2, 1, 2, 3, 4, 4, 3, 2, 1, 2];
/**
 * Where every drawn `Swing` carries the pokemon and its shadow while it
 * spins, frame by frame, for each facing: a loop out about 22 px ahead
 * and back. Right mirrors Left and the diagonals mirror each other.
 */
const SWING_PATH: [number, number][][] = [
  [[0, 0], [6, 3], [8, 9], [7, 18], [0, 22], [-7, 18], [-8, 9], [-6, 3], [0, 0]],
  [[0, 0], [11, 0], [21, 3], [26, 10], [20, 18], [11, 19], [3, 15], [0, 7], [0, 0]],
  [[0, 0], [5, -5], [13, -6], [20, -5], [23, 0], [20, 4], [14, 7], [6, 5], [0, 0]],
  [[0, 0], [-1, -6], [4, -17], [15, -22], [21, -21], [24, -13], [19, -4], [9, 0], [0, 0]],
  [[0, 0], [-8, -4], [-9, -12], [-7, -20], [0, -22], [7, -20], [9, -10], [8, -4], [0, 0]],
  [[0, 0], [1, -6], [-4, -17], [-15, -22], [-21, -21], [-24, -13], [-19, -4], [-9, 0], [0, 0]],
  [[0, 0], [-5, -5], [-13, -6], [-20, -5], [-23, 0], [-20, 4], [-14, 7], [-6, 5], [0, 0]],
  [[0, 0], [-11, 0], [-21, 3], [-26, 10], [-20, 18], [-11, 19], [-3, 15], [0, 7], [0, 0]],
];
const SWING_DURATIONS = [2, 1, 2, 2, 3, 2, 2, 1, 1];
/** The sideways steps of every drawn `Double`. */
const DOUBLE_STEPS = [0, 6, -6, 10, -10, 12, -12, 13, -13, 12, -12, 10, -10, 6, -6, 0];
const DOUBLE_DURATIONS = [2, 2, 2, 2, 2, 2, 3, 3, 3, 2, 3, 2, 2, 2, 2, 2];

const along = (vector: [number, number], by: number): [number, number] => [
  vector[0] * by,
  vector[1] * by,
];

/** Each animation's motion, for the row facing `row`. */
function motion(anim: SpriteAnim, row: number): Step[] {
  const forward = FORWARD[row % 8];
  const side = SIDEWAYS[row % 8];

  switch (anim) {
    // A small bob, the shadow left on the ground
    case SpriteAnim.Walk:
      return [0, 1, 0, 1].map((lift) => ({ dx: 0, dy: -lift, grounded: true, duration: 10 }));
    // A step back, a lunge forward, held at the hit, and back
    case SpriteAnim.Attack:
      return [-1, 2, 4, 4, 2, 0].map((by, at) => {
        const [dx, dy] = along(forward, by);

        return { dx, dy, duration: [3, 2, 2, 4, 3, 3][at] };
      });
    // Knocked back, and further
    case SpriteAnim.Hurt:
      return [2, 4].map((by, at) => {
        const [dx, dy] = along(forward, -by);

        return { dx, dy, duration: [2, 8][at] };
      });
    // Breathing: settles a pixel and back, on the ground
    case SpriteAnim.Sleep:
      return [0, 1].map((sink, at) => ({ dx: 0, dy: sink, grounded: true, duration: [30, 35][at] }));
    case SpriteAnim.Hop:
      return HOP_LIFT.map((lift, at) => ({
        dx: 0,
        dy: -lift,
        grounded: true,
        duration: HOP_DURATIONS[at],
      }));
    case SpriteAnim.Double:
      return DOUBLE_STEPS.map((by, at) => {
        const [dx, dy] = along(side, by);

        return { dx, dy, duration: DOUBLE_DURATIONS[at] };
      });
    // A shiver from side to side
    case SpriteAnim.Charge:
      return [-1, 1, -1, 1].map((by) => {
        const [dx, dy] = along(side, by);

        return { dx, dy, duration: 4 };
      });
    default:
      return [{ dx: 0, dy: 0, duration: 40 }];
  }
}

/** One facing's standing picture: drawing, anchors and shadow. */
interface Pose {
  animation: Raster;
  offsets: Raster;
  shadow: Raster;
}

function crop(raster: Raster | undefined, x: number, y: number, width: number, height: number): Raster {
  const out = blank(width, height);

  if (raster == null) {
    return out;
  }
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * raster.width + x) * 4;

    raster.data.copy(out.data, row * width * 4, from, from + width * 4);
  }
  return out;
}

function paste(into: Raster, picture: Raster, x: number, y: number): void {
  for (let row = 0; row < picture.height; row += 1) {
    const from = row * picture.width * 4;

    picture.data.copy(into.data, ((y + row) * into.width + x) * 4, from, from + picture.width * 4);
  }
}

/** A generated animation, ready to sit in an archive beside drawn ones. */
interface Made {
  images: Required<SpriteImages>;
  frameWidth: number;
  frameHeight: number;
  durations: number[];
  extra: string;
}

/**
 * Lays a motion out as a folder would: one row per facing, one column
 * per frame. The frame grows by the farthest step on each side, evenly,
 * so the pokemon's centre stays where the standing pose had it.
 */
function lay(poses: Pose[], steps: (row: number) => Step[], rows: number): Made {
  const width = poses[0].animation.width;
  const height = poses[0].animation.height;
  const all = Array.from({ length: rows }, (_, row) => steps(row)).flat();
  const padX = Math.max(0, ...all.map((step) => Math.abs(step.dx)));
  const padY = Math.max(0, ...all.map((step) => Math.abs(step.dy)));
  const frameWidth = width + 2 * padX;
  const frameHeight = height + 2 * padY;
  const columns = steps(0).length;
  const images = {
    animation: blank(frameWidth * columns, frameHeight * rows),
    offsets: blank(frameWidth * columns, frameHeight * rows),
    shadow: blank(frameWidth * columns, frameHeight * rows),
  };

  for (let row = 0; row < rows; row += 1) {
    const pose = poses[row];

    steps(row).forEach((step, column) => {
      const x = column * frameWidth + padX;
      const y = row * frameHeight + padY;

      paste(images.animation, pose.animation, x + step.dx, y + step.dy);
      paste(images.offsets, pose.offsets, x + step.dx, y + step.dy);
      paste(images.shadow, pose.shadow, step.grounded === true ? x : x + step.dx, step.grounded === true ? y : y + step.dy);
    });
  }
  return { images, frameWidth, frameHeight, durations: steps(0).map((step) => step.duration), extra: '' };
}

/** The `<Anim>` entry a generated animation is described by. */
function entry(anim: SpriteAnim, index: number, made: Made): string {
  return [
    '    <Anim>',
    `      <Name>${spriteAnimName(anim)}</Name>`,
    `      <Index>${index}</Index>`,
    `      <FrameWidth>${made.frameWidth}</FrameWidth>`,
    `      <FrameHeight>${made.frameHeight}</FrameHeight>`,
    made.extra,
    '      <Durations>',
    ...made.durations.map((duration) => `        <Duration>${duration}</Duration>`),
    '      </Durations>',
    '    </Anim>',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Adds the animations asked for to one coat's folder, made from its
 * standing pose, and says which it added.
 *
 * The standing pose is the first frame of `Idle` in each facing, or of
 * `Rotate` where there is no `Idle`. A coat with neither is returned as
 * it was: there is nothing to make anything from.
 */
export function polyfill(
  archive: Archive,
  wanted: SpriteAnim[],
): { archive: Archive; added: { anim: SpriteAnim; from: SpriteAnim }[] } {
  const data = readAnimData(archive.animData);
  const has = new Set(data.anims.map((one) => one.anim));
  const source = [SpriteAnim.Idle, SpriteAnim.Rotate].find(
    (anim) => has.has(anim) && archive.images.get(data.anims.find((one) => one.anim === anim)!.target)?.animation != null,
  );
  const asked = wanted.filter((anim) => !has.has(anim));

  if (source == null || asked.length === 0) {
    return { archive, added: [] };
  }
  const described = data.anims.find((one) => one.anim === source)!;
  const drawn = archive.images.get(described.target)!;
  const rows = Math.max(1, Math.floor(drawn.animation!.height / described.frameHeight));
  const { frameWidth: width, frameHeight: height } = described;
  // Idle's first frame stands for each facing; Rotate turns through the
  // facings along its rows, so its first column is the facing of the row
  const poses: Pose[] = Array.from({ length: rows }, (_, row) => ({
    animation: crop(drawn.animation, 0, row * height, width, height),
    offsets: crop(drawn.offsets, 0, row * height, width, height),
    shadow: crop(drawn.shadow, 0, row * height, width, height),
  }));
  const images = new Map(archive.images);
  const entries: string[] = [];
  const added: { anim: SpriteAnim; from: SpriteAnim }[] = [];
  let index = Math.max(-1, ...data.anims.map((one) => one.index)) + 1;

  for (const anim of asked) {
    let made: Made;

    if (anim === SpriteAnim.Rotate || anim === SpriteAnim.Swing) {
      // Turning as every drawn Rotate and Swing does: each row starts at
      // its own facing, steps back one facing a frame and comes round to
      // where it began. A Swing also carries the pokemon, shadow and all,
      // along its loop
      const swing = anim === SpriteAnim.Swing;
      const turn = rows + 1;
      const steps = (row: number): Step[] =>
        Array.from({ length: turn }, (_, column) => {
          const [dx, dy] = swing ? (SWING_PATH[row % 8][column] ?? [0, 0]) : [0, 0];

          return { dx, dy, duration: swing ? (SWING_DURATIONS[column] ?? 2) : 2 };
        });

      made = lay(poses, steps, rows);
      for (const key of ['animation', 'offsets', 'shadow'] as const) {
        made.images[key].data.fill(0);
      }
      const padX = (made.frameWidth - poses[0].animation.width) / 2;
      const padY = (made.frameHeight - poses[0].animation.height) / 2;

      for (let row = 0; row < rows; row += 1) {
        steps(row).forEach((step, column) => {
          const pose = poses[(row - column + rows * turn) % rows];

          for (const key of ['animation', 'offsets', 'shadow'] as const) {
            paste(
              made.images[key],
              pose[key],
              column * made.frameWidth + padX + step.dx,
              row * made.frameHeight + padY + step.dy,
            );
          }
        });
      }
    } else if (anim === SpriteAnim.Sleep) {
      // Asleep is drawn in one facing: DownLeft, which shows the body
      // side-on where Down would show a front
      made = lay([poses[rows >= 8 ? 7 : 0]], () => motion(anim, 0), 1);
    } else {
      made = lay(poses, (row) => motion(anim, row), rows);
    }
    if (anim === SpriteAnim.Attack) {
      made.extra = '      <RushFrame>1</RushFrame>\n      <HitFrame>3</HitFrame>\n      <ReturnFrame>4</ReturnFrame>';
    }
    images.set(anim, made.images);
    entries.push(entry(anim, index, made));
    added.push({ anim, from: source });
    index += 1;
  }
  const animData = archive.animData.replace('</Anims>', `${entries.join('\n')}\n  </Anims>`);

  return { archive: { ...archive, animData, images }, added };
}

/**
 * Each coat given the common animations neither it nor the other of its
 * pair has drawn.
 *
 * One its pair has drawn is left to the [merge](./merge.ts), which
 * recolours the drawing — a real drawing in the wrong colours beats a
 * slid standing pose in the right ones.
 */
export function polyfillCoats(read: { key: CoatKey; archive: Archive }[]): {
  archives: { key: CoatKey; archive: Archive }[];
  polyfilled: Polyfilled[];
} {
  const drawn = new Map(
    read.map((held) => [held.key, new Set(readAnimData(held.archive.animData).anims.map((one) => one.anim))]),
  );
  const polyfilled: Polyfilled[] = [];
  const archives = read.map((held) => {
    const pair = PAIRS.find((one) => one.includes(held.key));
    const other = pair == null ? undefined : drawn.get(pair[0] === held.key ? pair[1] : pair[0]);
    const wanted = POLYFILLS.filter((anim) => other?.has(anim) !== true);
    const { archive, added } = polyfill(held.archive, wanted);

    polyfilled.push(...added.map((one) => ({ coat: held.key, ...one })));
    return { key: held.key, archive };
  });

  return { archives, polyfilled };
}
