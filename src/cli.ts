#!/usr/bin/env node
import { Command } from 'commander';
import { scan } from './index.js';
import { renderScanSummary } from './report/render.js';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('promptscan')
  .description('Static analysis for LLM call sites. Find what your prompts cost before you ship them.')
  .version(VERSION, '-v, --version');

program
  .argument('<path>', 'file or directory to scan')
  .option('--format <format>', 'output format: table', 'table')
  .option('--no-gitignore', 'do not respect .gitignore files under the target')
  .action(async (target: string, options: { format: string; gitignore: boolean }) => {
    if (options.format !== 'table') {
      console.error(`promptscan: unsupported --format '${options.format}' (v0.1 supports: table)`);
      process.exitCode = 2;
      return;
    }

    try {
      const report = await scan(target, { gitignore: options.gitignore });
      process.stdout.write(renderScanSummary(report));
    } catch (err) {
      console.error(`promptscan: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
