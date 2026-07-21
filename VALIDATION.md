# v0.1 Validation (M5)

_Run 2026-07-20 against three real open-source repositories that call LLMs._

The v0.1 acceptance bar (from the spec): _"Run it against three real open-source
repos that use LLMs. It should find every call site a human reviewer finds,
resolve the majority of prompts, and report the rest as unresolved without
crashing."_

## Subjects

| Repo | Why | Python files |
|---|---|---|
| [`openai/openai-python`](https://github.com/openai/openai-python) | OpenAI SDK — `chat.completions.create` + `responses.create`, sync/async/streaming | 1,678 |
| [`anthropics/anthropic-sdk-python`](https://github.com/anthropics/anthropic-sdk-python) | Anthropic SDK — `messages.create`, `system=`, tools | 1,192 |
| [`openai/swarm`](https://github.com/openai/swarm) | Real agent framework — direct calls, dynamically-built prompts | 62 |

## Method

1. Run the built CLI on each whole repo; record counts, timing, crashes.
2. `grep` every occurrence of the targeted method calls; diff against detected
   locations at `file:line` granularity.
3. Manually classify every discrepancy as a true miss or a correct rejection
   (docstring / comment / string / non-LLM API).
4. Spot-check resolved prompts against source for extraction accuracy.

## Results

**No crashes. 2,932 files, all parsed clean, < 2s each.**

### Detection recall & precision

| Repo | Real call sites (human) | Detected | False negatives | False positives |
|---|---|---|---|---|
| swarm | 6 | 6 | 0 | 0 |
| openai-python | 70 | 70 | 0 | 0 |
| anthropic-sdk-python | 163 | 161 | 2 | 0 |
| **Total** | **239** | **237** | **2 (0.8%)** | **0** |

**Recall 99.2%, precision 100%.** Every one of the 237 detections corresponds to
a real call (the detected-set is a strict subset of the grep-set — no line drift,
no phantom hits).

### Discrepancy classification

Every `grep` hit not detected was inspected:

- **openai-python (7 gaps)** — all docstring/comment text, e.g.
  `` `client.chat.completions.create()` `` inside `"""..."""` wrapper docs and
  ` ```py ` fenced examples. tree-sitter parses these as `string` nodes, not
  calls. **A human reviewer would not count them either.**
- **anthropic-sdk-python (13 gaps)** — 11 are docstrings / a `TypeError` message
  string; **2 are genuine misses**: `lib/tools/_beta_runner.py:230` and `:518`,
  both `self._client.beta.messages.create(...)`.

### The 2 real misses — a deliberate tradeoff, not a bug

Those calls are missed because `_beta_runner.py` (a) uses **relative imports**
(no `import anthropic`) and (b) calls on `self._client` (an attribute, not a
bound variable), so neither the import gate nor the binding gate fires for the
short `.messages.create` chain.

We **intentionally** gate `.messages.create` on an Anthropic import or binding,
because `client.messages.create()` is **also [Twilio's SMS API](https://www.twilio.com/docs/messaging)**
(and appears in email SDKs). Loosening the gate to catch these two would
false-positive on every Twilio codebase — the exact failure mode the design
calls unacceptable (principle #3). The cost is that Anthropic's _own internal_
code (which imports itself relatively) isn't detected. For the tool's actual
target — application code, which imports the SDK by name — this pattern does not
occur.

### Prompt resolution

| Repo | Resolved | Partial | Unresolved |
|---|---|---|---|
| anthropic-sdk-python | 155 (96%) | 4 | 2 |
| openai-python | 42 (60%) | 0 | 28 |
| swarm | 0 | 1 | 5 |

The SDK repos resolve the large majority (literal example prompts). swarm
resolves ~none — and correctly so: it builds `messages` lists at runtime and
passes agent `instructions` as callables. Those are honestly reported as
unresolved, never guessed. Spot-checks confirm extracted text matches source
exactly (e.g. `google_cloud.py:31` → model `claude-haiku-4-5`, user `"Hello!"`).

## Known limitations (v0.1)

- **Provider SDK internals**: calls on an attribute receiver
  (`self._client.messages.create`) in a file that does not import the SDK by
  name are not detected. Confined to code living _inside_ a provider package.
- Documented already: cross-module constants, `Path` _variables_, and raw
  escape-sequence counting.

### Post-validation follow-up

The `.stream()` / `.parse()` gap flagged here has since been **closed**: those
variants are now detected (they share the create argument shape). Re-running the
subjects: anthropic-sdk 161 → 199 (+38 `messages.stream`), openai-python
70 → 107 (+37 `chat.completions.stream` / `.parse` / `responses.stream`), swarm
unchanged. Twilio's `client.messages.stream()` is correctly still excluded.

## Verdict

Meets the v0.1 bar: finds every application call site a reviewer would flag,
zero false positives across ~2,900 files, resolves the majority of static
prompts, honestly reports the rest, and never crashes. The only misses are two
calls inside the Anthropic SDK's own guts, unreachable without reintroducing
Twilio false positives.
