import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function setup({ savedKey = 'test-key', denied = false, storageBlocked = false, response } = {}) {
  const elements = new Map();
  const storage = new Map(savedKey ? [['voice2text.openai-api-key', savedKey]] : []);
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
      getItem: (key) => storage.get(key),
      setItem: (key, value) => { if (storageBlocked) throw new Error(); storage.set(key, value); },
      removeItem: (key) => storage.delete(key),
    },
    async fetch(url, options) {
      requests.push({ url, ...options });
      return response ? response() : { ok: true, json: async () => ({ text: 'Hello from your voice.' }) };
    },
    Blob, FormData, AbortController, setTimeout, clearTimeout, Date,
    setInterval: () => 1, clearInterval() {},
  });
  vm.runInContext(source, context);
  return { element, storage, requests, context, stopped: () => stopped, copied: () => copied,
    async click(id, event = {}) { await element(id).listeners.click(event); await new Promise(setImmediate); },
  };
}

test('record → transcribe → append → edit → copy, releasing microphone', async () => {
  const app = setup();
  app.element('transcript').value = 'Existing notes.';
  await app.click('record');
  assert.equal(app.element('record-label').textContent, 'Stop & transcribe');
  assert.equal(app.requests.length, 0, 'No audio sent before stopping');
  await app.click('record');
  assert.equal(app.stopped(), true);
  assert.equal(app.requests.length, 1);
  const request = app.requests[0];
  assert.equal(request.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(request.headers.Authorization, 'Bearer test-key');
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
  const app = setup({ savedKey: '' });
  await app.click('record');
  assert.equal(app.element('settings').hidden, false);
  assert.equal(app.requests.length, 0);
  app.element('api-key').value = '  new-key  ';
  app.element('key-form').listeners.submit({ preventDefault() {} });
  assert.equal(app.storage.get('voice2text.openai-api-key'), 'new-key');
  assert.equal(app.element('api-key').value, '');
  await app.click('remove-key');
  assert.equal(app.storage.size, 0);
});

test('permission denial restores controls without sending audio', async () => {
  const app = setup({ denied: true });
  await app.click('record');
  assert.match(app.element('status').textContent, /denied/);
  assert.equal(app.element('record').disabled, false);
  assert.equal(app.requests.length, 0);
});

test('failed API request preserves existing text and permits manual retry', async () => {
  let attempts = 0;
  const app = setup({ response: () => ++attempts === 1
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

test('unavailable storage keeps key usable for session and explains limitation', async () => {
  const app = setup({ savedKey: '', storageBlocked: true });
  app.element('api-key').value = 'session-key';
  app.element('key-form').listeners.submit({ preventDefault() {} });
  assert.match(app.element('key-status').textContent, /session only/);
  await app.click('record');
  await app.click('record');
  assert.equal(app.requests[0].headers.Authorization, 'Bearer session-key');
});

test('clipboard failure selects text for manual copying', async () => {
  const app = setup();
  vm.runInContext('navigator.clipboard.writeText = async () => { throw new Error(); }', app.context);
  app.element('transcript').value = 'Copy me';
  await app.click('copy');
  assert.equal(app.element('transcript').selected, true);
  assert.match(app.element('status').textContent, /Cmd\+C/);
});
