import { join } from 'node:path';
import type { Anim, AnimData } from './anim-data.ts';
import readAnimData from './anim-data.ts';
import type { SpriteAnim } from './anims.ts';
import type { Archive, SpriteImages } from './archive.ts';
import readArchive from './archive.ts';
import type { Credit } from './credits.ts';
import type { Coat, FrameCell, SourceGrid } from './dedupe.ts';
import deduper, { drawPictures } from './dedupe.ts';
import type { Frame, Frames } from './frames.ts';
import { builder } from './frames.ts';
import type { Derived, Refused } from './merge.ts';
import mergeCoats from './merge.ts';
import type { FrameMarkers } from './markers.ts';
import markersFor from './markers.ts';
import pack from './packing.ts';
import type { Region } from './regions.ts';
import regionOf from './regions.ts';
import type { Raster } from './raster.ts';
import { blank, encode } from './raster.ts';
import type { CoatKey, Slot } from './slots.ts';
import type { Names } from './tracker.ts';
import type { Trim } from './trim.ts';
import computeTrim from './trim.ts';

/**
 * A form's folders into one sheet.
 *
 * The collection stores a sprite the way the tools that made it wanted
 * it: every animation a separate image, every frame padded out to the
 * widest lunge of its own clip, and the same pose drawn again in every
 * clip that holds it. That is right for editing and wasteful for
 * everything else.
 *
 * This packs all four coats of one form into one sheet each, sharing a
 * single description between them: only the animations anything
 * downstream supports, every frame cropped to what is drawn in it,
 * every repeated picture stored once, every mirrored row stored as its
 * reflection, and the whole thing written as the smallest PNG container
 * that gives the same pixels back.
 *
 * The four coats are deduplicated *against each other* rather than one
 * at a time, and against the same set of coats throughout. They share
 * one description, so two frames are only the same picture when they
 * are the same picture in every coat — otherwise a shiny would want a
 * different layout from the ordinary drawing and the description could
 * not describe both.
 */

interface Entry {
  anim: SpriteAnim;
  /**
   * Each coat's drawing of it and the grid it is read through, in the
   * sheet's coat order. Nothing where a coat does not draw it, or draws
   * it on a grid of a different shape
   */
  coats: (Coat | null)[];
  images: SpriteImages;
  /** The grid as the first coat that drew it authored the cell. */
  sourceFrameWidth: number;
  sourceFrameHeight: number;
  /** The frame every coat shares, once trimmed. */
  frameWidth: number;
  frameHeight: number;
  /** Where that frame sits in the first coat's cell. */
  trim: [number, number];
  columns: number;
  rows: number;
  /** Which picture each frame is, once every coat has been read. */
  frames?: FrameCell[];
}

/** Where one picture landed on the sheet, as `[x, y, width, height]`. */
export type PictureData = [x: number, y: number, width: number, height: number];

/** What the description says about one animation's grid. */
export interface SpriteTarget {
  anim: SpriteAnim;
  frameWidth: number;
  frameHeight: number;
  sourceFrameWidth: number;
  sourceFrameHeight: number;
  trim: [number, number];
  columns: number;
  /** How many directions are drawn, in the order `SPRITE_DIRECTIONS` names. */
  rows: number;
  /** Where this animation's frames are in `frames.bin`, as `[offset, count]`. */
  frames: [offset: number, count: number];
}

/** The description both coats and every reader share. */
export interface SheetData {
  version: 2;
  dex: number;
  form: number;
  /** What the collection calls them, where its record was read. */
  name: string | null;
  formName: string | null;
  /** Where it is filed: its form's region, or its dex number's. */
  region: Region;
  /** Whether every frame was cropped to the grid's content. */
  compact: boolean;
  shadowSize: number;
  /** The coats this sheet was built for, in the order they are filed. */
  coats: CoatKey[];
  sheet: { width: number; height: number; pictures: PictureData[] };
  anims: Anim[];
  /** One per animation that is drawn, in the order they are numbered. */
  sprites: SpriteTarget[];
  /** Who drew each coat, which the licence asks to be carried along. */
  credits: Partial<Record<CoatKey, Credit[]>>;
  /**
   * Animations one coat gained by recolouring the other of its pair,
   * which are this tool's pixels rather than the collection's
   */
  derived: Derived[];
}

/** One coat, drawn and weighed. */
export interface CoatSheet {
  key: CoatKey;
  bytes: Buffer;
  /** Which PNG container it ended up in. */
  as: string;
  /** What the same sheet would have cost written plainly. */
  plain: number;
}

/** How one animation was read out of each coat. */
export interface Layout {
  anim: SpriteAnim;
  /** One grid a coat, or nothing where that coat does not draw it. */
  coats: (SourceGrid | null)[];
}

export interface SheetResult {
  meta: SheetData;
  /** The per-frame numbers, for `frames.bin`. */
  frames: Frames;
  /**
   * The grid each coat was read through, which the check needs: coats
   * do not always share one, so a frame cannot be found in a coat's
   * drawing from the description alone
   */
  layouts: Layout[];
  coats: CoatSheet[];
  width: number;
  height: number;
  /** Distinct pictures kept, against frames read. */
  pictures: number;
  frameCount: number;
  /** Animations one coat could not be given, and why. */
  refused: Refused[];
}

export interface SheetOptions {
  /** Whether every frame is cropped to the grid's content. */
  compact?: boolean;
  /**
   * Whether a coat missing an animation its pair has gets it, by
   * recolouring. On by default
   */
  merge?: boolean;
  /** What the species and the form are called, where that is known. */
  names?: Names;
}

/**
 * Every animation any coat draws, on a frame all of them share.
 *
 * The union of the coats rather than the first coat's list, because a
 * coat is sometimes finished for an animation the others are not, and
 * an animation only the shiny draws is still an animation.
 *
 * Coats are not always drawn on the same grid: the shiny of Charizard's
 * Mega X is padded to an 80x88 cell where the ordinary drawing uses
 * 88x96, and half a dozen more across the collection are like it. So
 * each coat is measured in its own cell and the results are lined up on
 * the cell's centre, which is the point a PMD frame is padded around —
 * the same drawing in a smaller cell has the same content in the same
 * place once both are measured from the middle. The frame they share is
 * the rectangle that holds all of them, and each coat is told where
 * that rectangle falls inside its own cell.
 *
 * A coat that disagrees about how many frames there are cannot be lined
 * up at all, and is left out of the sheet rather than drawn wrong
 */
function entriesFor(
  coats: Map<SpriteAnim, SpriteImages>[],
  grids: AnimData[],
  compact: boolean,
): Entry[] {
  const drawn = [...new Set(grids.flatMap((data) => data.anims.map((anim) => anim.target)))].sort(
    (one, two) => one - two,
  );
  const entries: Entry[] = [];

  for (const anim of drawn) {
    /** One coat's cell for this animation, as that coat authored it. */
    const cells = coats.map((coat, at) => {
      const raster = coat.get(anim)?.animation;

      if (raster == null) {
        return null;
      }
      const sized = grids[at].anims.find((held) => held.target === anim);
      const width = sized == null || sized.frameWidth <= 0 ? raster.width : sized.frameWidth;
      const height = sized == null || sized.frameHeight <= 0 ? raster.height : sized.frameHeight;

      return {
        raster,
        width,
        height,
        columns: Math.max(Math.floor(raster.width / width), 1),
        rows: Math.max(Math.floor(raster.height / height), 1),
      };
    });
    const first = cells.findIndex((cell) => cell != null);

    if (first < 0) {
      continue;
    }
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const base = cells[first]!;
    /** The coats that agree about how many frames there are. */
    const lined = cells.map((cell) =>
      cell != null && cell.columns === base.columns && cell.rows === base.rows ? cell : null,
    );
    // Measured from the middle of each coat's own cell, in halves so
    // that an odd cell size does not lose half a pixel on the way
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    for (const cell of lined) {
      if (cell == null) {
        continue;
      }
      const box = compact
        ? computeTrim(cell.raster, cell.width, cell.height, cell.columns, cell.rows)
        : { x: 0, y: 0, width: cell.width, height: cell.height };

      left = Math.min(left, box.x * 2 - cell.width);
      top = Math.min(top, box.y * 2 - cell.height);
      right = Math.max(right, (box.x + box.width) * 2 - cell.width);
      bottom = Math.max(bottom, (box.y + box.height) * 2 - cell.height);
    }
    const frameWidth = Math.round((right - left) / 2);
    const frameHeight = Math.round((bottom - top) / 2);

    entries.push({
      anim,
      coats: lined.map((cell) =>
        cell == null
          ? null
          : {
              raster: cell.raster,
              grid: {
                x: 0,
                y: 0,
                pitchX: cell.width,
                pitchY: cell.height,
                offsetX: Math.round((cell.width + left) / 2),
                offsetY: Math.round((cell.height + top) / 2),
                frameWidth,
                frameHeight,
                columns: cell.columns,
                rows: cell.rows,
              },
            },
      ),
      // The marker images come from whichever coat drew this animation
      // first: the anchors are the pose, not the colours
      images: coats[first].get(anim) ?? {},
      sourceFrameWidth: base.width,
      sourceFrameHeight: base.height,
      frameWidth,
      frameHeight,
      trim: [
        Math.round((base.width + left) / 2),
        Math.round((base.height + top) / 2),
      ],
      columns: base.columns,
      rows: base.rows,
    });
  }
  return entries;
}

/** Every anchor of every frame of one animation, in reading order. */
function framesOf(entry: Entry): Frame[] {
  const markers: FrameMarkers[] = [];

  for (let row = 0; row < entry.rows; row += 1) {
    for (let column = 0; column < entry.columns; column += 1) {
      markers.push(
        markersFor(
          entry.images.shadow ?? null,
          entry.images.offsets ?? null,
          {
            x: column * entry.sourceFrameWidth,
            y: row * entry.sourceFrameHeight,
            width: entry.sourceFrameWidth,
            height: entry.sourceFrameHeight,
          },
          entry.trim,
        ),
      );
    }
  }
  return markers.map((held, at): Frame => {
    const cell = entry.frames?.[at];

    return {
      ...held,
      cell: cell?.cell ?? at,
      flip: cell?.flip === true,
      at: cell?.at ?? [0, 0],
    };
  });
}

/**
 * Builds one form's sheet from the folders already read.
 *
 * Split from [`processSlot`](#processSlot) so a test can hand it
 * archives it made up rather than a folder it had to write first
 */
export function buildSheet(
  slot: Pick<Slot, 'dex' | 'form'>,
  archives: { key: CoatKey; archive: Archive }[],
  options: SheetOptions = {},
): SheetResult {
  if (archives.length === 0) {
    throw new Error(`${slot.dex}/${slot.form} has no coats to build from`);
  }
  const compact = options.compact ?? true;
  // The timings written into the description are the first coat's:
  // every other coat is the same pokemon drawn again, held for the same
  // time. The *grids* are read per coat, since those do sometimes differ
  const grids = archives.map((held) => readAnimData(held.archive.animData));
  const data = grids[0];
  // Before anything is measured: a coat that gains a clip here is a
  // coat with more to trim, deduplicate and pack
  const merged =
    options.merge === false ? { derived: [], refused: [] } : mergeCoats(archives, grids);
  const images = archives.map((held) => held.archive.images);
  const entries = entriesFor(images, grids, compact);

  if (entries.length === 0) {
    throw new Error(`${slot.dex}/${slot.form} draws none of the supported animations`);
  }
  // Which frames are the same picture, decided across every coat and
  // every clip at once. Across coats because they share one description,
  // so a pair is only a pair when it is a pair in all of them; across
  // clips because a pokemon standing still is drawn the same in its
  // Idle, its Charge and the first frame of its Attack.
  //
  // Every clip is compared against the same set of coats, including the
  // ones that did not draw it — where a coat has no drawing it reads as
  // nothing drawn. Comparing each clip against only the coats that have
  // it would put clips into groups that can never share a picture with
  // each other, which is a great deal of the sheet given away for
  // nothing
  const shared = deduper(compact);
  /** A coat that draws nothing, for one that has no drawing of a clip. */
  const nothing = (entry: Entry): Coat => ({
    raster: blank(0, 0),
    grid: {
      x: 0,
      y: 0,
      pitchX: entry.frameWidth,
      pitchY: entry.frameHeight,
      offsetX: 0,
      offsetY: 0,
      frameWidth: entry.frameWidth,
      frameHeight: entry.frameHeight,
      columns: entry.columns,
      rows: entry.rows,
    },
  });
  let frameCount = 0;

  for (let at = 0; at < entries.length; at += 1) {
    const entry = entries[at];

    entry.frames = shared.add(
      entry.coats.map((coat) => coat ?? nothing(entry)),
      at,
      // One group for the whole sheet
      'all',
    );
    frameCount += entry.frames.length;
  }
  const layout = pack(
    shared.pictures.map((picture, at) => ({ at, w: picture.width, h: picture.height })),
  );
  const spots: ({ x: number; y: number } | undefined)[] = [];

  for (const { box, x, y } of layout.placed) {
    spots[box.at] = { x, y };
  }
  const built = builder();
  const sprites: SpriteTarget[] = entries.map((entry) => {
    const { offset, count } = built.add(framesOf(entry));

    return {
      anim: entry.anim,
      frameWidth: entry.frameWidth,
      frameHeight: entry.frameHeight,
      sourceFrameWidth: entry.sourceFrameWidth,
      sourceFrameHeight: entry.sourceFrameHeight,
      trim: entry.trim,
      columns: entry.columns,
      rows: entry.rows,
      frames: [offset, count],
    };
  });

  /** One coat drawn onto the layout every coat shares. */
  const paint = (coat: number): Raster => {
    const raster = blank(layout.width, layout.height);

    drawPictures(raster, shared.pictures, spots, (picture) => entries[picture.source].coats[coat]);
    return raster;
  };

  const meta: SheetData = {
    version: 2,
    dex: slot.dex,
    form: slot.form,
    name: options.names?.name ?? null,
    formName: options.names?.formName ?? null,
    region: regionOf(slot.dex, options.names?.formName),
    compact,
    shadowSize: data.shadowSize,
    coats: archives.map((held) => held.key),
    sheet: {
      width: layout.width,
      height: layout.height,
      pictures: shared.pictures.map((picture, at): PictureData => [
        spots[at]?.x ?? 0,
        spots[at]?.y ?? 0,
        picture.width,
        picture.height,
      ]),
    },
    // `anims` mirrors the folder, so its frame sizes stay untrimmed:
    // `sprites` is the one that follows compaction
    anims: data.anims,
    sprites,
    credits: Object.fromEntries(
      archives
        .filter((held) => held.archive.credits.length > 0)
        .map((held) => [held.key, held.archive.credits]),
    ),
    derived: merged.derived,
  };

  return {
    meta,
    frames: built.built(),
    layouts: entries.map((entry) => ({
      anim: entry.anim,
      coats: entry.coats.map((coat) => coat?.grid ?? null),
    })),
    coats: archives.map((held, at): CoatSheet => {
      const encoded = encode(paint(at));

      return { key: held.key, bytes: encoded.bytes, as: encoded.as, plain: encoded.plain };
    }),
    width: layout.width,
    height: layout.height,
    pictures: shared.pictures.length,
    frameCount,
    refused: merged.refused,
  };
}

/** Reads one form's folders and builds its sheet. */
export default function processSlot(
  root: string,
  slot: Slot,
  options: SheetOptions = {},
): SheetResult {
  return buildSheet(
    slot,
    slot.present.map((key) => ({ key, archive: readArchive(join(root, slot.coats[key])) })),
    options,
  );
}
