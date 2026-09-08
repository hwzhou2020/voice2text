import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');

async function setup({ savedKey = 'test-key', browserKey = '', denied = false, storageBlocked = false, response } = {}) {
  const elements = new Map();
  const storage = new Map(browserKey ? [['voice2text.openai-api-key', browserKey]] : []);
  const requests = [];
  let stopped = false;
  let copied;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: true, textContent: '', disabled: false,
      classList: { toggle() {} }, setAttribute() {}, focus() {}, select() { this.selected = true; },
      querySelectorAll() { return []; }, listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
    });
    return elements.get(id);
  }
  class Recorder {
    static isTypeSupported(type) { return type.includes('webm'); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: new Blob(['recorded audio']) });
      queueMicrotask(() => this.onstop());
    }
  }
  const context = vm.createContext({
    document: { getElementById: element },
    window: { MediaRecorder: Recorder, addEventListener() {} }, MediaRecorder: Recorder,
    navigator: {
      mediaDevices: { async getUserMedia() {
        if (denied) { const error = new Error(); error.name = 'NotAllowedError'; throw error; }
        return { getTracks: () => [{ stop() { stopped = true; } }] };
      } },
      clipboard: { async writeText(text) { copied = text; } },
    },
    localStorage: {
      getItem: (key) => { if (storageBlocked) throw new Error(); return storage.get(key); },
      setItem: (key, value) => { if (storageBlocked) throw new Error(); storage.set(key, value); },
      removeItem: (key) => storage.delete(key),
    },
    async fetch(url, options) {
      if (url === '/api/key') {
        if (options?.method === 'PUT') savedKey = JSON.parse(options.body).key;
        if (options?.method === 'DELETE') savedKey = '';
        return { ok: true, json: async () => ({ configured: Boolean(savedKey) }) };
      }
      requests.push({ url, ...options });
      return response ? response() : { ok: true, json: async () => ({ text: 'Hello from your voice.' }) };
    },
    Blob, FormData, AbortController, setTimeout, clearTimeout, Date,
    setInterval: () => 1, clearInterval() {},
  });
  vm.runInContext(source, context);
  await vm.runInContext('ready', context);
  return { element, storage, requests, context, stopped: () => stopped, copied: () => copied,
    async click(id, event = {}) { await element(id).listeners.click(event); await new Promise(setImmediate); },
  };
}

test('record → transcribe → append → edit → copy, releasing microphone', async () => {
  const app = await setup();
  app.element('transcript').value = 'Existing notes.';
  await app.click('record');
  assert.equal(app.element('record-label').textContent, 'Stop & transcribe');
  assert.equal(app.requests.length, 0, 'No audio sent before stopping');
  await app.click('record');
  assert.equal(app.stopped(), true);
  assert.equal(app.requests.length, 1);
  const request = app.requests[0];
  assert.equal(request.url, '/api/transcribe');
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.headers['X-Voice2Text'], '1');
  assert.equal(request.body.get('model'), 'gpt-transcribe');
  assert.equal(request.body.get('file').name, 'recording.webm');
  assert.equal(app.element('transcript').value, 'Existing notes.\n\nHello from your voice.');
  app.element('transcript').value = 'Edited transcript';
  app.element('transcript').listeners.input();
  await app.click('copy');
  assert.equal(app.copied(), 'Edited transcript');
  assert.equal(app.element('word-count').textContent, '2 words');
  await app.click('clear');
  assert.equal(app.element('copy').disabled, true);
});

test('missing key opens settings; saved key persists and can be removed', async () => {
  const app = await setup({ savedKey: '' });
  await app.click('record');
  assert.equal(app.element('settings').hidden, false);
  assert.equal(app.requests.length, 0);
  app.element('api-key').value = '  new-key  ';
  await app.element('key-form').listeners.submit({ preventDefault() {} });
  assert.match(app.element('key-status').textContent, /saved in .env/);
  assert.equal(app.storage.size, 0);
  assert.equal(app.element('api-key').value, '');
  await app.click('remove-key');
  assert.equal(app.storage.size, 0);
});

test('permission denial restores controls without sending audio', async () => {
  const app = await setup({ denied: true });
  await app.click('record');
  assert.match(app.element('status').textContent, /denied/);
  assert.equal(app.element('record').disabled, false);
  assert.equal(app.requests.length, 0);
});

test('failed API request preserves existing text and permits manual retry', async () => {
  let attempts = 0;
  const app = await setup({ response: () => ++attempts === 1
    ? { ok: false, status: 401 }
    : { ok: true, json: async () => ({ text: 'Recovered.' }) } });
  app.element('transcript').value = 'Keep this.';
  await app.click('record');
  await app.click('record');
  assert.match(app.element('status').textContent, /key was rejected/);
  assert.equal(app.element('transcript').value, 'Keep this.');
  assert.equal(app.element('retry').hidden, false);
  await app.click('retry');
  assert.equal(app.element('transcript').value, 'Keep this.\n\nRecovered.');
  assert.equal(app.element('retry').hidden, true);
});

test('key saving and recording work without browser storage', async () => {
  const app = await setup({ savedKey: '', storageBlocked: true });
  app.element('api-key').value = 'session-key';
  await app.element('key-form').listeners.submit({ preventDefault() {} });
  assert.match(app.element('key-status').textContent, /saved in .env/);
  await app.click('record');
  await app.click('record');
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].headers.Authorization, undefined);
});

test('clipboard failure selects text for manual copying', async () => {
  const app = await setup();
  vm.runInContext('navigator.clipboard.writeText = async () => { throw new Error(); }', app.context);
  app.element('transcript').value = 'Copy me';
  await app.click('copy');
  assert.equal(app.element('transcript').selected, true);
  assert.match(app.element('status').textContent, /Cmd\+C/);
});

test('previous browser key migrates only after successful save', async () => {
  const app = await setup({ savedKey: '', browserKey: 'old-browser-key' });
  assert.equal(app.element('api-key').value, 'old-browser-key');
  assert.equal(app.element('settings').hidden, false);
  assert.equal(app.storage.size, 1);
  await app.element('key-form').listeners.submit({ preventDefault() {} });
  assert.equal(app.storage.size, 0);
  assert.match(app.element('key-status').textContent, /saved in .env/);
});
