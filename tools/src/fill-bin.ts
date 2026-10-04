#!/usr/bin/env node
import { parseIndex } from './cli.ts';
import fillTree, { describe } from './fill.ts';

/**
 * `sprite-fill [species…] [--out <dir>] [--dry-run]`: polyfills sheets
 * already built, from the sheets themselves. With no species, every
 * sheet in the tree missing one of the animations polyfilling makes.
 */
const argv = process.argv.slice(2);
const species: number[] = [];
let output = 'compact';
let dryRun = false;

for (let at = 0; at < argv.length; at += 1) {
  if (argv[at] === '--out') {
    output = argv[++at] ?? output;
  } else if (argv[at] === '--dry-run') {
    dryRun = true;
  } else {
    species.push(...parseIndex(argv[at]));
  }
}
const filled = fillTree(output, { species: species.length > 0 ? species : undefined, dryRun });

for (const one of filled) {
  process.stdout.write(`${describe(one)}\n`);
}
process.stdout.write(`${filled.filter((one) => one.added.length > 0).length} sheets ${dryRun ? 'would be' : ''} filled\n`);
process.exitCode = filled.some((one) => one.mismatches.length > 0) ? 1 : 0;
