/**
 * Shadow sprites: a sheet's colours flattened per part, inverted, and laid
 * back over a sheet's own shading, with the eyes painted red.
 *
 *   node .claude/skills/shadow-sprites/shadow.ts palette 250/0 regular
 *   node .claude/skills/shadow-sprites/shadow.ts preview plan.json
 *   node .claude/skills/shadow-sprites/shadow.ts install plan.json
 *
 * A plan names the sheet the pixels come from, the parts its colours
 * fall into and, for a sheet that already has a Shadow drawing, the
 * sheet whose colours the scheme is taken from. See SKILL.md.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import decode, { encodeSmallest, encodeTruecolor } from '../../../tools/src/png.ts';
import type { Image } from '../../../tools/src/png.ts';
import { FILENAMES, updateIndex } from '../../../tools/src/write.ts';
import type { CoatKey } from '../../../tools/src/slots.ts';

const REPO = join(import.meta.dirname, '../../..');
const COMPACT = join(REPO, 'compact');

interface Family {
  part: string;
  /** Every colour of the part in the sheet being recoloured, light and shade alike. */
  members: string[];
  /** The part's flat colour, the one its shading is removed down to. */
  base: string;
  /**
   * Where the scheme comes from, when it is not the part itself: the flat
   * colours of the matching part of another sheet, averaged.
   */
  scheme?: string[];
  /**
   * For a part whose inverted colour is near black: keep its own shading,
   * at this fraction of its lightness. Pure black would lose every shade.
   */
  darken?: number;
}
interface Plan {
  /** The sheet the pixels come from, as `dex/form`, and which coat. */
  source: { form: string; coat: CoatKey };
  /** Where the result goes. A form that does not exist yet is created. */
  target: { form: string; coat: CoatKey; name?: string; region?: string };
  families: Family[];
  /**
   * Eyes drawn in a colour the body also uses, found by where they are:
   * a patch of `white` no bigger than `max` pixels, touching only `face`
   * colours and at least one `touch` colour, with a `near` colour within
   * `reach` pixels. Painted `#ff0000`.
   */
  eyes?: { white: string; face: string[]; touch: string[]; near: string[]; reach: number; max: number };
  /** Eye colours no other part uses, painted `#ff0000` outright. */
  red?: string[];
}

const rgb = (h: string) => [1, 3, 5].map((o) => parseInt(h.slice(o, o + 2), 16));
const toHex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function toHsl([r, g, b]: number[]): number[] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}
function fromHsl([h, s, l]: number[]): number[] {
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const invert = (h: string) => toHex(rgb(h).map((v) => 255 - v));
const mean = (list: string[]) => toHex([0, 1, 2].map((j) => list.reduce((t, h) => t + rgb(h)[j], 0) / list.length));
const hexAt = (img: Image, i: number) => '#' + [0, 1, 2].map((j) => img.rgba[i + j].toString(16).padStart(2, '0')).join('');

/** The folder of a built form, out of the index. */
function folderOf(form: string): string | null {
  const [dex, n] = form.split('/').map(Number);
  const index = JSON.parse(readFileSync(join(COMPACT, 'index.json'), 'utf8'));
  const slot = index.slots.find((s: any) => s.dex === dex && s.form === n);
  return slot == null ? null : join(COMPACT, slot.path);
}
function sheetOf(form: string, coat: CoatKey): Image {
  const folder = folderOf(form);
  if (folder == null) throw new Error(`${form} is not built`);
  return decode(readFileSync(join(folder, FILENAMES[coat])));
}

/** Every colour of a part to its new colour. Colours in no part stay. */
export function swapsFor(plan: Plan): Map<string, string> {
  const swaps = new Map<string, string>();
  for (const f of plan.families) {
    const target = invert(f.scheme == null ? f.base : mean(f.scheme));
    const [th, ts, tl] = toHsl(rgb(target));
    const baseL = toHsl(rgb(f.base))[2];
    for (const m of f.members) {
      const l = toHsl(rgb(m))[2];
      const out = f.darken != null ? fromHsl([0, 0, l * f.darken]) : fromHsl([th, ts, (l / baseL) * tl]);
      swaps.set(m, toHex(out));
    }
  }
  return swaps;
}

/** The pixels the eye rule picks out. */
export function eyesIn(img: Image, rule: NonNullable<Plan['eyes']>): Set<number> {
  const face = new Set(rule.face), touch = new Set(rule.touch), near = new Set(rule.near);
  const seen = new Set<number>(), found = new Set<number>();
  for (let p = 0; p < img.width * img.height; p++) {
    if (seen.has(p) || !img.rgba[p * 4 + 3] || hexAt(img, p * 4) !== rule.white) continue;
    const blob = [p], stack = [p];
    let enclosed = true, touched = false;
    seen.add(p);
    while (stack.length) {
      const q = stack.pop()!, x = q % img.width, y = (q / img.width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) { enclosed = false; continue; }
        const n = ny * img.width + nx;
        if (!img.rgba[n * 4 + 3]) { enclosed = false; continue; }
        const c = hexAt(img, n * 4);
        if (c === rule.white) { if (!seen.has(n)) { seen.add(n); blob.push(n); stack.push(n); } }
        else if (!face.has(c)) enclosed = false;
        else if (touch.has(c)) touched = true;
      }
    }
    if (!enclosed || !touched || blob.length > rule.max) continue;
    const close = blob.some((b) => {
      const bx = b % img.width, by = (b / img.width) | 0;
      for (let dy = -rule.reach; dy <= rule.reach; dy++) for (let dx = -rule.reach; dx <= rule.reach; dx++) {
        const nx = bx + dx, ny = by + dy;
        if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue;
        const n = (ny * img.width + nx) * 4;
        if (img.rgba[n + 3] && near.has(hexAt(img, n))) return true;
      }
      return false;
    });
    if (close) for (const b of blob) found.add(b);
  }
  return found;
}

export function render(plan: Plan): { source: Image; result: Buffer; swaps: Map<string, string>; eyes: Set<number> } {
  const source = sheetOf(plan.source.form, plan.source.coat);
  const swaps = swapsFor(plan);
  for (const c of plan.red ?? []) swaps.set(c, '#ff0000');
  const eyes = plan.eyes == null ? new Set<number>() : eyesIn(source, plan.eyes);
  const result = Buffer.from(source.rgba);
  for (let p = 0; p < source.width * source.height; p++) {
    const i = p * 4;
    if (!source.rgba[i + 3]) continue;
    const to = eyes.has(p) ? '#ff0000' : swaps.get(hexAt(source, i));
    if (to != null) rgb(to).forEach((v, j) => (result[i + j] = v));
  }
  return { source, result, swaps, eyes };
}

function preview(plan: Plan): void {
  const { source, result, swaps, eyes } = render(plan);
  for (const [from, to] of swaps) console.log(`  ${from} -> ${to}`);
  console.log(`eyes painted red: ${eyes.size} px`);
  const S = 2, gap = 12, H = Math.min(source.height, 260) * S, W = source.width * S * 2 + gap;
  const out = Buffer.alloc(W * H * 4, 255);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const right = x >= source.width * S + gap;
    if (!right && x >= source.width * S) continue;
    const sx = ((right ? x - source.width * S - gap : x) / S) | 0, i = (((y / S) | 0) * source.width + sx) * 4, o = (y * W + x) * 4;
    const src = right ? result : source.rgba, bg = (((x >> 3) + (y >> 3)) & 1) ? 214 : 236;
    for (let j = 0; j < 3; j++) out[o + j] = src[i + 3] ? src[i + j] : bg;
  }
  writeFileSync(join(REPO, 'shadow-preview.png'), encodeTruecolor({ width: W, height: H, rgba: out }, 'none'));
  console.log('wrote shadow-preview.png');
  if (eyes.size === 0) return;
  // Every place an eye was found, before and after, so a wrong pick shows
  const spots: number[][] = [];
  for (const p of eyes) {
    const x = p % source.width, y = (p / source.width) | 0;
    if (spots.every(([a, b]) => Math.abs(a - x) > 12 || Math.abs(b - y) > 12)) spots.push([x, y]);
  }
  const R = 7, E = 6, cell = (R * 2 + 1) * E, EW = spots.length * (cell + 6) - 6, EH = cell * 2 + 6;
  const eyesOut = Buffer.alloc(EW * EH * 4, 255);
  spots.forEach(([ex, ey], k) => [source.rgba, result].forEach((src, row) => {
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const sx = ex - R + ((x / E) | 0), sy = ey - R + ((y / E) | 0), o = ((row * (cell + 6) + y) * EW + k * (cell + 6) + x) * 4;
      const inside = sx >= 0 && sy >= 0 && sx < source.width && sy < source.height, i = (sy * source.width + sx) * 4;
      const bg = (((x >> 4) + (y >> 4)) & 1) ? 214 : 236;
      for (let j = 0; j < 3; j++) eyesOut[o + j] = inside && src[i + 3] ? src[i + j] : bg;
    }
  }));
  writeFileSync(join(REPO, 'shadow-preview-eyes.png'), encodeTruecolor({ width: EW, height: EH, rgba: eyesOut }, 'none'));
  console.log(`wrote shadow-preview-eyes.png (${spots.length} places)`);
}

function install(plan: Plan, planFile: string): void {
  const { source, result } = render(plan);
  const [dex, form] = plan.target.form.split('/').map(Number);
  const sourceFolder = folderOf(plan.source.form)!;
  let folder = folderOf(plan.target.form);
  const from = JSON.parse(readFileSync(join(sourceFolder, 'sheet.json'), 'utf8'));
  let meta: any;
  if (folder == null) {
    // A new form: the source's drawing and layout, under a number of its own
    const region = plan.target.region ?? from.region;
    folder = join(COMPACT, region, String(dex).padStart(4, '0'), String(form).padStart(4, '0'));
    mkdirSync(folder, { recursive: true });
    copyFileSync(join(sourceFolder, 'frames.bin'), join(folder, 'frames.bin'));
    meta = { ...from, form, formName: plan.target.name ?? null, region, coats: [], credits: {}, derived: [] };
  } else {
    meta = JSON.parse(readFileSync(join(folder, 'sheet.json'), 'utf8'));
    const layout = decode(readFileSync(join(folder, FILENAMES[meta.coats[0] as CoatKey])));
    if (layout.width !== source.width || layout.height !== source.height) {
      throw new Error(`${plan.target.form} is laid out ${layout.width}x${layout.height}, the source ${source.width}x${source.height}`);
    }
  }
  const coat = plan.target.coat;
  writeFileSync(join(folder, FILENAMES[coat]), encodeSmallest({ width: source.width, height: source.height, rgba: result }).bytes);
  // Whoever drew the source drawing is credited for it; the colours are ours
  meta.credits = { ...meta.credits, [coat]: from.credits[plan.source.coat] ?? [] };
  meta.coats = ['regular', 'shiny', 'female', 'shinyFemale'].filter((k) => k === coat || meta.coats.includes(k));
  meta.derived = [...(meta.derived ?? []).filter((d: any) => d.coat !== coat), { coat, anim: null, from: plan.source.coat }];
  writeFileSync(join(folder, 'sheet.json'), JSON.stringify(meta));
  updateIndex(COMPACT);
  const kept = join(COMPACT, 'edits', `${plan.target.form.split('/').map((n) => n.padStart(4, '0')).join('-')}-shadow-${coat}.json`);
  if (!existsSync(kept) || readFileSync(kept, 'utf8') !== readFileSync(planFile, 'utf8')) copyFileSync(planFile, kept);
  console.log(`wrote the ${coat} coat of ${plan.target.form}; plan kept as ${kept.slice(REPO.length + 1)}`);
}

function palette(form: string, coat: CoatKey): void {
  const img = sheetOf(form, coat);
  const count = new Map<string, number>(), touches = new Map<string, Map<string, number>>();
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4;
    if (!img.rgba[i + 3]) continue;
    const c = hexAt(img, i);
    count.set(c, (count.get(c) ?? 0) + 1);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= img.width || ny >= img.height) continue;
      const j = (ny * img.width + nx) * 4;
      if (!img.rgba[j + 3]) continue;
      const d = hexAt(img, j);
      if (d === c) continue;
      for (const [a, b] of [[c, d], [d, c]]) { const t = touches.get(a) ?? new Map(); t.set(b, (t.get(b) ?? 0) + 1); touches.set(a, t); }
    }
  }
  for (const [c, n] of [...count].sort((a, b) => b[1] - a[1])) {
    const [h, s, l] = toHsl(rgb(c));
    const t = [...(touches.get(c) ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k).join(' ');
    console.log(`${c}  h${String(Math.round(h)).padStart(3)} s${String(Math.round(s * 100)).padStart(3)} l${String(Math.round(l * 100)).padStart(3)}  x${String(n).padEnd(6)} touches ${t}`);
  }
}

const [command, a, b] = process.argv.slice(2);
if (command === 'palette') palette(a, (b ?? 'regular') as CoatKey);
else if (command === 'preview') preview(JSON.parse(readFileSync(a, 'utf8')));
else if (command === 'install') install(JSON.parse(readFileSync(a, 'utf8')), a);
else if (command != null) throw new Error(`no ${command} command: palette, preview or install`);
