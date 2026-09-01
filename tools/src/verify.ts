import type { Archive } from './archive.ts';
import type { Frames } from './frames.ts';
import type { Raster } from './raster.ts';
import type { Layout, SheetData } from './sheet.ts';
import type { CoatKey } from './slots.ts';
import { spriteAnimName } from './anims.ts';

/**
 * Checking that a sheet still draws what its folders drew.
 *
 * Everything the optimizer does is meant to be lossless: frames are
 * cropped, repeats are stored once, mirrored rows are stored as their
 * reflection and the container is swapped, but the picture that comes
 * back out of the description is the picture that went in. That is a
 * claim worth testing rather than trusting, and it is the thing that
 * makes deleting the source folders safe.
 *
 * So this reads every frame back the way a renderer would — pull the
 * picture the description names, mirror it if it says to, put it where
 * it says — and compares it, pixel for pixel, against the frame in the
 * folder it came from. A pixel drawn nowhere is transparent in both,
 * whatever colour an indexed palette happened to give it.
 */

/** Where one frame did not survive the round trip. */
export interface Mismatch {
  coat: CoatKey;
  anim: string;
  row: number;
  column: number;
  x: number;
  y: number;
}

/** One pixel of an image, or fully transparent where there is none. */
function pixelAt(raster: Raster, x: number, y: number): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) {
    return [0, 0, 0, 0];
  }
  const at = (y * raster.width + x) * 4;

  return [raster.data[at], raster.data[at + 1], raster.data[at + 2], raster.data[at + 3]];
}

/** Whether two pixels draw the same thing. */
function same(one: [number, number, number, number], two: [number, number, number, number]): boolean {
  // Nothing drawn is nothing drawn: an indexed palette is free to give
  // a transparent pixel whatever colour it likes
  if (one[3] === 0 && two[3] === 0) {
    return true;
  }
  return one[0] === two[0] && one[1] === two[1] && one[2] === two[2] && one[3] === two[3];
}

/**
 * Every frame of every coat, read back off the sheet and compared with
 * the folder it came from. Resolves the mismatches, of which there
 * should be none
 */
export default function verifySheet(
  meta: SheetData,
  frames: Frames,
  layouts: Layout[],
  archives: { key: CoatKey; archive: Archive }[],
  sheets: { key: CoatKey; raster: Raster }[],
): Mismatch[] {
  const found: Mismatch[] = [];

  for (const held of sheets) {
    const coat = meta.coats.indexOf(held.key);
    const archive = archives.find((one) => one.key === held.key)?.archive;

    if (archive == null || coat < 0) {
      continue;
    }
    for (const target of meta.sprites) {
      const source = archive.images.get(target.anim)?.animation;
      const grid = layouts.find((layout) => layout.anim === target.anim)?.coats[coat];

      // A coat that does not draw this animation, or draws it on a grid
      // that could not be lined up with the rest, leaves its part of the
      // sheet clear and there is nothing to compare it against
      if (source == null || grid == null) {
        continue;
      }
      const anim = spriteAnimName(target.anim);

      for (let row = 0; row < target.rows; row += 1) {
        for (let column = 0; column < target.columns; column += 1) {
          const at = row * target.columns + column;

          if (at >= target.frames[1]) {
            continue;
          }
          const frame = frames.records[frames.indices[target.frames[0] + at]];
          const picture = frame == null ? null : meta.sheet.pictures[frame.cell];

          if (frame == null || picture == null) {
            found.push({ coat: held.key, anim, row, column, x: 0, y: 0 });
            continue;
          }
          const [px, py, pw, ph] = picture;
          const cellX = grid.x + column * grid.pitchX;
          const cellY = grid.y + row * grid.pitchY;

          for (let y = 0; y < target.frameHeight; y += 1) {
            for (let x = 0; x < target.frameWidth; x += 1) {
              const dx = x - frame.at[0];
              const dy = y - frame.at[1];
              const inside = dx >= 0 && dy >= 0 && dx < pw && dy < ph;
              const drawn: [number, number, number, number] = inside
                ? pixelAt(held.raster, px + (frame.flip ? pw - 1 - dx : dx), py + dy)
                : [0, 0, 0, 0];
              // Where the shared frame reaches past this coat's own
              // cell there is nothing drawn, and nothing to expect
              const withinX = grid.offsetX + x;
              const withinY = grid.offsetY + y;
              const expected: [number, number, number, number] =
                withinX < 0 || withinY < 0 || withinX >= grid.pitchX || withinY >= grid.pitchY
                  ? [0, 0, 0, 0]
                  : pixelAt(source, cellX + withinX, cellY + withinY);

              if (!same(drawn, expected)) {
                found.push({ coat: held.key, anim, row, column, x, y });
                // One bad pixel is enough to condemn the frame, and a
                // frame's worth of them says nothing more
                y = target.frameHeight;
                break;
              }
            }
          }
        }
      }
    }
  }
  return found;
}
