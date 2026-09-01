import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Raster } from '../src/raster.ts';
import { COLORS, put, raster, writePng } from './helpers.ts';

/**
 * A sprite folder, made up.
 *
 * The collection is two gigabytes of other people's art and a test
 * that reaches into it is a test that fails when somebody submits a
 * revision. So the end-to-end tests build their own folders in the
 * same shape: a description, three images an animation, and the coats
 * filed where the trailing-default rule puts them.
 */

export interface FixtureAnim {
  name: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  index: number;
  durations: number[];
  copyOf?: string;
}

/** The `AnimData.xml` for a set of animations. */
export function animDataFor(anims: FixtureAnim[], shadowSize = 1): string {
  const body = anims
    .map((anim) =>
      anim.copyOf == null
        ? `\t\t<Anim>
\t\t\t<Name>${anim.name}</Name>
\t\t\t<Index>${anim.index}</Index>
\t\t\t<FrameWidth>${anim.frameWidth}</FrameWidth>
\t\t\t<FrameHeight>${anim.frameHeight}</FrameHeight>
\t\t\t<Durations>${anim.durations.map((held) => `<Duration>${held}</Duration>`).join('')}</Durations>
\t\t</Anim>`
        : `\t\t<Anim>
\t\t\t<Name>${anim.name}</Name>
\t\t\t<Index>${anim.index}</Index>
\t\t\t<CopyOf>${anim.copyOf}</CopyOf>
\t\t</Anim>`,
    )
    .join('\n');

  return `<?xml version="1.0" ?>\n<AnimData>\n\t<ShadowSize>${shadowSize}</ShadowSize>\n\t<Anims>\n${body}\n\t</Anims>\n</AnimData>\n`;
}

/** An L shape, which is not the same thing drawn backwards. */
function shape(
  target: Raster,
  x: number,
  y: number,
  color: [number, number, number, number],
  flip: boolean,
): void {
  const at = (dx: number, dy: number): void => {
    put(target, x + (flip ? 3 - dx : dx), y + dy, color);
  };

  at(0, 0);
  at(0, 1);
  at(0, 2);
  at(1, 2);
  at(2, 2);
}

/**
 * The three images of one animation.
 *
 * The rows past the fourth are drawn as the mirror of the rows before
 * them, which is what a sprite sheet does and what the deduplicator is
 * meant to notice
 */
export function imagesFor(
  anim: FixtureAnim,
  color: [number, number, number, number],
  cell: { width: number; height: number } = { width: anim.frameWidth, height: anim.frameHeight },
): {
  animation: Raster;
  shadow: Raster;
  offsets: Raster;
} {
  const width = cell.width * anim.columns;
  const height = cell.height * anim.rows;
  const animation = raster(width, height);
  const shadow = raster(width, height);
  const offsets = raster(width, height);
  // A cell of another size is the same drawing padded differently, so
  // everything in it moves by half the difference: that is what lets
  // two coats on different grids be lined up on the cell's centre
  const insetX = (cell.width - anim.frameWidth) / 2;
  const insetY = (cell.height - anim.frameHeight) / 2;

  for (let row = 0; row < anim.rows; row += 1) {
    for (let column = 0; column < anim.columns; column += 1) {
      const x = column * cell.width + insetX;
      const y = row * cell.height + insetY;
      const facing = row >= 4 ? anim.rows - row : row;

      shape(animation, x + 2 + facing, y + 2 + column, color, row >= 4);
      // The marker colours the collection uses: white for the shadow,
      // with its size rings around it, and black for the body
      put(shadow, x + 2, y + 6, COLORS.blue);
      put(shadow, x + 4, y + 6, COLORS.blue);
      put(shadow, x + 3, y + 6, COLORS.white);
      put(offsets, x + 3, y + 3, COLORS.black);
      put(offsets, x + 3, y + 1, COLORS.red);
    }
  }
  return { animation, shadow, offsets };
}

export interface CoatFixture {
  /** Where it goes under the sprite root, as the folders name it. */
  path: string;
  color: [number, number, number, number];
  credits?: string;
  /**
   * How many directions this coat was drawn for, where that is fewer
   * than the others. A shiny is sometimes finished for seven of the
   * eight while the ordinary drawing has all of them
   */
  rows?: number;
  /**
   * The cell this coat pads its frames out to, where that is not the
   * one the others use. Charizard's Mega X is like this
   */
  cell?: { width: number; height: number };
}

/** Writes one form's folders under a sprite root. */
export function writeFixture(root: string, anims: FixtureAnim[], coats: CoatFixture[]): void {
  const drawn = anims.filter((anim) => anim.copyOf == null);

  for (const coat of coats) {
    const folder = join(root, coat.path);

    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'AnimData.xml'),
      animDataFor(
        coat.cell == null
          ? anims
          : anims.map((anim) =>
              anim.copyOf == null
                ? // oxlint-disable-next-line typescript/no-non-null-assertion
                  { ...anim, frameWidth: coat.cell!.width, frameHeight: coat.cell!.height }
                : anim,
            ),
      ),
    );
    writeFileSync(
      join(folder, 'credits.txt'),
      coat.credits ?? '2020-10-07 17:58:43.323442\tCHUNSOFT\tCUR\tUnspecified\tWalk',
    );
    for (const anim of drawn) {
      const images = imagesFor(
        coat.rows == null ? anim : { ...anim, rows: Math.min(anim.rows, coat.rows) },
        coat.color,
        coat.cell,
      );

      writePng(folder, `${anim.name}-Anim.png`, images.animation);
      writePng(folder, `${anim.name}-Shadow.png`, images.shadow);
      writePng(folder, `${anim.name}-Offsets.png`, images.offsets);
    }
  }
}

/** The animations every end-to-end test uses. */
export const ANIMS: FixtureAnim[] = [
  { name: 'Walk', index: 0, frameWidth: 8, frameHeight: 8, columns: 2, rows: 8, durations: [4, 4] },
  { name: 'Idle', index: 1, frameWidth: 8, frameHeight: 8, columns: 1, rows: 8, durations: [8] },
  { name: 'Strike', index: 2, frameWidth: 8, frameHeight: 8, columns: 2, rows: 8, durations: [], copyOf: 'Walk' },
];
