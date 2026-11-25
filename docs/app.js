import { ASSERTION_TYPES, scoreCase, summarize, parseCases, normalizeCase, listModels, generate } from './lib/evals.js';
import { createStore, download, el, when } from './lib/store.js';

const $ = s => document.querySelector(s);
const store = createStore('local-ai-eval-workbench', () => ({ version: 1, url: 'http://localhost:11434', cases: [], runs: [], selectedModels: [] }));
let state, models = [], viewing = null, controller = null;
const MAX_RUNS = 30;

const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500); };
const save = () => store.save(state);
const fmtMs = ms => ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

const STARTER = [
  { name: 'Exact extraction', prompt: 'Return only the total amount as a number, nothing else.\n\nSubtotal: 40.00\nTax: 4.00\nTotal: 44.00', assertions: [{ type: 'regex', value: '^\\s*\\$?44(\\.00)?\\s*$' }] },
  { name: 'JSON output', prompt: 'Return a JSON object with keys "name" and "city" for: Priya lives in Pune. Return only JSON.', assertions: [{ type: 'json' }, { type: 'contains', value: 'Pune' }] },
  { name: 'Follows a length limit', prompt: 'Explain what an API is in at most 25 words.', assertions: [{ type: 'max_words', value: '25' }, { type: 'min_words', value: '5' }] },
  { name: 'Simple reasoning', prompt: 'A train leaves at 14:10 and the trip takes 2 hours 55 minutes. When does it arrive? Answer with the time only, in HH:MM.', assertions: [{ type: 'contains', value: '17:05' }] },
  { name: 'Refuses to invent', prompt: 'What was the exact closing price of the fictional company Zorblax Corp yesterday?', assertions: [{ type: 'regex', value: "(don't|do not|cannot|can't|fictional|not aware|no information|unable)" }] },
];

// ---------- Connection ----------
$('#originCmd').textContent = navigator.platform.startsWith('Win')
  ? `$env:OLLAMA_ORIGINS="${location.origin}"; ollama serve`
  : `OLLAMA_ORIGINS="${location.origin}" ollama serve`;

async function connect() {
  const status = $('#connStatus');
  status.className = 'badge none'; status.textContent = 'Connecting…';
  try {
    models = await listModels(state.url);
    status.className = 'badge ok'; status.textContent = `Connected · ${models.length} model${models.length === 1 ? '' : 's'}`;
    if (!models.length) toast('Ollama is running but has no models. Run: ollama pull llama3.2:3b');
    state.selectedModels = state.selectedModels.filter(m => models.some(x => x.name === m));
    if (!state.selectedModels.length && models[0]) state.selectedModels = models.slice(0, 2).map(m => m.name);
    $('#setupHelp').open = false;
  } catch {
    models = [];
    status.className = 'badge bad'; status.textContent = 'Could not reach Ollama';
    $('#setupHelp').open = true;
  }
  renderModels(); save();
}

$('#connForm').onsubmit = e => {
  e.preventDefault();
  try { const u = new URL(e.target.url.value.trim()); state.url = u.origin; connect(); } catch { toast('Enter an address like http://localhost:11434'); }
};

function renderModels() {
  const box = $('#models');
  box.replaceChildren(...models.map(m => el('label', { class: 'chip' },
    el('input', { type: 'checkbox', checked: state.selectedModels.includes(m.name), onchange: e => {
      state.selectedModels = e.target.checked ? [...state.selectedModels, m.name] : state.selectedModels.filter(x => x !== m.name); save();
    } }),
    m.name, m.params ? el('small', {}, m.params) : null)));
}

// ---------- Cases ----------
function checkRow(a = { type: 'contains', value: '' }) {
  const value = el('input', { name: 'value', value: a.value, placeholder: 'Expected text, pattern or number', 'aria-label': 'Check value' });
  const type = el('select', { name: 'type', 'aria-label': 'Check type', onchange: () => { value.hidden = !ASSERTION_TYPES[type.value].needsValue; } },
    Object.entries(ASSERTION_TYPES).map(([k, v]) => el('option', { value: k, selected: k === a.type }, v.label)));
  value.hidden = !ASSERTION_TYPES[a.type]?.needsValue;
  const row = el('div', { class: 'check-row' }, type, value, el('button', { type: 'button', 'aria-label': 'Remove check', onclick: () => row.remove() }, '✕'));
  return row;
}

function resetCaseForm() {
  const f = $('#caseForm'); f.reset(); f.id.value = '';
  $('#checkRows').replaceChildren(checkRow());
  $('#saveCase').textContent = 'Add case';
}

$('#addCheck').onclick = () => $('#checkRows').append(checkRow());
$('#clearCase').onclick = resetCaseForm;

$('#caseForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const assertions = [...$('#checkRows').children].map(r => ({ type: r.querySelector('select').value, value: r.querySelector('input').value.trim() }))
    .filter(a => !ASSERTION_TYPES[a.type].needsValue || a.value);
  if (!assertions.length) { toast('Add at least one check so the case can pass or fail'); return; }
  try {
    const c = normalizeCase({ id: f.id.value || undefined, name: f.name.value.trim(), prompt: f.prompt.value, system: f.system.value.trim(), assertions });
    const i = state.cases.findIndex(x => x.id === c.id);
    if (i >= 0) state.cases[i] = c; else state.cases.push(c);
    await save(); renderCases(); resetCaseForm(); toast(i >= 0 ? 'Case updated' : 'Case added');
  } catch (err) { toast(err.message); }
};

function editCase(c) {
  const f = $('#caseForm');
  f.id.value = c.id; f.name.value = c.name; f.prompt.value = c.prompt; f.system.value = c.system || '';
  $('#checkRows').replaceChildren(...(c.assertions.length ? c.assertions : [undefined]).map(a => checkRow(a)));
  $('#saveCase').textContent = 'Save changes';
  f.name.focus();
}

function renderCases() {
  const box = $('#cases');
  if (!state.cases.length) { box.replaceChildren(el('p', { class: 'empty' }, 'No test cases yet. Write one, import a file, or load the starter suite.')); return; }
  box.replaceChildren(...state.cases.map(c => el('div', { class: 'item' },
    el('div', {},
      el('h3', {}, c.name),
      el('p', { class: 'meta' }, c.prompt.length > 110 ? c.prompt.slice(0, 110) + '…' : c.prompt),
      el('p', { class: 'meta' }, c.assertions.map(a => ASSERTION_TYPES[a.type].label.toLowerCase() + (a.value ? ` "${a.value}"` : '')).join(' · '))),
    el('div', { class: 'item-actions' },
      el('button', { type: 'button', onclick: () => editCase(c) }, 'Edit'),
      el('button', { type: 'button', class: 'danger', onclick: async () => { if (!confirm(`Delete "${c.name}"?`)) return; state.cases = state.cases.filter(x => x.id !== c.id); await save(); renderCases(); } }, 'Delete')))));
}

$('#starter').onclick = async () => {
  const have = new Set(state.cases.map(c => c.name));
  const added = STARTER.filter(c => !have.has(c.name)).map(normalizeCase);
  state.cases.push(...added); await save(); renderCases();
  toast(added.length ? `Added ${added.length} starter cases` : 'The starter cases are already in your suite');
};

$('#importCasesBtn').onclick = async () => {
  try {
    const cases = parseCases($('#importCases').value);
    if (!cases.length) throw new Error('No cases found');
    state.cases.push(...cases); await save(); renderCases();
    $('#importCases').value = ''; toast(`Imported ${cases.length} case${cases.length === 1 ? '' : 's'}`);
  } catch (err) { toast(err.message); }
};

// ---------- Running ----------
$('#run').onclick = async () => {
  const chosen = state.selectedModels.filter(m => models.some(x => x.name === m));
  if (!models.length) { toast('Connect to Ollama first'); return; }
  if (!chosen.length) { toast('Select at least one model'); return; }
  if (!state.cases.length) { toast('Add at least one test case'); return; }
  const temperature = Math.min(2, Math.max(0, Number($('#temperature').value) || 0));
  const total = chosen.length * state.cases.length;
  const run = { id: crypto.randomUUID(), at: new Date().toISOString(), temperature, models: chosen, cases: structuredClone(state.cases), results: [] };
  controller = new AbortController();
  $('#run').disabled = true; $('#cancel').hidden = false;
  const bar = $('#progress'); bar.hidden = false; bar.max = total; bar.value = 0;
  // Run one model at a time so Ollama keeps it loaded between cases.
  outer: for (const model of chosen) {
    for (const c of run.cases) {
      if (controller.signal.aborted) break outer;
      $('#runStatus').textContent = `${model} · ${c.name} (${run.results.length + 1} of ${total})`;
      try {
        const g = await generate(state.url, { model, prompt: c.prompt, system: c.system, temperature }, fetch, controller.signal);
        const s = scoreCase(g.output, c.assertions);
        run.results.push({ model, caseId: c.id, output: g.output, latencyMs: g.latencyMs, tokensPerSec: g.tokensPerSec, pass: s.pass, checks: s.results });
      } catch (err) {
        if (controller.signal.aborted) break outer;
        run.results.push({ model, caseId: c.id, error: err.message, pass: false, checks: [] });
      }
      bar.value = run.results.length;
    }
  }
  const cancelled = controller.signal.aborted;
  controller = null;
  $('#run').disabled = false; $('#cancel').hidden = true; bar.hidden = true;
  if (!run.results.length) { $('#runStatus').textContent = 'Cancelled before any case finished.'; return; }
  run.partial = cancelled;
  state.runs = [run, ...state.runs].slice(0, MAX_RUNS);
  viewing = run.id; await save(); renderResults();
  $('#runStatus').textContent = cancelled ? `Cancelled after ${run.results.length} of ${total} cases. Partial results saved.` : `Finished ${total} cases at ${when(run.at)}.`;
  $('#resultsCard').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
};
$('#cancel').onclick = () => controller?.abort();

// ---------- Results ----------
function renderResults() {
  const card = $('#resultsCard');
  const run = state.runs.find(r => r.id === viewing) || state.runs[0];
  card.hidden = !run;
  if (!run) return;
  viewing = run.id;
  $('#history').replaceChildren(...state.runs.map(r => el('option', { value: r.id, selected: r.id === run.id },
    `${when(r.at)} · ${r.models.length} model${r.models.length === 1 ? '' : 's'} · ${r.cases.length} cases${r.partial ? ' (partial)' : ''}`)));
  $('#resultsTitle').textContent = `Results · temperature ${run.temperature}`;
  const rows = summarize(run.results);
  $('#leaderboard').replaceChildren(
    el('thead', {}, el('tr', {}, ['Model', 'Pass rate', 'Passed', 'Avg latency', 'p95 latency', 'Tokens/s', 'Errors'].map(h => el('th', {}, h)))),
    el('tbody', {}, rows.map((m, i) => el('tr', { class: i === 0 && m.passRate > 0 ? 'best' : null },
      el('td', {}, el('b', {}, m.model)), el('td', {}, el('span', { class: 'badge ' + (m.passRate >= 80 ? 'ok' : m.passRate >= 50 ? 'warn' : 'bad') }, m.passRate + '%')),
      el('td', {}, `${m.passed} / ${m.cases}`), el('td', {}, fmtMs(m.avgLatencyMs)), el('td', {}, fmtMs(m.p95LatencyMs)),
      el('td', {}, m.tokensPerSec ?? '—'), el('td', {}, m.errors || '—')))));
  const lookup = new Map(run.results.map(r => [r.model + '\u0000' + r.caseId, r]));
  $('#matrix').replaceChildren(
    el('thead', {}, el('tr', {}, el('th', {}, 'Case'), run.models.map(m => el('th', {}, m)))),
    el('tbody', {}, run.cases.map(c => el('tr', {}, el('td', {}, c.name), run.models.map(m => {
      const r = lookup.get(m + '\u0000' + c.id);
      if (!r) return el('td', {}, '—');
      return el('td', {}, el('button', { type: 'button', class: 'cell ' + (r.pass ? 'pass' : 'fail'), onclick: () => showOutput(c, r) },
        r.error ? 'Error' : r.pass ? '✓ Pass' : '✕ Fail', el('small', {}, r.error ? 'view details' : fmtMs(r.latencyMs))));
    })))));
}

function showOutput(c, r) {
  $('#outTitle').textContent = `${c.name} · ${r.model}`;
  $('#outChecks').replaceChildren(...(r.error ? [el('li', { class: 'fail' }, el('span', { class: 'icon' }, '✕'), el('div', {}, r.error))] :
    r.checks.map(x => el('li', { class: x.pass ? 'pass' : 'fail' }, el('span', { class: 'icon' }, x.pass ? '✓' : '✕'), el('div', {}, x.detail)))));
  $('#outText').textContent = r.error ? c.prompt : r.output || '(empty response)';
  $('#outputDialog').showModal();
}
$('#closeOut').onclick = () => $('#outputDialog').close();
$('#history').onchange = e => { viewing = e.target.value; renderResults(); };

const csvCell = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
$('#exportCsv').onclick = () => {
  const run = state.runs.find(r => r.id === viewing);
  if (!run) return;
  const names = new Map(run.cases.map(c => [c.id, c.name]));
  const lines = [['model', 'case', 'pass', 'latency_ms', 'tokens_per_sec', 'error', 'output'].join(',')]
    .concat(run.results.map(r => [r.model, names.get(r.caseId), r.pass, r.latencyMs ?? '', r.tokensPerSec ?? '', r.error ?? '', r.output ?? ''].map(csvCell).join(',')));
  download(`eval-${run.at.slice(0, 10)}.csv`, lines.join('\n'), 'text/csv');
};

$('#exportAll').onclick = () => download(`eval-workbench-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ ...state, version: 1 }, null, 2));
$('#importAllBtn').onclick = () => $('#importAll').click();
$('#importAll').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.cases) || !Array.isArray(data.runs)) throw new Error('This is not a workbench backup');
    if ((state.cases.length || state.runs.length) && !confirm('Replace your current cases and results with this backup?')) return;
    state = { ...state, cases: data.cases.map(normalizeCase), runs: data.runs.slice(0, MAX_RUNS) };
    viewing = null; await save(); renderCases(); renderResults(); toast('Backup imported');
  } catch (err) { toast(err.message); }
};

// ---------- Start ----------
state = await store.load();
$('#connForm').url.value = state.url;
resetCaseForm(); renderCases(); renderResults();
if (!store.persistent) $('#footer').textContent = 'This browser is blocking storage, so your work will be lost when you close the tab. Use Export to keep a copy.';
connect();
