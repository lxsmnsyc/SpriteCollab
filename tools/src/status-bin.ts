#!/usr/bin/env node
import main from './status-cli.ts';

process.exitCode = main(process.argv.slice(2));
