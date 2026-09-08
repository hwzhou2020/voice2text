import { readFile, writeFile, chmod } from 'node:fs/promises';

export function createKeyStore(path = new URL('.env', import.meta.url)) {
  async function read() {
    try { return await readFile(path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  }
  return {
    async get() {
      const match = (await read()).match(/^OPENAI_API_KEY\s*=\s*(.*?)\s*$/m);
      return match ? match[1].replace(/^(['"])(.*)\1$/, '$2') : '';
    },
    async set(key) {
      if (typeof key !== 'string' || /[\s'"#]/.test(key) || key.length > 1024) {
        throw new Error('Invalid API key');
      }
      const previous = await read();
      const otherLines = previous.split('\n').filter(line => !/^OPENAI_API_KEY\s*=/.test(line));
      const content = otherLines.join('\n').trimEnd();
      await writeFile(path, `${content ? content + '\n' : ''}OPENAI_API_KEY=${key}\n`, { mode: 0o600 });
      await chmod(path, 0o600);
    },
  };
}
