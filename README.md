# Voice2Text

A small, dependency-free web app that records your microphone, transcribes with OpenAI’s `gpt-transcribe` model, and gives you editable text with one-click copying.

## Run locally

Requires Node.js 18 or newer. No install or build step is needed.

```sh
npm start
```

Open **http://127.0.0.1:3000**, click **API key**, paste your own OpenAI API key, and click **Save key**. Allow microphone access, record, and click **Stop & transcribe**. New recordings append to your transcript. Edit or copy the text as needed. Use `PORT=3001 npm start` to change the port.

An OpenAI API account with billing and access to `gpt-transcribe` is required. API usage is billed by OpenAI separately from ChatGPT. See the [official transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text).

## Storage and privacy

- The API key is saved in this browser’s `localStorage`, scoped to the app’s address. It persists across reloads; **Remove** deletes it. Local storage is not encrypted, so use a trusted device and browser profile.
- The browser sends the key and recorded audio directly to `https://api.openai.com/v1/audio/transcriptions` over HTTPS. The local server only serves the three app files; it does not receive keys, audio, or transcripts.
- Audio and transcripts are kept in page memory only and are lost on reload. Failed requests retain the recording for a manual retry. Starting another recording replaces the retained audio.
- This is a personal local app. Do not embed a shared API key in it. There are no third-party scripts, analytics, or CDN assets.

## Behavior

Use a browser supporting MediaRecorder with WebM or MP4 audio (modern Chrome, Edge, Firefox, or Safari). Microphone access requires localhost or HTTPS. The recorder stops automatically at five minutes and rejects audio over 24 MiB. Transcription begins after recording stops; it is not live dictation. Network, permission, authentication, and quota errors appear in the app. If clipboard access fails, the app selects the transcript for manual copying.

## Checks

```sh
npm test
```
