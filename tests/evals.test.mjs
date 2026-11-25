import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAssertion, scoreCase, summarize, parseCases, listModels, generate } from '../docs/lib/evals.js';

test('assertions pass and fail as expected', () => {
  assert.equal(checkAssertion('Paris is the capital', { type: 'contains', value: 'paris' }).pass, true);
  assert.equal(checkAssertion('Paris', { type: 'not_contains', value: 'London' }).pass, true);
  assert.equal(checkAssertion('Order 1234', { type: 'regex', value: '\\d{4}' }).pass, true);
  assert.equal(checkAssertion('x', { type: 'regex', value: '(' }).pass, false);
  assert.equal(checkAssertion('```json\n{"a":1}\n```', { type: 'json' }).pass, true);
  assert.equal(checkAssertion('{a:1}', { type: 'json' }).pass, false);
  assert.equal(checkAssertion('one two three', { type: 'max_words', value: '2' }).pass, false);
  assert.equal(checkAssertion(' yes ', { type: 'equals', value: 'yes' }).pass, true);
});

test('a case passes only when every check passes', () => {
  const s = scoreCase('{"ok":true}', [{ type: 'json' }, { type: 'contains', value: 'false' }]);
  assert.equal(s.pass, false);
  assert.equal(s.passed, 1);
});

test('summarizes models by pass rate then latency', () => {
  const rows = summarize([
    { model: 'a', pass: true, latencyMs: 100, tokensPerSec: 20 },
    { model: 'a', pass: false, latencyMs: 300, tokensPerSec: 30 },
    { model: 'b', pass: true, latencyMs: 500 },
    { model: 'b', error: 'boom' },
  ]);
  assert.equal(rows[0].model, 'a');
  assert.equal(rows[0].avgLatencyMs, 200);
  assert.equal(rows[0].tokensPerSec, 25);
  assert.equal(rows[1].errors, 1);
  assert.equal(rows[1].passRate, 50);
});

test('imports cases from CSV and JSON', () => {
  const csv = parseCases('name,prompt,type,value\nCap,"Capital of France, one word",contains,Paris\nCap,"Capital of France, one word",max_words,3\n');
  assert.equal(csv.length, 1);
  assert.equal(csv[0].assertions.length, 2);
  assert.equal(csv[0].prompt, 'Capital of France, one word');
  const json = parseCases('[{"name":"J","prompt":"Return JSON","assertions":[{"type":"json"}]}]');
  assert.equal(json[0].assertions[0].type, 'json');
  assert.throws(() => parseCases('[{"name":"x","prompt":"p","assertions":[{"type":"magic"}]}]'), /unknown check/);
});

test('talks to the Ollama API shape', async () => {
  const fake = async (url, init) => {
    if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b', size: 1, details: { family: 'llama', parameter_size: '3B' } }] }));
    const body = JSON.parse(init.body);
    assert.equal(body.stream, false);
    return new Response(JSON.stringify({ response: 'Paris', eval_count: 50, eval_duration: 2e9 }));
  };
  const models = await listModels('http://localhost:11434', fake);
  assert.equal(models[0].params, '3B');
  const r = await generate('http://localhost:11434', { model: 'llama3.2:3b', prompt: 'hi' }, fake);
  assert.equal(r.output, 'Paris');
  assert.equal(r.tokensPerSec, 25);
});

test('scores only the final answer from reasoning models', async () => {
  const fake = async () => new Response(JSON.stringify({ response: '<think>maybe 42?</think>\n\n17:05' }));
  const r = await generate('http://localhost:11434', { model: 'm', prompt: 'p' }, fake);
  assert.equal(r.output, '17:05');
});
