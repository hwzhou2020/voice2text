import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createKeyStore } from './key-store.js';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 25 * 1024 * 1024;

function json(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

export function createAppServer({ keyStore = createKeyStore(), transcribeFetch = fetch } = {}) {
  const server = http.createServer(async (req, res) => {
    // Reject foreign Host headers (including DNS rebinding) and cross-origin writes.
    const port = server.address().port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) {
      json(res, 403, { error: 'Local access only.' });
      return;
    }
    if (req.url?.startsWith('/api/')) {
      if (req.method !== 'GET' && (req.headers.origin !== `http://${req.headers.host}` || req.headers['x-voice2text'] !== '1')) {
        json(res, 403, { error: 'Same-origin requests only.' });
        return;
      }
      try {
        if (req.url === '/api/key' && req.method === 'GET') {
          json(res, 200, { configured: Boolean(await keyStore.get()) });
        } else if (req.url === '/api/key' && req.method === 'PUT') {
          const { key } = JSON.parse((await readBody(req, 2048)).toString());
          if (typeof key !== 'string' || !key.trim() || /[\s'"#]/.test(key.trim()) || key.length > 1024) {
            json(res, 400, { error: 'Enter a valid API key.' });
            return;
          }
          await keyStore.set(key.trim());
          json(res, 200, { configured: true });
        } else if (req.url === '/api/key' && req.method === 'DELETE') {
          await keyStore.set('');
          json(res, 200, { configured: false });
        } else if (req.url === '/api/transcribe' && req.method === 'POST') {
          const key = await keyStore.get();
          if (!key) { json(res, 401, { error: 'Save your API key first.' }); return; }
          const type = req.headers['content-type'] || '';
          if (!type.startsWith('multipart/form-data;')) { json(res, 400, { error: 'Expected recorded audio.' }); return; }
          const body = await readBody(req, MAX_BODY);
          const upstream = await transcribeFetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': type },
            body,
            signal: AbortSignal.timeout(110000),
          });
          if (!upstream.ok) { json(res, upstream.status, { error: 'OpenAI transcription failed.' }); return; }
          const result = await upstream.json();
          json(res, 200, { text: result.text });
        } else { json(res, 404, { error: 'Not found.' }); }
      } catch (error) {
        const code = error.message === 'Request too large' ? 413 : error instanceof SyntaxError ? 400 : 500;
        json(res, code, { error: code === 413 ? 'Request too large.' : 'Unable to complete request. Check the local server and try again.' });
      }
      return;
    }
    const file = files.get(req.url?.split('?')[0]);
    if (!file || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404).end('Not found');
      return;
    }
    try {
      const body = await readFile(new URL(file[0], import.meta.url));
      res.writeHead(200, {
        'Content-Type': file[1],
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'microphone=(self)',
        'Content-Security-Policy': "default-src 'self'; connect-src 'self'; media-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(500).end('Unable to load app');
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createAppServer();
  server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
    console.log(`Voice2Text is ready at http://127.0.0.1:${server.address().port}`);
  });
}
