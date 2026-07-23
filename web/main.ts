import { Parser, Language } from 'web-tree-sitter';
import { scanSnippet, type SnippetReport } from './core.js';
import type { CallSite } from '../src/report/types.js';
import type { LangId } from '../src/parse/lang.js';

const GRAMMAR: Record<LangId, string> = {
  python: 'tree-sitter-python.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
};

const cache = new Map<LangId, { parser: Parser; language: Language }>();
let runtimeReady = false;

async function parserFor(langId: LangId): Promise<{ parser: Parser; language: Language }> {
  if (!runtimeReady) {
    await Parser.init({ locateFile: (name: string) => name });
    runtimeReady = true;
  }
  let entry = cache.get(langId);
  if (!entry) {
    const language = await Language.load(GRAMMAR[langId]);
    const parser = new Parser();
    parser.setLanguage(language);
    entry = { parser, language };
    cache.set(langId, entry);
  }
  return entry;
}

// ---- rendering -------------------------------------------------------------

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function usd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return '$' + n.toFixed(5);
  return '$' + n.toFixed(2);
}

function modelCell(s: CallSite): string {
  if (s.modelResolved && s.model) return esc(s.model);
  const hint = s.modelHint ? `‹${s.modelHint}›` : '‹unresolved›';
  return `<span class="dim">${esc(hint)}</span>`;
}

function tokCell(s: CallSite): string {
  if (s.prompt.status === 'unresolved') return '<span class="dim">—</span>';
  const approx = s.tokens.approximate ? '~' : '';
  const partial = s.prompt.status === 'partial' ? '+' : '';
  return `${approx}${s.tokens.inputTokens}${partial}`;
}

function costCell(s: CallSite): string {
  if (s.prompt.status === 'unresolved') return '<span class="dim">—</span>';
  if (s.cost.inputCostUsd === null) return '<span class="dim">unpriced</span>';
  return `${s.tokens.approximate ? '~' : ''}${usd(s.cost.inputCostUsd)}`;
}

function render(r: SnippetReport): string {
  const st = r.stats;
  if (st.callSites === 0) {
    return `<div class="empty">No OpenAI / Anthropic / LangChain / litellm call sites found in this snippet.</div>`;
  }
  const providers = countProviders(r.callSites);
  const approx = st.tokensApproximate ? '~' : '';
  const rows = r.callSites
    .map(
      (s) => `<tr>
        <td class="loc">:${s.line}</td>
        <td>${esc(s.provider)}</td>
        <td>${modelCell(s)}</td>
        <td class="num">${tokCell(s)}</td>
        <td class="num">${costCell(s)}</td>
        <td>${esc(s.confidence)}${s.confidence === 'medium' ? ` <span class="dim">(${esc(s.basis)})</span>` : ''}</td>
      </tr>`,
    )
    .join('');

  let out = `
    <div class="summary">
      <div><b>${st.callSites}</b> call site${st.callSites === 1 ? '' : 's'} <span class="dim">(${providers})</span></div>
      <div><b>${st.promptsResolved}</b> resolved · <b>${st.promptsPartial}</b> partial · <b>${st.promptsUnresolved}</b> unresolved</div>
      <div><b>${approx}${st.inputTokens.toLocaleString('en-US')}</b> input tokens <span class="dim">(estimate, input only)</span></div>
      <div><b>${approx}${usd(st.inputCostUsd)}</b>/scan input cost${st.unpricedCallSites ? ` <span class="dim">(${st.unpricedCallSites} unpriced)</span>` : ''} <span class="dim">· pricing ${esc(r.pricingVersion)}</span></div>
    </div>
    <table class="sites">
      <thead><tr><th>Line</th><th>Provider</th><th>Model</th><th>Input tok</th><th>Input $</th><th>Confidence</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="legend"><span class="dim">~ approximate (proxy/fallback tokenizer) &nbsp; + partial (static floor) &nbsp; — unresolved</span></div>`;

  const { exact, near } = r.duplicates;
  if (exact.length || near.length) {
    out += `<div class="section"><h3>Duplicates</h3>`;
    for (const g of exact) {
      out += `<div class="finding"><b>exact ×${g.sites.length}</b> (${g.tokens} tok each): "${esc(preview(g.text))}"<div class="dim">${g.sites.map((s) => ':' + s.line).join('  ')}</div></div>`;
    }
    for (const p of near) {
      out += `<div class="finding"><b>near-dup ${p.similarity.toFixed(2)}</b>: :${p.a.line} ~ :${p.b.line}</div>`;
    }
    out += `</div>`;
  }

  if (r.deadPrompts.length) {
    out += `<div class="section"><h3>Possibly-unused prompts <span class="dim">(heuristic — verify before deleting)</span></h3>`;
    for (const d of r.deadPrompts) {
      out += `<div class="finding">:${d.line} — <b>${esc(d.name)}</b> <span class="dim">(${d.tokens} tok, no reachable reference)</span></div>`;
    }
    out += `</div>`;
  }

  const b = r.bloat;
  if (b.oversized.length || b.fewShot.length || b.boilerplate.length) {
    out += `<div class="section"><h3>Context bloat <span class="dim">(heuristics)</span></h3>`;
    for (const o of b.oversized) out += `<div class="finding">:${o.line} — oversized, ${o.tokens.toLocaleString('en-US')} tok</div>`;
    for (const f of b.fewShot) out += `<div class="finding">:${f.line} — ${f.messageCount} messages (possible few-shot)</div>`;
    for (const bp of b.boilerplate) out += `<div class="finding">repeated ×${bp.sites.length}, ${bp.tokens} tok each</div>`;
    out += `</div>`;
  }

  const notFull = r.callSites.filter((s) => s.prompt.status !== 'resolved');
  if (notFull.length) {
    out += `<div class="section"><h3>Prompts needing attention</h3>`;
    for (const s of notFull) {
      out += `<div class="finding">:${s.line} — <span class="dim">${esc(s.prompt.status)}: ${esc(s.prompt.reason ?? 'see call site')}</span></div>`;
    }
    out += `</div>`;
  }
  return out;
}

function countProviders(sites: CallSite[]): string {
  const c = { openai: 0, anthropic: 0, other: 0 };
  for (const s of sites) c[s.provider]++;
  const parts = [`openai ${c.openai}`, `anthropic ${c.anthropic}`];
  if (c.other) parts.push(`other ${c.other}`);
  return parts.join(', ');
}

function preview(text: string, max = 64): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

// ---- DOM wiring ------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function run(): Promise<void> {
  const code = $<HTMLTextAreaElement>('code').value;
  const langId = $<HTMLSelectElement>('lang').value as LangId;
  const results = $<HTMLDivElement>('results');
  if (!code.trim()) {
    results.innerHTML = `<div class="empty">Paste some code to scan.</div>`;
    return;
  }
  results.classList.add('busy');
  try {
    const { parser, language } = await parserFor(langId);
    const report = scanSnippet(code, langId, parser, language);
    results.innerHTML = render(report);
  } catch (err) {
    results.innerHTML = `<div class="error">Scan failed: ${esc(err instanceof Error ? err.message : String(err))}</div>`;
  } finally {
    results.classList.remove('busy');
  }
}

const EXAMPLES: Record<string, { lang: LangId; code: string }> = {
  python: {
    lang: 'python',
    code: `import openai

client = openai.OpenAI()

SUPPORT_PROMPT = "You are a meticulous senior support engineer at Acme Co. Be concise."

def reply(ticket: str):
    return client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SUPPORT_PROMPT},
            {"role": "user", "content": ticket},
        ],
    )

def triage(ticket: str):
    return client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SUPPORT_PROMPT},
            {"role": "user", "content": ticket},
        ],
    )
`,
  },
  litellm: {
    lang: 'python',
    code: `import litellm

resp = litellm.completion(
    model="claude-3-5-sonnet-20241022",
    messages=[
        {"role": "system", "content": "You classify support tickets by urgency."},
        {"role": "user", "content": "The dashboard is down for everyone."},
    ],
)
`,
  },
  typescript: {
    lang: 'typescript',
    code: `import OpenAI from "openai";

const client = new OpenAI();

const resp = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: "You are a careful reviewer of pull requests." },
    { role: "user", content: diff },
  ],
});
`,
  },
};

function loadExample(name: string): void {
  const ex = EXAMPLES[name];
  if (!ex) return;
  $<HTMLTextAreaElement>('code').value = ex.code;
  $<HTMLSelectElement>('lang').value = ex.lang;
  run();
}

function init(): void {
  let timer: number | undefined;
  const debounced = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 350);
  };
  $<HTMLTextAreaElement>('code').addEventListener('input', debounced);
  $<HTMLSelectElement>('lang').addEventListener('change', run);
  document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((btn) => {
    btn.addEventListener('click', () => loadExample(btn.dataset.example!));
  });
  loadExample('python');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
