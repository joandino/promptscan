#!/usr/bin/env node
import { Command } from 'commander';
import { scan, type ScanOptions } from './index.js';
import { renderScanSummary } from './report/render.js';
import { loadVolumeConfig } from './pricing/volume.js';
import { loadConfig, type PromptScanConfig } from './config/config.js';
import { runDiff } from './diff/run.js';
import { renderDiffTable, renderDiffMarkdown } from './diff/render.js';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('promptscan')
  .description('Static analysis for LLM call sites. Find what your prompts cost before you ship them.')
  .version(VERSION, '-v, --version');

function parseThreshold(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function explicit(command: Command, name: string): boolean {
  return command.getOptionValueSource(name) === 'cli';
}

/**
 * Merge config-file values with CLI flags into scan options.
 * Precedence: explicit CLI flag > config file > built-in default (left unset).
 */
function buildScanOptions(
  command: Command,
  options: { similarity: string; gitignore: boolean },
  config: PromptScanConfig,
): ScanOptions {
  const opts: ScanOptions = {};

  if (explicit(command, 'gitignore')) opts.gitignore = options.gitignore;
  else if (config.gitignore !== undefined) opts.gitignore = config.gitignore;

  if (explicit(command, 'similarity')) opts.threshold = Number(options.similarity);
  else if (config.duplicates?.similarity !== undefined) opts.threshold = config.duplicates.similarity;

  if (config.duplicates?.minWords !== undefined) opts.minWords = config.duplicates.minWords;
  if (config.bloat) Object.assign(opts, config.bloat);

  return opts;
}

program
  .command('scan', { isDefault: true })
  .description('scan a file or directory for LLM call sites')
  .argument('<path>', 'file or directory to scan')
  .option('--format <format>', 'output format: table | json', 'table')
  .option('--similarity <n>', 'near-duplicate threshold, 0..1 (overrides config)', '0.85')
  .option('--volume-config <file>', 'YAML/JSON call-volume estimate for monthly cost projection')
  .option('--config <file>', 'path to a promptscan config file (else auto-discovered)')
  .option('--no-gitignore', 'do not respect .gitignore files under the target')
  .action(
    async (
      target: string,
      options: { format: string; similarity: string; volumeConfig?: string; config?: string; gitignore: boolean },
      command: Command,
    ) => {
      if (options.format !== 'table' && options.format !== 'json') {
        console.error(`promptscan: unsupported --format '${options.format}' (supported: table, json)`);
        process.exitCode = 2;
        return;
      }
      if (explicit(command, 'similarity') && parseThreshold(options.similarity) === null) {
        console.error(`promptscan: --similarity must be a number in 0..1 (got '${options.similarity}')`);
        process.exitCode = 2;
        return;
      }

      let config: PromptScanConfig;
      let configPath: string | null;
      try {
        ({ config, path: configPath } = loadConfig(options.config));
      } catch (err) {
        console.error(`promptscan: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 2;
        return;
      }

      const scanOptions = buildScanOptions(command, options, config);
      try {
        scanOptions.volume = options.volumeConfig ? loadVolumeConfig(options.volumeConfig) : config.volume;
      } catch (err) {
        console.error(`promptscan: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 2;
        return;
      }

      try {
        const report = await scan(target, scanOptions);
        if (configPath && options.format === 'table') {
          console.error(`promptscan: using config ${configPath}`);
        }
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

program
  .command('diff')
  .description('compare two git refs and report the change in tokens and cost')
  .argument('<base>', 'base git ref (e.g. main)')
  .argument('<head>', 'head git ref (e.g. HEAD)')
  .argument('[path]', 'path to scan within the repo', '.')
  .option('--format <format>', 'output format: table | json | markdown', 'table')
  .option('--similarity <n>', 'near-duplicate threshold, 0..1 (overrides config)', '0.85')
  .option('--fail-on-increase <pct>', 'exit non-zero if the metric increases by more than this percent')
  .option('--metric <metric>', 'metric for --fail-on-increase: tokens | cost', 'tokens')
  .option('--config <file>', 'path to a promptscan config file (else auto-discovered)')
  .option('--no-gitignore', 'do not respect .gitignore files under the target')
  .action(
    async (
      baseRef: string,
      headRef: string,
      targetPath: string,
      options: {
        format: string;
        similarity: string;
        failOnIncrease?: string;
        metric: string;
        config?: string;
        gitignore: boolean;
      },
      command: Command,
    ) => {
      if (!['table', 'json', 'markdown'].includes(options.format)) {
        console.error(`promptscan: unsupported --format '${options.format}' (supported: table, json, markdown)`);
        process.exitCode = 2;
        return;
      }
      if (explicit(command, 'similarity') && parseThreshold(options.similarity) === null) {
        console.error(`promptscan: --similarity must be a number in 0..1 (got '${options.similarity}')`);
        process.exitCode = 2;
        return;
      }
      if (options.metric !== 'tokens' && options.metric !== 'cost') {
        console.error(`promptscan: --metric must be 'tokens' or 'cost' (got '${options.metric}')`);
        process.exitCode = 2;
        return;
      }
      let failOnIncreasePct: number | undefined;
      if (options.failOnIncrease !== undefined) {
        const pct = Number(String(options.failOnIncrease).replace(/%$/, ''));
        if (!Number.isFinite(pct) || pct < 0) {
          console.error(`promptscan: --fail-on-increase must be a non-negative percent (got '${options.failOnIncrease}')`);
          process.exitCode = 2;
          return;
        }
        failOnIncreasePct = pct;
      }

      let config: PromptScanConfig;
      try {
        ({ config } = loadConfig(options.config));
      } catch (err) {
        console.error(`promptscan: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 2;
        return;
      }
      const scanOptions = buildScanOptions(command, options, config);

      try {
        const { diff, failed } = await runDiff(baseRef, headRef, targetPath, process.cwd(), {
          threshold: scanOptions.threshold,
          scan: scanOptions,
          failOnIncreasePct,
          metric: options.metric,
        });

        if (options.format === 'json') {
          process.stdout.write(JSON.stringify(diff, null, 2) + '\n');
        } else if (options.format === 'markdown') {
          process.stdout.write(renderDiffMarkdown(diff));
        } else {
          process.stdout.write(renderDiffTable(diff));
        }

        if (failed) {
          const p = options.metric === 'cost' ? diff.totals.costPct : diff.totals.tokenPct;
          console.error(
            `promptscan: ${options.metric} increased ${p?.toFixed(1)}% (> ${failOnIncreasePct}% threshold)`,
          );
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(`promptscan: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    },
  );

program.parseAsync(process.argv);
