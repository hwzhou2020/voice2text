# Voice2Text

A small, dependency-free web app that records your microphone, transcribes with OpenAI’s `gpt-transcribe` model, and gives you editable text with one-click copying.

## Run locally

Requires Node.js 18 or newer. No install or build step is needed.

```sh
npm start
```

Open **http://127.0.0.1:3000**, click **API key**, paste your own OpenAI API key, and click **Save key**. You only need to do this once: the local server saves it in `.env` in this repo, which Git ignores. The same saved key works across browser sessions and server restarts. Allow microphone access, record, and click **Stop & transcribe**. New recordings append to your transcript. Edit or copy the text as needed. Use `PORT=3001 npm start` to change the port.

Alternatively, create `.env` manually (see `.env.example`):

```dotenv
OPENAI_API_KEY=your-api-key-here
```

On macOS/Linux, run `chmod 600 .env` after creating the file manually. The app sets these owner-only permissions automatically when saving from the UI. No server restart is needed after changing the key. **Remove** clears the key from the file. If you used the earlier browser-storage version, the app fills in that key and offers to save it to `.env`; a successful save removes the browser copy.

An OpenAI API account with billing and access to `gpt-transcribe` is required. API usage is billed by OpenAI separately from ChatGPT. See the [official transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text).

## Storage and privacy

- The API key is stored in a git-ignored `.env` file on your computer. It is not encrypted. Saving through the UI sets owner-only file permissions on macOS/Linux. `.env.example` contains no secret and can be committed.
- The browser sends recorded audio to the local server. The server reads the saved key and forwards the audio to `https://api.openai.com/v1/audio/transcriptions` over HTTPS. The key is never returned to the browser. The local server does not log the key or save audio/transcripts to disk.
- The server listens only on `127.0.0.1`, validates Host and Origin headers for writes, and serves only explicitly allowed app files. `.env` cannot be downloaded through the server.
- Audio and transcripts are kept in page memory only and are lost on reload. Failed requests retain the recording for a manual retry. Starting another recording replaces the retained audio.
- This is a personal local app. Do not embed a shared API key in it. There are no third-party scripts, analytics, or CDN assets.

## Behavior

Use a browser supporting MediaRecorder with WebM or MP4 audio (modern Chrome, Edge, Firefox, or Safari). Microphone access requires localhost or HTTPS. The recorder stops automatically at five minutes and rejects audio over 24 MiB. Transcription begins after recording stops; it is not live dictation. Network, permission, authentication, and quota errors appear in the app. If clipboard access fails, the app selects the transcript for manual copying.

## Checks

```sh
npm test
```
