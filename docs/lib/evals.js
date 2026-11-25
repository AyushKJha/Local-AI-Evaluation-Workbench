// Assertions, scoring and the Ollama client. No DOM access, so it runs in Node tests too.

export const ASSERTION_TYPES = {
  contains: { label: 'Contains', needsValue: true },
  not_contains: { label: 'Does not contain', needsValue: true },
  regex: { label: 'Matches regex', needsValue: true },
  equals: { label: 'Equals exactly', needsValue: true },
  json: { label: 'Is valid JSON', needsValue: false },
  max_words: { label: 'At most N words', needsValue: true },
  min_words: { label: 'At least N words', needsValue: true },
};

const words = s => (String(s).trim().match(/\S+/g) || []).length;

function stripFence(text) {
  const m = String(text).trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : String(text).trim();
}

export function checkAssertion(output, { type, value = '' }) {
  const out = String(output ?? '');
  switch (type) {
    case 'contains': return { pass: out.toLowerCase().includes(String(value).toLowerCase()), detail: `contains "${value}"` };
    case 'not_contains': return { pass: !out.toLowerCase().includes(String(value).toLowerCase()), detail: `does not contain "${value}"` };
    case 'equals': return { pass: out.trim() === String(value).trim(), detail: 'equals expected text' };
    case 'regex': {
      let re;
      try { re = new RegExp(value, 'i'); } catch { return { pass: false, detail: `invalid regex /${value}/` }; }
      return { pass: re.test(out), detail: `matches /${value}/` };
    }
    case 'json': {
      try { JSON.parse(stripFence(out)); return { pass: true, detail: 'valid JSON' }; } catch { return { pass: false, detail: 'valid JSON' }; }
    }
    case 'max_words': return { pass: words(out) <= Number(value), detail: `≤ ${value} words (got ${words(out)})` };
    case 'min_words': return { pass: words(out) >= Number(value), detail: `≥ ${value} words (got ${words(out)})` };
    default: return { pass: false, detail: `unknown check "${type}"` };
  }
}

export function scoreCase(output, assertions) {
  const results = assertions.map(a => ({ ...checkAssertion(output, a), type: a.type }));
  return { results, pass: results.length > 0 && results.every(r => r.pass), passed: results.filter(r => r.pass).length, total: results.length };
}

// Per-model totals: pass rate, average latency and generation speed.
export function summarize(results) {
  const by = new Map();
  for (const r of results) {
    const m = by.get(r.model) || { model: r.model, cases: 0, passed: 0, errors: 0, latency: [], tps: [] };
    m.cases++;
    if (r.error) m.errors++;
    else {
      if (r.pass) m.passed++;
      m.latency.push(r.latencyMs);
      if (r.tokensPerSec) m.tps.push(r.tokensPerSec);
    }
    by.set(r.model, m);
  }
  const avg = xs => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  const p95 = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
  return [...by.values()].map(m => ({
    model: m.model, cases: m.cases, passed: m.passed, errors: m.errors,
    passRate: Math.round(m.passed / m.cases * 100),
    avgLatencyMs: avg(m.latency), p95LatencyMs: p95(m.latency),
    tokensPerSec: m.tps.length ? Math.round(m.tps.reduce((a, b) => a + b, 0) / m.tps.length * 10) / 10 : null,
  })).sort((a, b) => b.passRate - a.passRate || (a.avgLatencyMs ?? 1e12) - (b.avgLatencyMs ?? 1e12));
}

// Import cases from JSON ([{name,prompt,assertions:[{type,value}]}]) or CSV (name,prompt,type,value per row).
export function parseCases(text) {
  const t = String(text).trim();
  if (t.startsWith('[')) {
    const list = JSON.parse(t);
    return list.map((c, i) => normalizeCase({ name: c.name || `Case ${i + 1}`, prompt: c.prompt, system: c.system, assertions: c.assertions || [] }));
  }
  const lines = t.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(',').map(s => s.trim().toLowerCase());
  const col = n => header.indexOf(n);
  if (col('prompt') < 0) throw new Error('CSV needs a "prompt" column');
  const cases = new Map();
  for (const line of lines) {
    const cells = splitCsvLine(line);
    const name = cells[col('name')] || `Case ${cases.size + 1}`;
    const c = cases.get(name) || { name, prompt: cells[col('prompt')], assertions: [] };
    if (col('type') >= 0 && cells[col('type')]) c.assertions.push({ type: cells[col('type')].trim(), value: cells[col('value')] ?? '' });
    cases.set(name, c);
  }
  return [...cases.values()].map(normalizeCase);
}

function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

export function normalizeCase(c) {
  if (!c.prompt || typeof c.prompt !== 'string') throw new Error(`"${c.name}" has no prompt`);
  const assertions = (c.assertions || []).map(a => {
    if (!ASSERTION_TYPES[a.type]) throw new Error(`"${c.name}" uses an unknown check "${a.type}"`);
    return { type: a.type, value: a.value == null ? '' : String(a.value) };
  });
  return { id: c.id || cryptoId(), name: String(c.name).slice(0, 120), prompt: c.prompt, system: c.system || '', assertions };
}

const cryptoId = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

export async function listModels(baseUrl, fetchImpl = fetch) {
  const r = await fetchImpl(new URL('/api/tags', baseUrl));
  if (!r.ok) throw new Error(`Ollama answered ${r.status}`);
  const data = await r.json();
  return (data.models || []).map(m => ({ name: m.name, size: m.size, family: m.details?.family, params: m.details?.parameter_size }));
}

export async function generate(baseUrl, { model, prompt, system, temperature = 0 }, fetchImpl = fetch, signal) {
  const started = performance.now();
  const r = await fetchImpl(new URL('/api/generate', baseUrl), {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, system: system || undefined, stream: false, options: { temperature } }),
  });
  if (!r.ok) throw new Error(`${model}: Ollama answered ${r.status} ${(await r.text()).slice(0, 120)}`);
  const data = await r.json();
  const latencyMs = Math.round(performance.now() - started);
  const tokensPerSec = data.eval_count && data.eval_duration ? Math.round(data.eval_count / (data.eval_duration / 1e9) * 10) / 10 : null;
  // Reasoning models may put their thinking inside the answer; score only the final reply.
  const output = String(data.response ?? '').replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
  return { output, latencyMs, tokensPerSec, tokens: data.eval_count ?? null };
}
