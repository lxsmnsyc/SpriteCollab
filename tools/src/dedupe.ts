import { createHash } from 'node:crypto';

/**
 * Packing the same picture once, and only the lit part of it.
 *
 * Half of a sheet is a drawing it already holds: a pose held for ten
 * frames, and a left-facing row that is the right-facing one mirrored.
 * Both are found here by comparing pixels — nothing is assumed about
 * which rows mirror which. Each frame is also cropped to what is drawn
 * in it, which is where most of the sheet goes: a clip's box has to
 * hold its widest lunge, and every other frame of it rattles around
 * inside that box.
 *
 * What comes out is the distinct pictures, plus for every frame of the
 * grid which picture it is, whether it is that picture reflected, and
 * where it sits inside the clip's box.
 *
 * One of these runs for a **whole sheet** rather than for a clip: a
 * pokemon standing still is drawn the same in its Idle, its Charge and
 * the first frame of its Attack, and cropping is what makes those
 * comparable — they were different sizes while each carried its clip's
 * padding.
 *
 * The comparison is across **every coat at once**. A shiny is the same
 * pokemon in other colours, and two frames that match on the ordinary
 * drawing may differ on the shiny; all four coats share one description,
 * so a pair is only a pair when it is a pair in all of them.
 *
 * Every coat is read through a grid of its own. Coats are not always
 * drawn on the same one — a shiny is sometimes padded to a smaller
 * frame than the ordinary drawing, or a frame or two shorter — so a
 * frame is addressed by its row and column and each coat is told where
 * its own cells are and how much of one to read.
 */

/**
 * Any decoded picture: four bytes a pixel, however it was read. Named
 * apart from `Raster` so this can be run from a script as well as from
 * the processor, which read their pixels through different doors
 */
export interface Pixels {
  width: number;
  height: number;
  data: Buffer;
}

/**
 * Where the frames of one clip are, in whatever they were read from.
 *
 * A sheet already packed steps a whole frame at a time from the top
 * left of its region; a folder steps a whole **source** cell and starts
 * wherever the trim did. One shape covers both.
 *
 * `frameWidth` and `frameHeight` are the frame every coat shares, and
 * `pitch` and `offset` are this coat's own: the cell it steps by, and
 * where the shared frame sits inside that cell
 */
export interface SourceGrid {
  x: number;
  y: number;
  /** How far apart this coat's cells are. */
  pitchX: number;
  pitchY: number;
  /** Where the shared frame starts inside one of them. */
  offsetX: number;
  offsetY: number;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
}

/** One coat's drawing, and where its frames are in it. */
export interface Coat {
  raster: Pixels;
  grid: SourceGrid;
}

/** A grid over pictures that are already trimmed and packed. */
export function packedGrid(
  x: number,
  y: number,
  frameWidth: number,
  frameHeight: number,
  columns: number,
  rows: number,
): SourceGrid {
  return {
    x,
    y,
    pitchX: frameWidth,
    pitchY: frameHeight,
    offsetX: 0,
    offsetY: 0,
    frameWidth,
    frameHeight,
    columns,
    rows,
  };
}

/** Where one frame's cell starts, in whatever it was read from. */
export function cellOf(grid: SourceGrid, column: number, row: number): [number, number] {
  return [grid.x + column * grid.pitchX, grid.y + row * grid.pitchY];
}

/**
 * One pixel of the shared frame, read out of one coat.
 *
 * Nothing outside this coat's own cell, and nothing off the edge of its
 * drawing: a shared frame can be wider than the cell of a coat that was
 * padded more tightly, and reading past the cell would pull in the
 * neighbouring frame
 */
function alphaAt(coat: Coat, column: number, row: number, x: number, y: number): number {
  const withinX = coat.grid.offsetX + x;
  const withinY = coat.grid.offsetY + y;

  if (
    withinX < 0 ||
    withinY < 0 ||
    withinX >= coat.grid.pitchX ||
    withinY >= coat.grid.pitchY
  ) {
    return 0;
  }
  const [cellX, cellY] = cellOf(coat.grid, column, row);
  const px = cellX + withinX;
  const py = cellY + withinY;

  if (px < 0 || py < 0 || px >= coat.raster.width || py >= coat.raster.height) {
    return 0;
  }
  return coat.raster.data[(py * coat.raster.width + px) * 4 + 3];
}

/** Where one pixel of the shared frame is, or nothing where it is not drawn. */
function spotAt(coat: Coat, column: number, row: number, x: number, y: number): number | null {
  const withinX = coat.grid.offsetX + x;
  const withinY = coat.grid.offsetY + y;

  if (
    withinX < 0 ||
    withinY < 0 ||
    withinX >= coat.grid.pitchX ||
    withinY >= coat.grid.pitchY
  ) {
    return null;
  }
  const [cellX, cellY] = cellOf(coat.grid, column, row);
  const px = cellX + withinX;
  const py = cellY + withinY;

  if (px < 0 || py < 0 || px >= coat.raster.width || py >= coat.raster.height) {
    return null;
  }
  return (py * coat.raster.width + px) * 4;
}

/** A rectangle of pixels, wherever it is measured from. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where one frame of the grid gets its picture, and where it sits. */
export interface FrameCell {
  cell: number;
  flip: boolean;
  /** The picture's corner inside the clip's box, as `[x, y]`. */
  at: [number, number];
}

/**
 * A kept picture, addressed by the frame it came out of.
 *
 * Where it is in a given coat's drawing depends on that coat's grid, so
 * it is held as a frame and a corner inside that frame rather than as
 * one pair of absolute coordinates
 */
export interface Picture extends Rect {
  /** Which of the caller's sources holds it. */
  source: number;
  row: number;
  column: number;
}

export interface Deduper {
  /** Every distinct picture found so far, across every clip added. */
  readonly pictures: Picture[];
  /**
   * One clip's frames, in the grid's reading order.
   *
   * `source` says which drawing the clip is read from, and `coatKey` is
   * which coats that drawing has — two clips only ever share a picture
   * when they were compared across the same coats
   */
  add(coats: Coat[], source: number, coatKey: string): FrameCell[];
}

/**
 * What is drawn in one frame, across every coat.
 *
 * A shiny may light a pixel the ordinary drawing leaves clear, so the
 * box is the one that holds all of them: they share a description, and
 * a picture cropped per coat would put the coats at different sizes
 */
function contentOf(coats: Coat[], column: number, row: number): Rect | null {
  const { frameWidth, frameHeight } = coats[0].grid;
  let left = frameWidth;
  let top = frameHeight;
  let right = -1;
  let bottom = -1;

  for (const coat of coats) {
    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        if (alphaAt(coat, column, row, x, y) === 0) {
          continue;
        }
        if (x < left) {
          left = x;
        }
        if (x > right) {
          right = x;
        }
        if (y < top) {
          top = y;
        }
        if (y > bottom) {
          bottom = y;
        }
      }
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** One picture's pixels, and the same pixels mirrored, as digests. */
function digestsOf(
  coat: Coat,
  column: number,
  row: number,
  box: Rect,
): [plain: string, mirrored: string] {
  const plain = createHash('sha256');
  const mirrored = createHash('sha256');
  const row_ = Buffer.alloc(box.width * 4);
  const back = Buffer.alloc(box.width * 4);

  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const mirror = (box.width - 1 - x) * 4;
      const from = spotAt(coat, column, row, box.x + x, box.y + y);

      if (from == null) {
        row_.fill(0, x * 4, x * 4 + 4);
        back.fill(0, mirror, mirror + 4);
        continue;
      }
      coat.raster.data.copy(row_, x * 4, from, from + 4);
      coat.raster.data.copy(back, mirror, from, from + 4);
    }
    plain.update(row_);
    mirrored.update(back);
  }
  return [plain.digest('hex'), mirrored.digest('hex')];
}

/**
 * Something to add a sheet's clips to, one at a time.
 *
 * `trim` crops each frame to what is drawn in it; off, every frame is
 * the whole box, which is what an uncompacted sheet asks for
 */
export default function deduper(trim = true): Deduper {
  /** Every coat's digest of one picture, joined: the picture's identity. */
  const identity = new Map<string, number>();
  /** The same, mirrored, for spotting a picture drawn the other way round. */
  const reflected = new Map<string, number>();
  const pictures: Picture[] = [];

  return {
    pictures,
    add(coats, source, coatKey): FrameCell[] {
      const { frameWidth, frameHeight, columns, rows } = coats[0].grid;
      const frames: FrameCell[] = [];

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          // An empty frame still has to be a picture somewhere, so it
          // is the smallest one there is rather than a case of its own
          const content = (trim ? contentOf(coats, column, row) : null) ?? {
            x: 0,
            y: 0,
            width: trim ? 1 : frameWidth,
            height: trim ? 1 : frameHeight,
          };
          // Sized and coated: a picture compared across two coats says
          // nothing about the same picture compared across four
          const stamp = `${coatKey}:${content.width}x${content.height}`;
          const plain: string[] = [stamp];
          const mirrored: string[] = [stamp];

          for (const coat of coats) {
            const [one, two] = digestsOf(coat, column, row, content);

            plain.push(one);
            mirrored.push(two);
          }
          const at: [number, number] = [content.x, content.y];
          const key = plain.join('|');
          const kept = identity.get(key);

          if (kept != null) {
            frames.push({ cell: kept, flip: false, at });
            continue;
          }
          // A picture nobody has drawn yet, but somebody has drawn
          // backwards
          const facing = reflected.get(key);

          if (facing != null) {
            frames.push({ cell: facing, flip: true, at });
            continue;
          }
          const held = pictures.length;

          pictures.push({ ...content, source, row, column });
          identity.set(key, held);
          reflected.set(mirrored.join('|'), held);
          frames.push({ cell: held, flip: false, at });
        }
      }
      return frames;
    },
  };
}

/**
 * Copies the kept pictures onto the sheet, where the packer put them.
 *
 * `from` hands back the coat a picture is read out of, since a
 * pokemon's clips arrive as one image each and every coat has a grid of
 * its own. Nothing for a picture this coat was not drawn for, which
 * leaves that picture's corner of the sheet clear
 */
export function drawPictures(
  target: Pixels,
  pictures: Picture[],
  placed: ({ x: number; y: number } | undefined)[],
  from: (picture: Picture) => Coat | null,
): void {
  for (let at = 0; at < pictures.length; at += 1) {
    const picture = pictures[at];
    const spot = placed[at];
    const coat = from(picture);

    if (spot == null || coat == null) {
      continue;
    }
    for (let y = 0; y < picture.height; y += 1) {
      const targetY = spot.y + y;

      if (targetY < 0 || targetY >= target.height) {
        continue;
      }
      for (let x = 0; x < picture.width; x += 1) {
        const targetX = spot.x + x;
        const source = spotAt(coat, picture.column, picture.row, picture.x + x, picture.y + y);

        if (source == null || targetX < 0 || targetX >= target.width) {
          continue;
        }
        coat.raster.data.copy(
          target.data,
          (targetY * target.width + targetX) * 4,
          source,
          source + 4,
        );
      }
    }
  }
}

/** An empty picture of a given size. */
export function blankPixels(width: number, height: number): Pixels {
  return { width, height, data: Buffer.alloc(Math.max(0, width * height * 4)) };
}
