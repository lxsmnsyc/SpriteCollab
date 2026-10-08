/**
 * Shiny sprites: a coat split into parts along its outlines, each part
 * flattened to one colour, that colour swapped for the shiny's, and the
 * coat's own shading laid back over it.
 *
 *   node .claude/skills/shiny-sprites/shiny.ts palette 916/0
 *   node .claude/skills/shiny-sprites/shiny.ts preview plan.json
 *   node .claude/skills/shiny-sprites/shiny.ts install plan.json
 *
 * Telling parts apart by colour alone fails where an artist drew two parts
 * in one colour (a head in the body's shadow tones). Parts are told apart
 * by where a pixel sits instead: inside the outlines, a shared colour
 * belongs to the part of the nearest colour only one part uses. See SKILL.md.
 */
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import decode, { encodeSmallest, encodeTruecolor } from '../../../tools/src/png.ts';
import type { Image } from '../../../tools/src/png.ts';
import type { CoatKey } from '../../../tools/src/slots.ts';
import { FILENAMES, updateIndex } from '../../../tools/src/write.ts';

const REPO = join(import.meta.dirname, '../../..');
const COMPACT = join(REPO, 'compact');

interface Part {
  part: string;
  /** Every colour the part is drawn in, light and shade alike. */
  members: string[];
  /** The part's flat colour, the one its shading is measured from. */
  base: string;
  /** The shiny's flat colour for the part. */
  to: string;
  /**
   * For a part drawn wholly in colours another part shares, so no colour
   * marks it (a head in the body's shadow tones): it starts from its
   * colours within `reach` pixels of a `near` colour (the snout), and takes
   * those of its colours joined to them, up to `spread` pixels out. Parts
   * with a seed claim their pixels before any other part grows.
   */
  seed?: { near: string[]; reach: number; spread?: number };
  /**
   * How much of the old shading's depth to keep, 1 unless given. A dark
   * part turning light keeps its shades too deep at 1: its shadows are
   * nearly black, which on a pale part reads as a hole.
   */
  contrast?: number;
}
interface Plan {
  /** The form, as `dex/form`. */
  form: string;
  /** The coat the pixels come from, `regular` unless given. */
  from?: CoatKey;
  /** The coat written, `shiny` unless given. */
  to?: CoatKey;
  /** Colours that are lines, not parts: parts do not reach across them. Black always is. */
  outline?: string[];
  /**
   * Listed first wins: a patch walled in by outlines and drawn only in
   * colours several parts share goes to the first part that has them all.
   */
  parts: Part[];
  /** Pixels whose part is known, as [x, y, part]: they lead the parts around them. */
  pixels?: [number, number, string][];
  /** Hand adjustments, `from` colour to `to`, applied after everything else. */
  override?: Record<string, string>;
}

const rgb = (h: string) => [1, 3, 5].map((o) => parseInt(h.slice(o, o + 2), 16));
// Colours are kept on the 18-bit grid the collection is drawn on
const snap = (v: number) => {
  const s = Math.round((Math.max(0, Math.min(255, v)) / 255) * 63);
  return (s << 2) | (s >> 4);
};
const toHex = (c: number[]) => '#' + c.map((v) => snap(v).toString(16).padStart(2, '0')).join('');
const hexAt = (img: Image, i: number) => '#' + [0, 1, 2].map((j) => img.rgba[i + j].toString(16).padStart(2, '0')).join('');
function toHsl([r, g, b]: number[]): number[] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}
function fromHsl([h, s, l]: number[]): number[] {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function sheetFolder(form: string): string {
  const [dex, n] = form.split('/').map(Number);
  const index = JSON.parse(readFileSync(join(COMPACT, 'index.json'), 'utf8'));
  const slot = index.slots.find((s: any) => s.dex === dex && s.form === n);
  if (slot == null) throw new Error(`${form} is not built`);
  return join(COMPACT, slot.path);
}

/**
 * A colour of a part, laid over the shiny's flat colour: its lightness
 * spread between black, the new flat colour and white as it sat between
 * black, the old flat colour and white; its hue and saturation moved the
 * way they stood from the old flat colour.
 */
export function shade(part: Part, colour: string): string {
  const [bh, bs, bl] = toHsl(rgb(part.base)), [th, ts, tl] = toHsl(rgb(part.to)), [h, s, l] = toHsl(rgb(colour));
  if (colour === part.base) return toHex(rgb(part.to));
  const fitted = l <= bl ? (bl === 0 ? tl : (l / bl) * tl) : bl === 1 ? tl : tl + ((l - bl) * (1 - tl)) / (1 - bl);
  const lightness = tl + (fitted - tl) * (part.contrast ?? 1);
  // A grey part has no hue to move from, so its shades take the new one as is
  const grey = bs < 0.06 || s < 0.06;
  // Saturation follows the old shades only loosely, or a dark shade of a
  // muted colour turns glaring once lifted onto a light one
  return toHex(fromHsl([grey ? th : th + (h - bh), grey ? ts : ts * Math.max(0.7, Math.min(1.2, s / bs)), lightness]));
}

/** Which part each pixel belongs to, by index into `plan.parts`; -1 for outlines and colours in no part. */
export function partsOf(img: Image, plan: Plan): Int16Array {
  const W = img.width, N = W * img.height;
  const outline = new Set(['#000000', ...(plan.outline ?? [])]);
  const owners = new Map<string, number[]>();
  plan.parts.forEach((p, k) => p.members.forEach((m) => owners.set(m, [...(owners.get(m) ?? []), k])));
  const label = new Int16Array(N).fill(-1);
  const colour: (string | null)[] = new Array(N);
  for (let p = 0; p < N; p++) colour[p] = img.rgba[p * 4 + 3] ? hexAt(img, p * 4) : null;
  const open = (p: number) => colour[p] != null && !outline.has(colour[p]!) && owners.has(colour[p]!);
  const neighbours = (p: number) => {
    const x = p % W, out: number[] = [];
    if (x > 0) out.push(p - 1);
    if (x < W - 1) out.push(p + 1);
    if (p >= W) out.push(p - W);
    if (p < N - W) out.push(p + W);
    return out;
  };
  // Seeds: colours one part alone uses, and pixels named by hand
  const queue: number[] = [];
  for (let p = 0; p < N; p++) {
    const own = open(p) ? owners.get(colour[p]!)! : null;
    if (own?.length === 1) { label[p] = own[0]; queue.push(p); }
  }
  plan.parts.forEach((part, k) => {
    if (part.seed == null) return;
    const near = new Set(part.seed.near), r = part.seed.reach, mine = new Set(part.members);
    const step = new Map<number, number>(), front: number[] = [];
    for (let p = 0; p < N; p++) {
      if (label[p] >= 0 || !open(p) || !mine.has(colour[p]!)) continue;
      const x = p % W, y = (p / W) | 0;
      let close = false;
      for (let dy = -r; dy <= r && !close; dy++) for (let dx = -r; dx <= r && !close; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < N / W && near.has(colour[ny * W + nx] ?? '')) close = true;
      }
      if (close) { label[p] = k; step.set(p, 0); front.push(p); }
    }
    for (let head = 0; head < front.length; head++) {
      const p = front[head], d = step.get(p)!;
      if (part.seed.spread != null && d >= part.seed.spread) continue;
      for (const n of neighbours(p)) {
        if (label[n] >= 0 || !open(n) || !mine.has(colour[n]!)) continue;
        label[n] = k; step.set(n, d + 1); front.push(n);
      }
    }
    // Claimed, so not grown from again: another part's pixels border them
  });
  for (const [x, y, name] of plan.pixels ?? []) {
    const k = plan.parts.findIndex((p) => p.part === name), p = y * W + x;
    if (k < 0) throw new Error(`no part ${name}`);
    if (label[p] < 0) queue.push(p);
    label[p] = k;
  }
  // Shared colours take the part that reaches them first, never across an outline
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    for (const n of neighbours(p)) {
      if (label[n] >= 0 || !open(n) || !owners.get(colour[n]!)!.includes(label[p])) continue;
      label[n] = label[p];
      queue.push(n);
    }
  }
  // What no seed reached is a patch walled in by outlines and drawn only in
  // shared colours: it goes to the first part listed that has them all
  for (let p = 0; p < N; p++) {
    if (label[p] >= 0 || !open(p)) continue;
    const patch = [p], seen = new Set([p]);
    for (let i = 0; i < patch.length; i++) for (const n of neighbours(patch[i])) {
      if (!seen.has(n) && label[n] < 0 && open(n)) { seen.add(n); patch.push(n); }
    }
    const used = new Set(patch.map((q) => colour[q]!));
    const k = plan.parts.findIndex((part) => [...used].every((c) => part.members.includes(c)));
    for (const q of patch) label[q] = k;
  }
  return label;
}

export function render(plan: Plan): { source: Image; flat: Buffer; result: Buffer; label: Int16Array } {
  const source = decode(readFileSync(join(sheetFolder(plan.form), FILENAMES[plan.from ?? 'regular'])));
  const label = partsOf(source, plan);
  const override = new Map(Object.entries(plan.override ?? {}));
  const flat = Buffer.from(source.rgba), result = Buffer.from(source.rgba);
  const cache = new Map<string, string>();
  for (let p = 0; p < source.width * source.height; p++) {
    const i = p * 4, k = label[p];
    if (k < 0) continue;
    const part = plan.parts[k], own = hexAt(source, i), key = `${k}${own}`;
    rgb(part.base).forEach((v, j) => (flat[i + j] = v));
    if (!cache.has(key)) cache.set(key, override.get(own) ?? shade(part, own));
    rgb(cache.get(key)!).forEach((v, j) => (result[i + j] = v));
  }
  return { source, flat, result, label };
}

/** Regular, its flat parts and the shiny, side by side, scaled. */
function preview(plan: Plan): void {
  const { source, flat, result, label } = render(plan);
  plan.parts.forEach((part, k) => {
    const n = label.filter((l) => l === k).length;
    console.log(`  ${part.part.padEnd(10)} ${part.base} -> ${part.to}  ${n} px`);
  });
  const S = Number(process.env.SCALE ?? 2), gap = 6, W = (source.width * 3 + gap * 2) * S, H = source.height * S;
  const out = Buffer.alloc(W * H * 4, 255);
  [source.rgba, flat, result].forEach((src, panel) => {
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4, bg = [72, 84, 96];
      const c = src[i + 3] ? [src[i], src[i + 1], src[i + 2]] : bg;
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
        const o = ((y * S + dy) * W + (panel * (source.width + gap) + x) * S + dx) * 4;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
      }
    }
  });
  writeFileSync(join(REPO, 'shiny-preview.png'), encodeTruecolor({ width: W, height: H, rgba: out }, 'none'));
  console.log('wrote shiny-preview.png: regular, flat parts, shiny');
}

function install(plan: Plan, planFile: string): void {
  const { source, result } = render(plan);
  const folder = sheetFolder(plan.form), from = plan.from ?? 'regular', coat = plan.to ?? 'shiny';
  const meta = JSON.parse(readFileSync(join(folder, 'sheet.json'), 'utf8'));
  writeFileSync(join(folder, FILENAMES[coat]), encodeSmallest({ width: source.width, height: source.height, rgba: result }).bytes);
  // Whoever drew the coat is credited for it; the colours are ours
  meta.credits = { ...meta.credits, [coat]: meta.credits[from] ?? [] };
  meta.coats = ['regular', 'shiny', 'female', 'shinyFemale'].filter((k) => k === coat || meta.coats.includes(k));
  const entry = { coat, anim: null, from };
  const derived = meta.derived ?? [];
  const at = derived.findIndex((d: any) => d.coat === coat);
  meta.derived = at < 0 ? [...derived, entry] : derived.map((d: any, i: number) => (i === at ? entry : d));
  writeFileSync(join(folder, 'sheet.json'), JSON.stringify(meta));
  updateIndex(COMPACT);
  const kept = join(COMPACT, 'edits', `${plan.form.split('/').map((n) => n.padStart(4, '0')).join('-')}-${from}-${coat}.json`);
  if (!existsSync(kept) || readFileSync(kept, 'utf8') !== readFileSync(planFile, 'utf8')) copyFileSync(planFile, kept);
  console.log(`wrote the ${coat} coat of ${plan.form}; plan kept as ${kept.slice(REPO.length + 1)}`);
}

/** Every colour of a coat, how much of it there is, and what it touches. */
function palette(form: string, coat: CoatKey): void {
  const img = decode(readFileSync(join(sheetFolder(form), FILENAMES[coat])));
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

const [command, a, b] = import.meta.main ? process.argv.slice(2) : [];
if (command === 'palette') palette(a, (b ?? 'regular') as CoatKey);
else if (command === 'preview') preview(JSON.parse(readFileSync(a, 'utf8')));
else if (command === 'install') install(JSON.parse(readFileSync(a, 'utf8')), a);
else if (command != null) throw new Error(`no ${command} command: palette, preview or install`);
