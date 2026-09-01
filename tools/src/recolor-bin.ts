#!/usr/bin/env node
import main from './recolor-cli.ts';

process.exitCode = main(process.argv.slice(2));
