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
  .option('--format <format>', 'output format: table | json', 'table')
  .option('--similarity <n>', 'near-duplicate threshold, 0..1', '0.85')
  .option('--no-gitignore', 'do not respect .gitignore files under the target')
  .action(
    async (
      target: string,
      options: { format: string; similarity: string; gitignore: boolean },
    ) => {
      if (options.format !== 'table' && options.format !== 'json') {
        console.error(`promptscan: unsupported --format '${options.format}' (supported: table, json)`);
        process.exitCode = 2;
        return;
      }

      const threshold = Number(options.similarity);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        console.error(`promptscan: --similarity must be a number in 0..1 (got '${options.similarity}')`);
        process.exitCode = 2;
        return;
      }

      try {
        const report = await scan(target, { gitignore: options.gitignore, threshold });
        if (options.format === 'json') {
          process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        } else {
          process.stdout.write(renderScanSummary(report));
        }
      } catch (err) {
        console.error(`promptscan: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    },
  );

program.parseAsync(process.argv);
