import http from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

const server = http.createServer(async (req, res) => {
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
      'Content-Security-Policy': "default-src 'self'; connect-src https://api.openai.com; media-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500).end('Unable to load app');
  }
});

server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
  console.log(`Voice2Text is ready at http://127.0.0.1:${server.address().port}`);
});
