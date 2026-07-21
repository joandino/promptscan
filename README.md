# PromptScan

> Static analysis for LLM call sites. Find what your prompts cost before you ship them.

PromptScan scans a repository, finds every LLM API call, and reports what each one costs in tokens and money — plus the duplicates and the oversized prompts nobody noticed.

It makes no claims it can't prove. Every number comes from static analysis of your code. **"This prompt is 48 tokens and appears in three files"** is a fact. **"This cheaper model would work just as well"** is not — and PromptScan doesn't say it.

> **Status:** pre-release (`v0.3.0`). Python source, OpenAI + Anthropic. Roadmap phases v0.1–v0.3 are implemented and validated; see [Roadmap](#roadmap). Not yet published to npm — see [Local usage](#usage).

---

## Why this exists

Runtime observability tools (LangSmith, Langfuse, Helicone) tell you what your LLM calls did in production. They can't tell you anything about a prompt until it runs.

PromptScan works on the repo instead. That means:

- It runs in CI, on a PR, before anything reaches production.
- It costs nothing to run — no instrumentation, no SDK wrapper, no API key.
- It reads what's statically determinable, and **reports the rest as unresolved rather than guessing.**

---

## What it does

Point it at a directory and it runs a pipeline:

**discover → detect → resolve prompts → count tokens → estimate cost → find duplicates → project spend**

### 1. Call-site detection

Parses each file with tree-sitter and finds LLM invocations:

| Provider | Methods detected |
|---|---|
| OpenAI | `chat.completions.create` / `.parse` / `.stream`, `responses.create` / `.parse` / `.stream` |
| Anthropic | `messages.create` / `.stream` |

Detection is corroborated by two independent signals beyond the method name — an SDK import (`import openai`, `from anthropic import ...`) and client-variable binding (`client = openai.OpenAI()`). Long, self-identifying chains (`chat.completions.create`) report **high** confidence on shape alone; short, ambiguous chains (`messages.create` — which is *also Twilio's SMS API*) require an import (**medium**) or a binding (**high**), and are dropped otherwise. The table shows *why* each medium call site was included.

### 2. Prompt resolution

Traces the prompt argument (`messages=`, `system=`, `input=`, `instructions=`) back to its source:

- String literals, adjacent and `+` concatenation → **resolved**
- Module constants / single-assignment variables → resolved via a symbol table
- f-strings → **partial** (static text kept, `{…}` interpolations flagged)
- Static file loads (`open("p.txt").read()`, `Path("p.md").read_text()`) → resolved from disk
- Anything from a runtime parameter, a reassigned variable, or a function call → **unresolved, with a reason**

The unresolved and partial counts are a headline figure, and each is listed with its reason. A report that silently skips half your prompts is worse than useless.

### 3. Token counts

Tokenizes each resolved prompt and reports **input** tokens (plus documented message-envelope overhead):

- **OpenAI** — `js-tiktoken` with the correct encoding per model (`o200k_base` / `cl100k_base`).
- **Anthropic** — a `cl100k` proxy, labeled `~` **approximate (no public tokenizer)**.

Output tokens aren't statically knowable, so PromptScan never invents them — everything is explicitly *input-only*. Partial prompts count their static text as a floor (`+`).

### 4. Cost

Multiplies tokens by a **bundled, versioned pricing table** (OpenAI + Anthropic), stamped with an as-of date. Reports per-call and per-scan input cost. Unknown models are reported **unpriced** and excluded from totals — never guessed. With a `--volume-config`, it projects monthly cost.

### 5. Duplicate detection

- **Exact** — identical normalized prompt text across call sites, with a wasted-token tally.
- **Near-duplicate** — token-set Jaccard similarity above a configurable threshold (default `0.85`), catching prompts that drifted apart through copy-paste edits.

---

## Usage

Not yet on npm. To run it locally:

```bash
git clone <this-repo> && cd prompt-scan
npm install
npm run build

# scan a directory
node dist/cli.js ./src

# or, without building, via the dev runner
npm run dev -- ./src
```

Once published, the intended entry point is `npx promptscan ./src`.

```bash
node dist/cli.js ./src                          # table summary (default)
node dist/cli.js ./src --format json            # full structured report
node dist/cli.js ./src --similarity 0.9         # stricter near-dup threshold
node dist/cli.js ./src --volume-config vol.yaml # monthly cost projection
node dist/cli.js ./src --no-gitignore           # scan gitignored files too
```

**Volume config** (`vol.yaml`) for monthly projections:

```yaml
default: 1000            # calls/month applied to every call site
sites:
  "src/agents/support.py:44": 50000   # per-site override
```

### Example output

```
PromptScan v0.3.0  (phase: cost)

  Scanned:  ./src
  Files:    4 Python files
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

Output-cell markers: `~` approximate (proxy/fallback tokenizer) · `+` partial (static floor) · `—` unresolved.

### Output formats

- `--format table` — human-readable terminal summary (default)
- `--format json` — the full structured `ScanReport` for downstream tooling

---

## Design principles

1. **Never claim what you can't verify.** Every number traces to something countable in the source.
2. **Report unknowns loudly.** Unresolved prompts and unpriced models are headline figures, not footnotes.
3. **False positives are the failure mode.** A wrong dead-prompt or false detection gets the tool uninstalled — the gates are tuned accordingly.
4. **Zero configuration to first result.** Point it at a directory; it works.
5. **Estimates are labeled as estimates.** Always — token counts, costs, and Anthropic's proxy tokenizer all say so.

---

## Validation

v0.1 was validated against three real repos — `openai/openai-python`, `anthropics/anthropic-sdk-python`, `openai/swarm` (**2,932 Python files**):

- **No crashes**, all files parsed, < 2s per repo.
- **99.2% detection recall** (237 / 239 real call sites), **100% precision** (zero false positives).
- Every gap classified: docstrings, non-LLM APIs (Twilio, Assistants `threads.messages.create`), or 2 deliberate misses inside the Anthropic SDK's own internals.

Full methodology and the Twilio tradeoff writeup: [VALIDATION.md](VALIDATION.md).

## Known limitations

- **Python only** at this stage (TypeScript/JavaScript is roadmapped for v0.5).
- **Provider SDK internals**: a call on an attribute receiver (`self._client.messages.create`) in a file that doesn't import the SDK by name isn't detected — confined to code living *inside* a provider package.
- **Cross-module constants** (`from other import PROMPT`) and `Path` *variables* report unresolved rather than guess.
- **Pricing drifts.** The table is a single bundled file stamped with an as-of date; OpenAI prices are listed rates — verify before relying on them.

## Explicit non-goals

- **No quality evaluation.** PromptScan never claims a prompt is better or worse.
- **No model-substitution advice.** That requires quality measurement.
- **No runtime tracing.** Different tool, different architecture.

---

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| **v0.1** | Python + OpenAI/Anthropic detection, prompt resolution, token counts, table output | ✅ done, validated |
| — | `.stream()` / `.parse()` call variants | ✅ done |
| **v0.2** | Exact + near-duplicate detection, JSON output | ✅ done |
| **v0.3** | Versioned pricing table, per-call + monthly cost | ✅ done |
| **v0.4** | `diff` command, GitHub Action, PR comments, fail-on-increase | planned |
| **v0.5** | TypeScript/JavaScript support, LangChain patterns, dead-prompt detection | planned |
| **v1.0** | Context-bloat heuristics, config file, stable JSON schema | planned |

---

## Stack

| Concern | Choice |
|---|---|
| CLI | TypeScript / Node |
| Parsing | `web-tree-sitter` (WASM) + `tree-sitter-python` — portable via npx, error-tolerant |
| Tokenization | `js-tiktoken` (OpenAI); `cl100k` proxy for Anthropic |
| Similarity | Token-set Jaccard |
| Output | `cli-table3`, JSON |
| Config | `yaml` (volume config) |

Tree-sitter over language-native ASTs so every language goes through one interface, and so partial/broken files still parse.

---

## Development

```bash
npm install
npm run build        # compile to dist/
npm test             # run the test suite (node --test via tsx)
npm run typecheck    # tsc --noEmit
npm run dev -- ./src # run the CLI without building
```

Tests are fixture-driven — small Python inputs under `test/fixtures/` exercise every detection, resolution, tokenization, cost, and duplicate case.

## License

MIT
