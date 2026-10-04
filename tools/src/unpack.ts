import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Anim } from './anim-data.ts';
import type { SpriteAnim } from './anims.ts';
import { spriteAnimName } from './anims.ts';
import type { Archive, SpriteImages } from './archive.ts';
import type { Frame, Frames } from './frames.ts';
import { decodeFrames } from './frames.ts';
import type { Point } from './markers.ts';
import type { Raster } from './raster.ts';
import { blank, decode } from './raster.ts';
import type { SheetData } from './sheet.ts';
import type { CoatKey } from './slots.ts';
import { FILENAMES } from './write.ts';

/**
 * A built sheet, turned back into the folders it was built from.
 *
 * Most of the collection's folders are gone once their region is
 * built, so a sheet is all there is to work from when something has to
 * be added to it. Everything a folder holds is in the sheet: each
 * frame's picture and where it sits, its anchors, and the timings. The
 * folders come back as they would read — the same pixels at the same
 * places — so a sheet rebuilt from them reads back as the one unpacked.
 */

/** The colour each anchor is painted in, as the markers read them. */
const PAINT: Record<'center' | 'head' | 'left' | 'right', [number, number, number]> = {
  center: [0, 0, 0],
  head: [255, 0, 0],
  left: [0, 255, 0],
  right: [0, 0, 255],
};

function dot(raster: Raster, x: number, y: number, rgb: [number, number, number]): void {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) {
    return;
  }
  const at = (y * raster.width + x) * 4;

  raster.data[at] = rgb[0];
  raster.data[at + 1] = rgb[1];
  raster.data[at + 2] = rgb[2];
  raster.data[at + 3] = 255;
}

/** The `AnimData.xml` the description was read from, written again. */
export function animDataOf(meta: SheetData): string {
  const entry = (anim: Anim): string =>
    [
      '    <Anim>',
      `      <Name>${spriteAnimName(anim.anim)}</Name>`,
      `      <Index>${anim.index}</Index>`,
      ...(anim.copyOf == null
        ? [
            `      <FrameWidth>${anim.frameWidth}</FrameWidth>`,
            `      <FrameHeight>${anim.frameHeight}</FrameHeight>`,
            ...(anim.rushFrame == null ? [] : [`      <RushFrame>${anim.rushFrame}</RushFrame>`]),
            ...(anim.hitFrame == null ? [] : [`      <HitFrame>${anim.hitFrame}</HitFrame>`]),
            ...(anim.returnFrame == null ? [] : [`      <ReturnFrame>${anim.returnFrame}</ReturnFrame>`]),
            '      <Durations>',
            ...anim.durations.map((duration) => `        <Duration>${duration}</Duration>`),
            '      </Durations>',
          ]
        : [`      <CopyOf>${spriteAnimName(anim.copyOf)}</CopyOf>`]),
      '    </Anim>',
    ].join('\n');

  return [
    '<?xml version="1.0"?>',
    '<AnimData>',
    `  <ShadowSize>${meta.shadowSize}</ShadowSize>`,
    '  <Anims>',
    ...meta.anims.map(entry),
    '  </Anims>',
    '</AnimData>',
    '',
  ].join('\n');
}

/** One coat's images, every frame put back in its untrimmed cell. */
function imagesOf(meta: SheetData, frames: Frames, sheet: Raster): Map<SpriteAnim, SpriteImages> {
  const images = new Map<SpriteAnim, SpriteImages>();

  for (const target of meta.sprites) {
    const width = target.sourceFrameWidth;
    const height = target.sourceFrameHeight;
    const animation = blank(width * target.columns, height * target.rows);
    const offsets = blank(animation.width, animation.height);
    const shadow = blank(animation.width, animation.height);

    for (let at = 0; at < target.frames[1]; at += 1) {
      const frame: Frame | undefined = frames.records[frames.indices[target.frames[0] + at]];

      if (frame == null) {
        continue;
      }
      const cellX = (at % target.columns) * width + target.trim[0];
      const cellY = Math.floor(at / target.columns) * height + target.trim[1];
      const [px, py, pw, ph] = meta.sheet.pictures[frame.cell];

      for (let dy = 0; dy < ph; dy += 1) {
        for (let dx = 0; dx < pw; dx += 1) {
          const from = ((py + dy) * sheet.width + px + (frame.flip ? pw - 1 - dx : dx)) * 4;
          const x = cellX + frame.at[0] + dx;
          const y = cellY + frame.at[1] + dy;

          if (sheet.data[from + 3] === 0 || x < 0 || y < 0 || x >= animation.width || y >= animation.height) {
            continue;
          }
          sheet.data.copy(animation.data, (y * animation.width + x) * 4, from, from + 4);
        }
      }
      const place = (point: Point | null): [number, number] | null =>
        point == null ? null : [cellX + point[0], cellY + point[1]];

      for (const key of ['center', 'head', 'left', 'right'] as const) {
        const spot = place(frame[key]);

        if (spot != null) {
          dot(offsets, spot[0], spot[1], PAINT[key]);
        }
      }
      const spot = place(frame.shadow);

      if (spot != null) {
        dot(shadow, spot[0], spot[1], [255, 255, 255]);
      }
    }
    images.set(target.anim, { animation, offsets, shadow });
  }
  return images;
}

/** Every coat of the sheet in `folder`, as an archive, with the description it came with. */
export default function unpack(folder: string): {
  meta: SheetData;
  archives: { key: CoatKey; archive: Archive }[];
} {
  const meta = JSON.parse(readFileSync(join(folder, 'sheet.json'), 'utf8')) as SheetData;
  const frames = decodeFrames(readFileSync(join(folder, 'frames.bin')));
  const animData = animDataOf(meta);

  return {
    meta,
    archives: meta.coats.map((key) => ({
      key,
      archive: {
        animData,
        images: imagesOf(meta, frames, decode(readFileSync(join(folder, FILENAMES[key])))),
        credits: meta.credits[key] ?? [],
      },
    })),
  };
}
