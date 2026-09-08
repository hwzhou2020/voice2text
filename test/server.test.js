import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createKeyStore } from '../key-store.js';
import { createAppServer } from '../server.js';

function request(server, url, { method = 'GET', body = '', headers = {} } = {}) {
  const req = Readable.from([Buffer.from(body)]);
  req.url = url;
  req.method = method;
  req.headers = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'x-voice2text': '1', ...headers };
  server.address = () => ({ port: 3000 });
  return new Promise(resolve => {
    const res = {
      writeHead(code, headers) { this.code = code; this.headers = headers; return this; },
      end(body) { resolve({ code: this.code, headers: this.headers, body: body?.toString() || '' }); },
    };
    server.emit('request', req, res);
  });
}

test('key persists in .env with private permissions, preserves other variables, and can be removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'voice2text-key-'));
  try {
    const path = join(dir, '.env');
    await writeFile(path, 'OTHER_SETTING=keep\n');
    const keyStore = createKeyStore(path);
    const server = createAppServer({ keyStore });
    const saved = await request(server, '/api/key', { method: 'PUT', body: JSON.stringify({ key: 'test-secret' }) });
    assert.equal(saved.code, 200);
    assert.equal(saved.body.includes('test-secret'), false);
    assert.equal(await createKeyStore(path).get(), 'test-secret', 'A fresh store reads the persisted key');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.match(await readFile(path, 'utf8'), /OTHER_SETTING=keep/);
    assert.deepEqual(JSON.parse((await request(server, '/api/key')).body), { configured: true });
    for (const url of ['/.env', '/.env.example', '/key-store.js', '/.git/config']) {
      assert.equal((await request(server, url)).code, 404);
    }
    assert.equal((await request(server, '/api/key', { method: 'DELETE' })).code, 200);
    assert.equal(await keyStore.get(), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('server forwards audio with the saved key and returns only transcript text', async () => {
  let forwarded;
  const server = createAppServer({
    keyStore: { get: async () => 'server-secret' },
    transcribeFetch: async (url, options) => {
      forwarded = { url, ...options };
      return { ok: true, json: async () => ({ text: 'Transcribed.', extra: 'not returned' }) };
    },
  });
  const result = await request(server, '/api/transcribe', {
    method: 'POST', body: 'audio multipart data', headers: { 'content-type': 'multipart/form-data; boundary=test' },
  });
  assert.equal(result.code, 200);
  assert.deepEqual(JSON.parse(result.body), { text: 'Transcribed.' });
  assert.equal(forwarded.headers.Authorization, 'Bearer server-secret');
  assert.equal(forwarded.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(forwarded.body.toString(), 'audio multipart data');
});

test('foreign origins and hosts cannot read or modify local configuration', async () => {
  const server = createAppServer({ keyStore: { set() { assert.fail('Must not write'); } } });
  for (const headers of [{ origin: 'https://foreign.example' }, { host: 'foreign.example' }, { 'x-voice2text': undefined }]) {
    assert.equal((await request(server, '/api/key', { method: 'PUT', body: '{"key":"test"}', headers })).code, 403);
  }
  assert.equal((await request(server, '/api/key', { headers: { host: 'foreign.example' } })).code, 403);
});

test('invalid key bodies and missing keys return errors without contacting OpenAI', async () => {
  const server = createAppServer({
    keyStore: { get: async () => '', set() { assert.fail('Must not write'); } },
    transcribeFetch() { assert.fail('Must not contact OpenAI'); },
  });
  for (const body of ['{', '{}', '{"key":""}', '{"key":"secret\\nINJECTED=value"}']) {
    assert.equal((await request(server, '/api/key', { method: 'PUT', body })).code, 400);
  }
  assert.equal((await request(server, '/api/transcribe', { method: 'POST' })).code, 401);
});
