// Lockd recorder: captures one frame every 2s from the camera, blurs people,
// encodes a 10x time-lapse MP4 on the phone, and keeps the server clock alive with heartbeats.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { rpc, sb, FRAME_MS, PLAYBACK_MS } from './lib.js';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';
const BEAT_MS = 30000;
const CHECK_WINDOW_MS = 60000;
const FAST = /[?&]fast=1/.test(location.search) || /fast=1/.test(location.hash);

const S = {
  phase: 'idle', // idle | starting | live | check | paused | finishing | ready | uploading
  status: '', error: '', pauseReason: '',
  sessionId: null, subject: '', blur: true,
  frames: 0, activeSeconds: 0, gapSeconds: 0, gapCount: 0, lastBeatAt: 0,
  checkDeadline: 0, checksTotal: 0, checksPassed: 0,
  blob: null, blobUrl: null, stream: null,
};
const subs = new Set();
const emit = () => subs.forEach((f) => f({ ...S }));
export const subscribe = (f) => { subs.add(f); f({ ...S }); return () => subs.delete(f); };
export const getState = () => ({ ...S });
const set = (patch) => { Object.assign(S, patch); emit(); };

let video, canvas, ctx, tmp, tiny, detector, encoder, muxer, target, W, H;
let captureT, beatT, checkT, checkTimeoutT, wakeLock;

export const supported = () => !!(navigator.mediaDevices?.getUserMedia && window.VideoEncoder && window.VideoFrame);

async function loadDetector() {
  if (detector) return detector;
  const { ObjectDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe', document.baseURI).href);
  detector = await ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    scoreThreshold: 0.3, categoryAllowlist: ['person'], runningMode: 'IMAGE', maxResults: 6,
  });
  return detector;
}

async function pickCodec(width, height) {
  for (const codec of ['avc1.42001f', 'avc1.4d001f', 'avc1.640028']) {
    const cfg = { codec, width, height, bitrate: 350_000, framerate: 1000 / PLAYBACK_MS, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch { /* try next */ }
  }
  throw new Error("This browser can't make time-lapse videos. Update to the latest Safari or Chrome.");
}

function pixelate(x, y, w, h) {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.min(W - x, Math.ceil(w)); h = Math.min(H - y, Math.ceil(h));
  if (w <= 0 || h <= 0) return;
  const tw = Math.max(1, Math.round(w / 14)), th = Math.max(1, Math.round(h / 14));
  tiny.width = tw; tiny.height = th;
  const tctx = tiny.getContext('2d');
  tctx.drawImage(tmp, x, y, w, h, 0, 0, tw, th);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, 0, 0, tw, th, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

function captureFrame() {
  if (!(S.phase === 'live' || S.phase === 'check') || !video.videoWidth) return;
  ctx.drawImage(video, 0, 0, W, H);
  if (S.blur && detector) {
    try {
      const res = detector.detect(canvas);
      if (res.detections.length) {
        tmp.getContext('2d').drawImage(canvas, 0, 0);
        for (const d of res.detections) {
          const b = d.boundingBox, px = b.width * 0.12, py = b.height * 0.12;
          pixelate(b.originX - px, b.originY - py, b.width + 2 * px, b.height + 2 * py);
        }
      }
    } catch { /* never let a detector hiccup stop recording */ }
  }
  const i = S.frames;
  const frame = new VideoFrame(canvas, { timestamp: i * PLAYBACK_MS * 1000, duration: PLAYBACK_MS * 1000 });
  encoder.encode(frame, { keyFrame: i % 50 === 0 });
  frame.close();
  set({ frames: i + 1 });
}

async function beat() {
  try {
    const r = await rpc('heartbeat', { p_session: S.sessionId, p_frames: S.frames });
    const row = Array.isArray(r) ? r[0] : r;
    set({ activeSeconds: row.active_seconds, gapSeconds: row.gap_seconds, gapCount: row.gap_count, lastBeatAt: Date.now() });
  } catch (e) { set({ status: 'Connection issue — your time is saved when it reconnects.' }); }
}

function scheduleCheck() {
  clearTimeout(checkT);
  const delay = FAST ? 25000 + Math.random() * 20000 : (15 + Math.random() * 20) * 60000;
  checkT = setTimeout(() => {
    if (S.phase !== 'live') return;
    set({ phase: 'check', checkDeadline: Date.now() + CHECK_WINDOW_MS });
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
    checkTimeoutT = setTimeout(async () => {
      if (S.phase !== 'check') return;
      set({ checksTotal: S.checksTotal + 1 });
      rpc('record_check', { p_session: S.sessionId, p_passed: false }).catch(() => {});
      pause('You missed the "Still there?" check, so the clock stopped.');
    }, CHECK_WINDOW_MS);
  }, delay);
}

export async function confirmPresent() {
  if (S.phase !== 'check') return;
  clearTimeout(checkTimeoutT);
  set({ phase: 'live', checksTotal: S.checksTotal + 1, checksPassed: S.checksPassed + 1 });
  rpc('record_check', { p_session: S.sessionId, p_passed: true }).catch(() => {});
  scheduleCheck();
}

function stopTimers() { clearInterval(captureT); clearInterval(beatT); clearTimeout(checkT); clearTimeout(checkTimeoutT); }
function startTimers() {
  stopTimers();
  captureT = setInterval(captureFrame, FRAME_MS);
  beatT = setInterval(beat, BEAT_MS);
  scheduleCheck();
}

async function pause(reason) {
  if (!(S.phase === 'live' || S.phase === 'check')) return;
  stopTimers();
  set({ phase: 'paused', pauseReason: reason });
  rpc('pause_session', { p_session: S.sessionId }).catch(() => {});
}

export async function resume() {
  if (S.phase !== 'paused') return;
  const track = S.stream?.getVideoTracks()[0];
  if (!track || track.readyState !== 'live') { set({ error: 'The camera stopped. End this session and start a new one.' }); return; }
  set({ phase: 'live', pauseReason: '' });
  await beat(); // the server counts the pause as a gap
  startTimers();
  requestWake();
}

async function requestWake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
}

function onVisibility() {
  if (document.hidden) pause('You left Lockd, so the clock stopped. Keep Lockd open while you lock in.');
  else if (S.phase === 'paused') requestWake();
}

export async function start({ subject, blur }) {
  if (!supported()) { set({ error: "This browser can't record lock-ins. Use the latest Safari (iPhone) or Chrome." }); return; }
  set({ phase: 'starting', status: 'Starting camera…', error: '', subject, blur, frames: 0, activeSeconds: 0, gapSeconds: 0, gapCount: 0, checksTotal: 0, checksPassed: 0, blob: null });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    S.stream = stream;
    video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');
    video.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0';
    document.body.appendChild(video);
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
    const scale = 480 / Math.max(video.videoWidth, video.videoHeight);
    W = Math.round(video.videoWidth * scale / 2) * 2; H = Math.round(video.videoHeight * scale / 2) * 2;
    canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d', { willReadFrequently: false });
    tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
    tiny = document.createElement('canvas');
    if (blur) { set({ status: 'Loading auto-blur…' }); await loadDetector(); }
    const cfg = await pickCodec(W, H);
    target = new ArrayBufferTarget();
    muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => set({ error: 'Video error: ' + e.message }) });
    encoder.configure(cfg);
    set({ status: 'Starting session…' });
    const id = await rpc('start_session', { p_subject: subject, p_blurred: blur });
    set({ sessionId: id, phase: 'live', status: '', lastBeatAt: Date.now() });
    stream.getVideoTracks()[0].addEventListener('ended', () => pause('The camera stopped.'));
    document.addEventListener('visibilitychange', onVisibility);
    captureFrame();
    startTimers();
    requestWake();
  } catch (e) {
    cleanup();
    const msg = e?.name === 'NotAllowedError' ? 'Lockd needs camera access to record your lock-in. Allow it in your browser settings.' : (e?.message || String(e));
    set({ phase: 'idle', status: '', error: msg });
  }
}

function cleanup() {
  stopTimers();
  document.removeEventListener('visibilitychange', onVisibility);
  try { wakeLock?.release(); } catch { /* ignore */ }
  S.stream?.getTracks().forEach((t) => t.stop());
  video?.remove();
  S.stream = null;
}

export async function finish() {
  if (!['live', 'check', 'paused'].includes(S.phase)) return;
  stopTimers();
  set({ phase: 'finishing', status: 'Making your time-lapse…' });
  try {
    await encoder.flush(); encoder.close();
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    const row = await rpc('finish_session', { p_session: S.sessionId, p_frames: S.frames });
    cleanup();
    set({ phase: 'ready', status: '', blob, blobUrl: URL.createObjectURL(blob), activeSeconds: row.active_seconds, gapSeconds: row.gap_seconds, gapCount: row.gap_count });
  } catch (e) {
    cleanup();
    set({ phase: 'idle', status: '', error: 'Could not finish the session: ' + (e?.message || e) });
  }
}

export async function post(caption) {
  if (S.phase !== 'ready') return;
  const { data: { user } } = await sb.auth.getUser();
  const path = `${user.id}/${S.sessionId}.mp4`;
  set({ phase: 'uploading', status: 'Uploading your time-lapse…', error: '' });
  try {
    const up = await sb.storage.from('timelapses').upload(path, S.blob, { contentType: 'video/mp4', upsert: true });
    if (up.error) throw new Error(up.error.message);
    await rpc('post_session', { p_session: S.sessionId, p_video_path: path, p_caption: caption || null });
    reset();
    return true;
  } catch (e) {
    set({ phase: 'ready', status: '', error: e?.message || String(e) });
    return false;
  }
}

export async function discard() {
  const id = S.sessionId;
  if (['live', 'check', 'paused'].includes(S.phase)) { try { encoder.close(); } catch { /* ignore */ } cleanup(); }
  if (id) rpc('discard_session', { p_session: id }).catch(() => {});
  reset();
}

function reset() {
  if (S.blobUrl) URL.revokeObjectURL(S.blobUrl);
  set({ phase: 'idle', status: '', error: '', pauseReason: '', sessionId: null, frames: 0, activeSeconds: 0, gapSeconds: 0, gapCount: 0, blob: null, blobUrl: null, checksTotal: 0, checksPassed: 0 });
}

export const clearError = () => set({ error: '' });
export const liveSeconds = () => S.activeSeconds + ((S.phase === 'live' || S.phase === 'check') && S.lastBeatAt ? Math.min(75, (Date.now() - S.lastBeatAt) / 1000) : 0);
