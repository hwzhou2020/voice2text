const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'voice2text.openai-api-key';
const MAX_BYTES = 24 * 1024 * 1024;
let apiKey = '';
let phase = 'idle';
let recorder;
let stream;
let timer;
let audio;
let startedAt;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function updateKey() {
  $('key-indicator').textContent = apiKey ? '●' : '○';
  $('remove-key').disabled = !apiKey;
}

function setPhase(next) {
  phase = next;
  const busy = next !== 'idle';
  const recording = next === 'recording';
  $('record').disabled = next === 'requesting' || next === 'transcribing' || next === 'stopping';
  $('record').classList.toggle('recording', recording);
  $('record-label').textContent = recording ? 'Stop & transcribe' : next === 'transcribing' ? 'Transcribing…' : next === 'requesting' ? 'Opening microphone…' : next === 'stopping' ? 'Finishing…' : 'Start recording';
  $('record-symbol').textContent = recording ? '■' : '●';
  $('wave').classList.toggle('active', recording);
  $('record-title').textContent = recording ? 'Listening to you' : next === 'transcribing' ? 'Finding your words' : 'A thought starts here';
  $('record-hint').textContent = recording ? 'Take your time. Stop when you’re ready.' : 'Tap record, speak naturally, then stop to transcribe.';
  $('retry').hidden = !audio || busy;
  $('key-form').querySelectorAll('input, button').forEach((el) => { el.disabled = busy; });
  if (!busy) updateKey();
}

function releaseMicrophone() {
  clearInterval(timer);
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
}

function stopRecording() {
  if (recorder?.state === 'recording') {
    setPhase('stopping');
    recorder.stop();
    releaseMicrophone();
  }
}

async function startRecording() {
  if (!apiKey) {
    $('settings').hidden = false;
    $('settings-toggle').setAttribute('aria-expanded', 'true');
    $('api-key').focus();
    status('Save your OpenAI API key first.', true);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    status('Recording is unavailable. Use a browser with microphone support on localhost or HTTPS.', true);
    return;
  }
  setPhase('requesting');
  status('Allow microphone access in your browser.');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('unsupported');
    recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
    const chunks = [];
    let bytes = 0;
    let failed = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size) { chunks.push(event.data); bytes += event.data.size; }
      if (bytes >= MAX_BYTES) stopRecording();
    };
    recorder.onerror = () => {
      failed = true;
      releaseMicrophone();
      setPhase('idle');
      status('Recording failed. Please try again.', true);
    };
    recorder.onstop = () => {
      releaseMicrophone();
      if (failed) return;
      audio = new Blob(chunks, { type: mimeType });
      void transcribe();
    };
    recorder.start(1000);
    audio = undefined;
    startedAt = Date.now();
    $('timer').textContent = '00:00';
    timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      if (seconds >= 300) stopRecording();
    }, 250);
    setPhase('recording');
    status('Recording. Your transcript will be ready after you stop.');
  } catch (error) {
    releaseMicrophone();
    setPhase('idle');
    status(error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow access in your browser and try again.' : error.name === 'NotFoundError' ? 'No microphone found. Connect a microphone and try again.' : 'Could not start recording. Check your microphone and browser audio support.', true);
  }
}

async function transcribe() {
  if (!audio || !audio.size || audio.size > MAX_BYTES) {
    audio = undefined;
    setPhase('idle');
    status('The recording is empty or too large. Please record a shorter clip.', true);
    return;
  }
  if (!apiKey) { status('Save your API key before retrying.', true); return; }
  setPhase('transcribing');
  status('Transcribing with OpenAI…');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const body = new FormData();
    body.append('file', audio, audio.type.includes('mp4') ? 'recording.mp4' : 'recording.webm');
    body.append('model', 'gpt-transcribe');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body, signal: controller.signal,
    });
    if (!response.ok) {
      const messages = { 401: 'Your API key was rejected. Update it and retry.', 403: 'This API key cannot access the transcription model.', 429: 'OpenAI quota or rate limit reached. Check your API billing or retry later.', 413: 'The recording is too large. Try a shorter recording.' };
      throw new Error(messages[response.status] || `OpenAI could not transcribe this recording (HTTP ${response.status}). Please retry.`);
    }
    const result = await response.json();
    if (typeof result.text !== 'string') throw new Error('OpenAI returned an unexpected response. Please retry.');
    const text = result.text.trim();
    if (text) $('transcript').value = [$('transcript').value.trimEnd(), text].filter(Boolean).join('\n\n');
    audio = undefined;
    updateTranscript();
    status(text ? 'Transcription ready. Edit it or copy it anywhere.' : 'No speech was detected. Try recording again.');
  } catch (error) {
    status(error.name === 'AbortError' ? 'The request timed out. Your recording is available to retry.' : error instanceof TypeError ? 'Could not reach OpenAI. Check your connection and retry.' : error.message, true);
  } finally {
    clearTimeout(timeout);
    setPhase('idle');
  }
}

function updateTranscript() {
  const text = $('transcript').value.trim();
  const count = text ? text.split(/\s+/u).length : 0;
  $('word-count').textContent = `${count} ${count === 1 ? 'word' : 'words'}`;
  $('copy').disabled = !text;
  $('clear').disabled = !text;
  $('copy').textContent = 'Copy text';
}

$('settings-toggle').addEventListener('click', () => {
  $('settings').hidden = !$('settings').hidden;
  $('settings-toggle').setAttribute('aria-expanded', String(!$('settings').hidden));
});
$('key-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('api-key').value.trim();
  if (!value) return;
  apiKey = value;
  try {
    localStorage.setItem(STORAGE_KEY, apiKey);
    $('key-status').textContent = 'Key saved in this browser.';
  } catch {
    $('key-status').textContent = 'Browser storage is unavailable. Your key will work for this session only.';
  }
  $('api-key').value = '';
  updateKey();
  status('Ready when you are. Start a recording.');
});
$('remove-key').addEventListener('click', () => {
  try { localStorage.removeItem(STORAGE_KEY); }
  catch { $('key-status').textContent = 'Could not remove the saved key. Clear this site’s data in your browser settings.'; return; }
  apiKey = '';
  $('api-key').value = '';
  $('key-status').textContent = 'Saved key removed.';
  updateKey();
  status('Add your API key to get started.');
});
$('record').addEventListener('click', () => {
  if (phase === 'recording') stopRecording();
  else if (phase === 'idle') void startRecording();
});
$('retry').addEventListener('click', () => { if (phase === 'idle') void transcribe(); });
$('transcript').addEventListener('input', updateTranscript);
$('clear').addEventListener('click', () => { $('transcript').value = ''; updateTranscript(); });
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('transcript').value);
    $('copy').textContent = 'Copied!';
    status('Transcript copied to clipboard.');
  } catch {
    $('transcript').focus();
    $('transcript').select();
    status('Clipboard access is unavailable. Your text is selected; press Cmd+C or Ctrl+C to copy.');
  }
});
window.addEventListener('beforeunload', (event) => {
  if (phase !== 'idle' || audio || $('transcript').value.trim()) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', releaseMicrophone);
try {
  apiKey = localStorage.getItem(STORAGE_KEY) || '';
} catch {
  $('key-status').textContent = 'Browser storage is unavailable. Keys can only be kept for this session.';
}
updateKey();
if (apiKey) status('Ready when you are. Start a recording.');
