import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import decodePng, { encodeSmallest } from './png.ts';
import type { Color } from './png.ts';
import {
  colorsIn,
  hexOf,
  learn,
  paletteFor,
  readMapping,
  recolor,
  stripOf,
  swapsFromStrip,
  writeMapping,
} from './recolor.ts';
import type { SheetData } from './sheet.ts';
import type { CoatKey } from './slots.ts';
import { COATS } from './slots.ts';
import type { Index } from './write.ts';

/**
 * Recolouring a coat, from the command line.
 *
 * Three things, which are the three halves of the same job: take a
 * coat's palette out so somebody can change it, learn a mapping from a
 * pair of coats that already exist, and put a mapping back in as a coat
 * of its own.
 */

const USAGE = `sprite-recolor — swap the colours of a coat

  sprite-recolor extract <dex>/<form> [options]
  sprite-recolor learn   <dex>/<form> --from <coat> --to <coat> [options]
  sprite-recolor apply   <dex>/<form> --map <file> [options]

Options
  --out <dir>      where the compact tree is        (default compact)
  --coat <coat>    the coat to read      (extract, apply; default regular)
  --from <coat>    the coat a mapping is learned from
  --to <coat>      the coat it is learned against
  --as <coat>      the coat to write     (apply; default the one read)
  --file <path>    where to put or find the palette or mapping
  --dry-run        say what would happen, write nothing
  --help           this

A coat is regular, shiny, female or shinyFemale.

  extract  writes the coat's colours, one block each, as a palette strip
           PNG — or as JSON where --file ends in .json. Repaint the
           blocks, keeping their order and their number, and hand it
           back to apply.
  learn    reads two coats of one form and writes the mapping between
           them. They are the same drawing on the same layout, so a
           pixel of one stands over a pixel of the other.
  apply    puts a palette strip or a mapping into a coat and writes the
           result as another coat, adding it to the sheet's coat list.

Examples
  sprite-recolor extract 1/0 --file bulbasaur.png
  sprite-recolor apply 1/0 --map bulbasaur.png --as shiny
  sprite-recolor learn 3/0 --from regular --to shiny --file venusaur.json
  sprite-recolor apply 3/0 --coat female --map venusaur.json --as shinyFemale
`;

/** What each coat's drawing is called. */
const FILENAMES: Record<CoatKey, string> = {
  regular: 'regular.png',
  shiny: 'shiny.png',
  female: 'female.png',
  shinyFemale: 'shiny_female.png',
};

export interface Arguments {
  command: string;
  form: string;
  output: string;
  coat: CoatKey;
  from: CoatKey;
  to: CoatKey;
  as: CoatKey | null;
  file: string | null;
  dryRun: boolean;
  help: boolean;
}

/** A coat, named the way the sheet names it. */
export function coatOf(name: string): CoatKey {
  const held = COATS.find((coat) => coat.key.toLowerCase() === name.trim().toLowerCase());

  if (held == null) {
    throw new Error(`${name} is not a coat: try ${COATS.map((coat) => coat.key).join(', ')}`);
  }
  return held.key;
}

export function parseArguments(argv: string[]): Arguments {
  const parsed: Arguments = {
    command: '',
    form: '',
    output: 'compact',
    coat: 'regular',
    from: 'regular',
    to: 'shiny',
    as: null,
    file: null,
    dryRun: false,
    help: argv.length === 0,
  };
  const loose: string[] = [];

  for (let at = 0; at < argv.length; at += 1) {
    const argument = argv[at];

    switch (argument) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--out':
        parsed.output = argv[++at] ?? parsed.output;
        break;
      case '--coat':
        parsed.coat = coatOf(argv[++at] ?? '');
        break;
      case '--from':
        parsed.from = coatOf(argv[++at] ?? '');
        break;
      case '--to':
        parsed.to = coatOf(argv[++at] ?? '');
        break;
      case '--as':
        parsed.as = coatOf(argv[++at] ?? '');
        break;
      case '--file':
      case '--map':
        parsed.file = argv[++at] ?? null;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      default:
        if (argument.startsWith('-')) {
          throw new Error(`There is no ${argument} option`);
        }
        loose.push(argument);
    }
  }
  parsed.command = loose[0] ?? '';
  parsed.form = loose[1] ?? '';
  return parsed;
}

/** A species and a form, however they were written. */
export function parseForm(argument: string): { dex: number; form: number } {
  const parts = argument.trim().split('/').filter((part) => part.length > 0);
  const numbers = parts.filter((part) => /^[0-9]+$/.test(part)).map((part) => Number.parseInt(part, 10));

  if (numbers.length === 0) {
    throw new Error(`${argument} does not name a species and a form, such as 1/0`);
  }
  return { dex: numbers[0], form: numbers[1] ?? 0 };
}

/** Where one form's sheets are, out of the index that lists them. */
export function folderOf(output: string, dex: number, form: number): string {
  const path = join(output, 'index.json');

  if (!existsSync(path)) {
    throw new Error(`${path} is not there: build the tree before recolouring it`);
  }
  const index = JSON.parse(readFileSync(path, 'utf8')) as Index;
  const held = index.slots.find((slot) => slot.dex === dex && slot.form === form);

  if (held == null) {
    throw new Error(`The tree holds no form ${dex}/${form}`);
  }
  return join(output, held.path);
}

/** One coat's sheet, decoded. */
function coatImage(folder: string, coat: CoatKey) {
  const path = join(folder, FILENAMES[coat]);

  if (!existsSync(path)) {
    throw new Error(`There is no ${coat} coat at ${path}`);
  }
  return decodePng(readFileSync(path));
}

/**
 * Adds a coat to the description, in the order the coats are filed.
 *
 * The index carries the same list, so it is written too — a reader that
 * trusts the index would otherwise never look for the new coat.
 */
function addCoat(
  output: string,
  folder: string,
  dex: number,
  form: number,
  coat: CoatKey,
  from: CoatKey,
): SheetData {
  const path = join(folder, 'sheet.json');
  const meta = JSON.parse(readFileSync(path, 'utf8')) as SheetData;

  if (!meta.coats.includes(coat)) {
    meta.coats = COATS.map((one) => one.key).filter(
      (one) => one === coat || meta.coats.includes(one),
    );
  }
  meta.derived = [
    ...(meta.derived ?? []).filter((one) => !(one.coat === coat && one.anim == null)),
    { coat, anim: null, from },
  ];
  writeFileSync(path, JSON.stringify(meta));

  const listing = join(output, 'index.json');
  const index = JSON.parse(readFileSync(listing, 'utf8')) as Index;
  const slot = index.slots.find((one) => one.dex === dex && one.form === form);

  if (slot != null) {
    slot.coats = [...meta.coats];
    slot.derived = [...meta.derived];
    writeFileSync(listing, JSON.stringify(index));
  }
  return meta;
}

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** A few colours, for a message that should not run to a screenful. */
function some(colors: Color[]): string {
  return colors.length <= 6
    ? colors.map(hexOf).join(' ')
    : `${colors.slice(0, 6).map(hexOf).join(' ')} and ${colors.length - 6} more`;
}

export default function main(argv: string[]): number {
  const options = parseArguments(argv);

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const output = resolve(options.output);
  const { dex, form } = parseForm(options.form);
  const folder = folderOf(output, dex, form);

  if (options.command === 'extract') {
    const colors = paletteFor(coatImage(folder, options.coat));
    const file = options.file ?? `${dex}-${form}-${options.coat}.png`;

    say(`${colors.length} colours in the ${options.coat} coat of ${dex}/${form}`);
    if (options.dryRun) {
      say(some(colors));
      return 0;
    }
    writeFileSync(
      file,
      file.endsWith('.json')
        ? writeMapping(
            colors.filter((color) => color[3] !== 0).map((color) => ({ from: color, to: color })),
            options.coat,
          )
        : stripOf(colors),
    );
    say(`written to ${file}`);
    return 0;
  }

  if (options.command === 'learn') {
    const held = learn(coatImage(folder, options.from), coatImage(folder, options.to));
    const file = options.file ?? `${dex}-${form}-${options.from}-${options.to}.json`;

    say(
      `${held.swaps.length} colours map from ${options.from} to ${options.to} in ${dex}/${form}`,
    );
    for (const one of held.ambiguous) {
      say(`  ${hexOf(one.from)} stands over ${some(one.to)} — left out`);
    }
    if (options.dryRun) {
      return held.ambiguous.length > 0 ? 1 : 0;
    }
    writeFileSync(file, writeMapping(held.swaps, options.from));
    say(`written to ${file}`);
    return held.ambiguous.length > 0 ? 1 : 0;
  }

  if (options.command === 'apply') {
    if (options.file == null) {
      throw new Error('apply needs a --map to put in');
    }
    const image = coatImage(folder, options.coat);
    const swaps = options.file.endsWith('.json')
      ? readMapping(readFileSync(options.file, 'utf8'))
      : swapsFromStrip(paletteFor(image), colorsIn(readFileSync(options.file)));
    const held = recolor(image, swaps);
    const as = options.as ?? options.coat;

    say(
      `${swaps.length} swaps changed ${held.changed} pixels of the ${options.coat} coat of ${dex}/${form}`,
    );
    if (held.untouched.length > 0) {
      say(`  ${held.untouched.length} colours no swap named: ${some(held.untouched)}`);
    }
    if (options.dryRun) {
      return 0;
    }
    const encoded = encodeSmallest(held.image);

    writeFileSync(join(folder, FILENAMES[as]), encoded.bytes);
    const meta = addCoat(output, folder, dex, form, as, options.coat);

    say(`written as the ${as} coat, ${encoded.as}, ${encoded.bytes.length} bytes`);
    say(`the sheet now has ${meta.coats.join(', ')}`);
    return 0;
  }

  process.stderr.write(`There is no ${options.command} command\n\n${USAGE}`);
  return 1;
}
