#!/usr/bin/env node
import { Command } from 'commander';
import { quickstart } from './commands/quickstart.js';

const program = new Command();

program.name('syntaro').description('SYNTARO CLI').version('0.1.0');

program
  .command('quickstart')
  .description('Interactive setup: install SYNTARO, label a test issue, and get your first fix')
  .option('-y, --yes', 'Skip prompts and use defaults')
  .action(async (options) => {
    await quickstart({ skipPrompts: options.yes ?? false });
  });

program.parse(process.argv);
