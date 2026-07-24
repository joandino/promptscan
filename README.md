# PromptScan

[![npm](https://img.shields.io/npm/v/promptscan)](https://www.npmjs.com/package/promptscan) [![CI](https://github.com/joandino/promptscan/actions/workflows/ci.yml/badge.svg)](https://github.com/joandino/promptscan/actions/workflows/ci.yml)

Find out what your LLM prompts cost before you ship them.

<p align="center">
  <img src="https://raw.githubusercontent.com/joandino/promptscan/main/assets/demo.gif" alt="PromptScan scanning a project: call sites with token counts and cost, duplicate prompts, a near-duplicate pair, and a dead prompt constant" width="820">
</p>

<p align="center">
  <b><a href="https://joandino.github.io/promptscan/">Try it in your browser →</a></b> &nbsp;·&nbsp; paste a snippet, see the cost — no install, nothing uploaded
</p>

PromptScan is a command-line tool that reads your codebase, finds every call to an LLM API, and reports the token count and dollar cost of each prompt. Along the way it points out duplicated prompts, prompt constants that nothing references anymore, and context blocks that have quietly grown too large.

It works by static analysis, so there's nothing to instrument and no API key to set up. Run it locally, or drop it into CI to comment on a pull request. The catch is that it only sees what the source makes knowable: when a prompt is assembled at runtime from a database or a request parameter, PromptScan marks it unresolved instead of guessing.

It supports Python, TypeScript, and JavaScript, and understands the OpenAI, Anthropic, and LangChain SDKs. Requires Node 18+.

## Why not just use LangSmith / Langfuse / Helicone?

Those are runtime tools. They tell you what your calls did in production, which is useful, but they can't tell you anything about a prompt until it actually runs, and they can't see the prompt whose caller you deleted six months ago. PromptScan runs on the repo, so it catches things before they ship and costs nothing to run.

## Install

```bash
npm install -g promptscan
promptscan ./src
```

Or run it without installing anything:

```bash
npx promptscan ./src
```

## Quick start

```bash
promptscan ./src                          # summary table (the default)
promptscan ./src --format json            # full structured report
promptscan ./src --volume-config vol.yaml # add a projected monthly bill
promptscan diff main HEAD ./src           # what changed between two commits
```

A run against a small example:

```
PromptScan v1.0.0  (phase: cost)

  Scanned:  ./src
  Files:    4 source files
  Parsed:   4 clean, 0 partial (recoverable), 0 unreadable

  Call sites: 4 (openai 4, anthropic 0)
  Models:     4 resolved, 0 unresolved
  Prompts:    4 resolved, 0 partial, 0 unresolved
  Input tok:  165 (estimate, input only — output tokens are not statically knowable)
  Input cost: $0.00041/scan (estimate, input only; pricing 2026.07, as of 2026-07-21)

  ┌──────────────┬──────────┬────────┬───────────┬──────────┬────────────┐
  │ Location     │ Provider │ Model  │ Input tok │  Input $ │ Confidence │
  ├──────────────┼──────────┼────────┼───────────┼──────────┼────────────┤
  │ agent_a.py:4 │ openai   │ gpt-4o │        48 │ $0.00012 │ high       │
  │ agent_b.py:4 │ openai   │ gpt-4o │        48 │ $0.00012 │ high       │
  │ agent_c.py:4 │ openai   │ gpt-4o │        48 │ $0.00012 │ high       │
  │ unique.py:3  │ openai   │ gpt-4o │        21 │ $0.00005 │ high       │
  └──────────────┴──────────┴────────┴───────────┴──────────┴────────────┘

  Duplicates: 1 exact group, 1 near-dup pair (≥0.85)
              ~48 input tokens in repeated prompt copies

  exact ×2 (48 tok each): "You are a meticulous senior support engineer at Acme Co…"
      agent_a.py:4
      agent_b.py:4

  near-duplicates:
      0.94  agent_a.py:4  ~  agent_c.py:4
```

The markers in the token/cost columns mean: `~` the number is approximate (Anthropic has no public tokenizer, so it uses a calibrated proxy), `+` a partial prompt where only the static part could be counted, and `—` a prompt that couldn't be resolved at all.

## What it reports

### Finding the calls

PromptScan parses each file with tree-sitter and looks for the call shapes below.

| Provider / framework | What it matches |
|---|---|
| OpenAI | `chat.completions.create` / `.parse` / `.stream`, `responses.create` / `.parse` / `.stream` |
| Anthropic | `messages.create` / `.stream` |
| LangChain | `ChatOpenAI` / `ChatAnthropic` / `AzureChatOpenAI`, invoked with `.invoke` / `.stream` / `.batch` |
| litellm (Python) | `litellm.completion` / `.acompletion`, and `from litellm import completion`; the provider is read from the `model=` string |
| Vercel AI SDK (TS/JS) | `generateText` / `streamText` / `generateObject` / `streamObject` from `ai`; the provider and model come from the `@ai-sdk/*` factory (`openai("gpt-4o")`) |

Matching on the method name alone isn't enough, because `client.messages.create(...)` is also Twilio's SMS API. So a match has to be backed up by something: an SDK import in the file (`import openai`, `import { Anthropic } from "@anthropic-ai/sdk"`, `require("openai")`), or a variable bound to a client constructor (`client = openai.OpenAI()`, `new OpenAI()`). Long chains like `chat.completions.create` are distinctive enough to stand on their own; the short, ambiguous ones need the corroboration or they're dropped. When a call is only reported at medium confidence, the table says why.

LangChain works differently, because there the model and provider come from the constructor (`ChatOpenAI(model="gpt-4o")`) and the actual call is a generic `.invoke()` later on. PromptScan tracks the binding, including through a chain (`chain = prompt | model` in Python, `prompt.pipe(model)` in JS), and only treats `.invoke` as a call site when its receiver is a known model. A string passed straight to `invoke(...)` resolves; a prompt sitting in a `ChatPromptTemplate` is reported as unresolved.

litellm is a router: one `completion(...)` call reaches many providers, and the target is encoded in the `model=` string. PromptScan reads the provider from there — `gpt-4o` and `openai/gpt-4o` are OpenAI, `claude-…` (including Claude hosted behind Bedrock or Vertex) is Anthropic — and tokenizes and prices those normally. A model routed to a backend it can't natively tokenize (`gemini/…`, `cohere/…`) is still reported, as provider `other`, with a rough `cl100k` proxy count and no price rather than a guess. Detection is gated on a litellm import, including the common lazy re-export (`from app.llm import litellm`).

The Vercel AI SDK works the same way in TypeScript: `generateText`/`streamText`/`generateObject`/`streamObject` are called with a `model` produced by a provider factory (`openai("gpt-4o")`, `anthropic("claude-…")`). PromptScan reads the provider and model from that factory — including a `createOpenAI(...)` custom instance or a `const model = openai(...)` bound to a variable — and resolves the `system`, `prompt`, and `messages` arguments. A model from a factory it can't tokenize (`google`, `mistral`, …) is reported as `other`. Detection is gated on the entrypoint being imported from `ai`.

### Resolving the prompt text

Once it has a call site, PromptScan follows the prompt argument back to where the text comes from:

- string literals and `+` / adjacent concatenation resolve directly
- module constants and single-assignment variables resolve through a symbol table
- a constant imported from another file in the scan — `from prompts import SYSTEM_PROMPT`, `import prompts; prompts.SYSTEM`, or `import { SYSTEM } from "./prompts"` — is followed across files to its definition, including through a re-export chain
- an instance attribute assigned once in a class (`self.system = SUPPORT_PROMPT` in `__init__`, then `content=self.system`) resolves against the enclosing class; an attribute assigned more than once is left unresolved
- a `**kwargs` dict spread — `params = {"model": …, "messages": […]}; create(**params)` — is followed into the dict for both the model and the prompt
- the `model=` argument goes through the same machinery, so a module constant, a `self.model`, or a cross-file import resolves instead of being dropped (an f-string model stays unresolved)
- f-strings (Python) and template literals (JS/TS) resolve partially: the static text is kept and the interpolations are flagged
- static file reads like `open("p.txt").read()`, `Path("p.md").read_text()`, and `readFileSync("p.txt")` are resolved by reading the file
- anything else (a function parameter, a reassigned variable, a value from a DB call) is reported as unresolved, with a short reason

The unresolved and partial counts are shown up front, not buried, and each unresolved prompt is listed with its reason. If a report quietly skipped half your prompts it wouldn't be worth much.

### Tokens and cost

Resolved prompts are tokenized and reported as input tokens, including the small per-message overhead that OpenAI documents. OpenAI uses `js-tiktoken` with the right encoding for the model.

Anthropic doesn't publish a tokenizer — the `@anthropic-ai/tokenizer` package on npm is the Claude 1/2 vocabulary and hasn't been released since 2023 — so those counts use a `cl100k` proxy, calibrated per tokenizer family. Claude Opus 4.7 introduced a tokenizer that produces materially more tokens for the same text, and it's what Opus 4.7/4.8, Sonnet 5, Fable 5, and Mythos use; Opus 4.6 and earlier, the Sonnet 4.x line, and the Haiku line use the previous one. Left uncorrected, a proxy count on a newer-tokenizer model runs about 30% low, and since cost is proportional to tokens, so does the price.

The correction factors were measured against Anthropic's `/v1/messages/count_tokens` endpoint on 2026-07-23, calibrated end to end: nine full prompts per family, spanning instructions, few-shot blocks, JSON schemas, code, policy prose, and multi-turn dialogue, comparing PromptScan's complete estimate against the real count.

| Tokenizer family | Correction | Aggregate error after | Mean absolute error |
| --- | --- | --- | --- |
| previous | none | −1.0% | 4.0% |
| newer | ×1.43 | +0.4% | 4.8% |

Calibrating end to end rather than on raw token ratios changed the answer. Measured on content alone the previous-tokenizer proxy looks about 13% low, which invites a correction — but PromptScan's per-message overhead, borrowed from OpenAI's documented figures, runs slightly high for Anthropic and offsets it almost exactly. Correcting content in isolation would have made those estimates worse. The newer tokenizer's gap is far too large for that to absorb, so it gets a real correction.

Counts stay labeled approximate, because they are: the residual is roughly ±10% per prompt, though it now scatters both directions instead of always running low. A call site whose model doesn't resolve is assumed to be on the newer tokenizer, since that's what every Claude release since Opus 4.7 uses and over-reporting cost is the safer error for a budgeting tool.

Output tokens can't be known from the source, so PromptScan never reports them; the numbers are always input-only. Cost comes from a bundled pricing table stamped with an as-of date. If a model isn't in the table it's reported as unpriced and left out of the totals rather than guessed at. Pass `--volume-config` and it will multiply through to a monthly figure.

### Duplicates, dead prompts, and bloat

Beyond per-call numbers, a scan surfaces a few patterns worth cleaning up:

- **Duplicates.** Prompts that are byte-identical across call sites (with a wasted-token tally), plus near-duplicates found by token-set Jaccard similarity above a threshold (0.85 by default). The near ones are usually the interesting case, where a copy-pasted prompt drifted in one place but not the others.
- **Dead prompts.** A prompt-shaped string constant that nothing references anywhere in the scan. This one is deliberately cautious: it only fires when the name never appears as a reference in any file, never shows up inside a string literal (which covers `__all__`, `getattr`, and similar dynamic access), and the value is a module-level, fully static, six-plus-word string. It skips constants defined in test/mock/fixture files (references from them still count) and ones that aren't instruction prose — ASCII art, data blobs, and things named like logos, URLs, or error messages. It's still a heuristic, reported on its own, and it can't see reflection or a library prompt that outside code imports, so verify before deleting.
- **Context bloat.** Three heuristics: a single prompt over a token threshold, a prompt with a lot of message parts (a possible pile of few-shot examples), and a block of text repeated verbatim across several call sites. That last one is the part-level version of duplicate detection, so it catches a shared system prompt across calls whose user turns differ, which is a good candidate to extract or cache.

### Prompt caching

Anthropic's prompt caching changes the cost of a call by an order of magnitude, so PromptScan accounts for it in both directions.

If a call already carries a `cache_control` breakpoint, the cached prefix is billed at the cache-read rate (0.1× base) rather than full price. Reporting it at full price would overstate that call site's cost by up to 10×. The reported cost is the steady-state one, since a prefix is written once and read on every later call; the one-time write premium (1.25× on the prefix) is carried separately in the JSON as `cacheWriteCostUsd`, not amortized into a per-call number that would need a call-count assumption to be meaningful.

If a call doesn't cache but could, it's reported as an opportunity with the input cost it would save per repeat call. Two rules keep this from turning into bad advice:

- **The minimum is per model, and it's enforced.** A breakpoint on a prefix shorter than the model's minimum is silently ignored by the API — no cache, no discount. That minimum ranges from 512 tokens (Fable 5) to 1,024 (Opus 4.8, Sonnet 5) to 4,096 (Opus 4.6, Haiku 4.5), so the same prompt can be worth caching on one model and a no-op on another. Prompts under their minimum are counted, never recommended, and an Anthropic model that isn't in the table falls back to the largest minimum so an unknown model under-reports rather than misleads.
- **Only a real prefix counts.** A cache breakpoint covers a contiguous prefix that's identical on every call, so the cacheable size is measured over the leading parts that fully resolve, stopping at the first one with runtime content. A prompt with a large static block sitting behind a runtime turn has no stable prefix and isn't flagged, even though its static token total is large.

OpenAI is deliberately out of scope here: its caching is automatic, with no marker to detect and no code change to recommend. Flagging those call sites would be noise, and applying a discount would mean guessing at a hit rate that isn't visible in the source.

Because this reads only what's static in the source, it under-reports by design. Code that attaches `cache_control` programmatically, or builds its system prompt at runtime, is invisible to it — that's a limit of static analysis, not a gap to be papered over with a guess.

## Configuration

Thresholds can live in a config file so you don't have to pass them every run. PromptScan looks for `promptscan.config.{json,yaml,yml}` (or `.promptscanrc`) in the working directory and its ancestors, or you can point at one with `--config`. Everything is optional and falls back to a sane default, and a CLI flag always wins over the file.

```yaml
# promptscan.config.yaml
gitignore: true
exclude:                    # paths to skip, .gitignore-style (also --exclude)
  - website                 # any directory named website, at any depth
  - src/generated           # contains a slash, so anchored at the scan root
  - "**/*.bench.py"         # already a glob, used as-is
limits:                     # absolute thresholds that make a scan exit 1
  maxTotalCostUsd: 0.50
  maxPromptTokens: 8000
  maxTotalTokens: 100000
duplicates:
  similarity: 0.85          # near-duplicate threshold (also --similarity)
  minWords: 5               # ignore very short prompts in duplicate analysis
bloat:
  largeTokens: 2000         # "oversized prompt" threshold
  manyMessages: 6           # "few-shot" message-count threshold
  boilerplateMinSites: 3    # min call sites for a block to count as boilerplate
  boilerplateMinWords: 8
volume:                     # monthly-projection call volumes (same as --volume-config)
  default: 1000
  sites:
    "src/agents/support.py:44": 50000
```

`exclude` follows `.gitignore` conventions, so a bare name matches at any depth (`website` skips `docs/website/` too) while anything containing a slash is anchored at the scan root. Patterns that already look like globs are passed through untouched. Unlike the scalar options, `--exclude` flags are *added to* the config's list rather than replacing it, so passing one on the command line can't silently drop the project's configured excludes. Whatever ends up applying is printed before the report — the filter is never silent.

The volume file for `--volume-config` is the `volume:` block on its own:

```yaml
default: 1000
sites:
  "src/agents/support.py:44": 50000
```

## Failing a build on absolute limits

`diff` gates on a *change* between two refs, which needs a base to compare against. For a push, a nightly run, or any build without one, `scan` gates on the absolute state:

```bash
promptscan scan ./src --max-total-cost 0.50      # exit 1 if the scan's input cost exceeds $0.50
promptscan scan ./src --max-prompt-tokens 8000   # exit 1 if any one prompt exceeds 8k input tokens
promptscan scan ./src --max-total-tokens 100000  # exit 1 if the scan's input tokens exceed 100k
```

Each violation is printed to stderr with the file and line that caused it; the report still goes to stdout, so the exit code gates the build without costing you the output. Exit 1 means a limit was exceeded, exit 2 means bad usage or config.

Because the counts cover statically-resolved content only, they're a floor: a prompt assembled at runtime can be larger than the limit without tripping it. These gates won't fail your build spuriously, but they aren't exhaustive either.

## Catching cost regressions on a PR

`promptscan diff` compares two git refs and reports the change: the token and cost delta, and any prompts that were added or removed. When a new prompt looks like one that already exists, it says so. It reads each ref with `git archive`, so it never touches your working tree.

```bash
promptscan diff main HEAD ./src                     # human-readable
promptscan diff main HEAD ./src --format markdown   # for a PR comment
promptscan diff main HEAD ./src --fail-on-increase 5   # exit 1 if tokens grow >5%
```

```
PromptScan diff

  Input tokens    24 → 48   (+24, +100.0%)
  Est. input cost $0.00006 → $0.00012   (+$0.00006, +100.0%)
  Call sites      1 → 2

  New prompts (1):
    b.py:3 — +24 tokens ($0.00006) · near-duplicate of a.py:3 (0.88)
```

`--fail-on-increase <pct>` gates on tokens by default, or on cost with `--metric cost`.

There's a GitHub Action in [`action.yml`](action.yml) that runs the diff against a PR's base branch, posts (or updates) a comment, and fails the check on an increase. A copy-paste workflow lives in [`examples/github-workflow.yml`](examples/github-workflow.yml):

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 } # both refs have to be present for the diff
- uses: joandino/promptscan@v1
  with:
    path: ./src
    fail-on-increase: '5'
    metric: tokens
```

The Action is written and its YAML is valid, but it hasn't been run in a live workflow yet, so treat it as a starting point rather than a guarantee.

## JSON output

`--format json` prints the full report. It has a versioned schema at [`schema/scanreport.schema.json`](schema/scanreport.schema.json) (JSON Schema draft 2020-12), and every report includes a `meta.schemaVersion` that's separate from the package version. Additive, backward-compatible changes leave it alone; a breaking change bumps it. A test validates real output against the schema on every run, so the schema and the code can't quietly drift apart.

## What it deliberately doesn't do

- It doesn't judge prompt quality or say one prompt is better than another.
- It doesn't recommend a cheaper model, because that needs a quality measurement it doesn't have.
- It doesn't do runtime tracing. That's a different kind of tool.

## How it holds up on real code

The detection was checked against three real repositories (`openai/openai-python`, `anthropics/anthropic-sdk-python`, `openai/swarm`), 2,932 Python files in all. No crashes, everything parsed, under two seconds per repo. It found 237 of the 239 real call sites a human reviewer would flag (99.2%) with no false positives. Every gap was accounted for: docstrings, non-LLM APIs like Twilio and the Assistants `threads.messages.create`, and two calls buried inside the Anthropic SDK's own internals. The write-up, including why those two are left alone on purpose, is in [VALIDATION.md](VALIDATION.md).

## Known limitations

- Dead-prompt detection is a heuristic. It can't see runtime reflection, and a prompt a library exports for others to import will look unused. Verify before deleting.
- A call on an attribute receiver like `self._client.messages.create` in a file that doesn't import the SDK by name won't be detected. In practice this only happens inside a provider's own package.
- Cross-file constants resolve only when the imported module is a file inside the scan; a constant pulled from an installed package, a dynamic import, or a `*`/default export stays unresolved. Non-literal file paths are reported as unresolved rather than guessed.
- litellm calls to providers other than OpenAI and Anthropic are detected and reported as provider `other`, but their tokens are only a `cl100k` proxy and they carry no price — PromptScan tokenizes and prices OpenAI and Anthropic natively, nothing else. litellm support is Python-only.
- Prices drift. The pricing table is one bundled file with an as-of date, and the OpenAI figures are list prices. Check them before you rely on the dollar numbers.

## Building from source

```bash
git clone https://github.com/joandino/promptscan.git
cd promptscan
npm install
npm run build          # compile to dist/
npm test               # run the suite (node --test via tsx)
npm run dev -- ./src   # run the CLI without building
```

Tests are fixture-driven: small Python and TypeScript/JavaScript files under `test/fixtures/` cover every detection, resolution, token, cost, duplicate, and diff case.

## Under the hood

The CLI is TypeScript on Node. Parsing goes through `web-tree-sitter` (the WASM build, so it installs cleanly over npx and tolerates broken files) with the Python, TypeScript, and TSX grammars, which lets all three languages share one code path. Tokenization is `js-tiktoken` for OpenAI and a `cl100k` proxy for Anthropic, calibrated per tokenizer family against the count_tokens endpoint. Similarity is token-set Jaccard, and the terminal tables are `cli-table3`.

## License

MIT
