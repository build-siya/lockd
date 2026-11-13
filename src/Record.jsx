import { useEffect, useRef, useState } from 'preact/hooks';
import * as R from './recorder.js';
import { fmtClock, fmtDur, fmtTL, toast, go } from './lib.js';

const SUBJECTS = ['AP Gov', 'AP Bio', 'SAT / ACT', 'Math', 'English', 'History', 'Mock Trial', 'Debate'];

export function Record({ me }) {
  const [st, setSt] = useState(R.getState());
  const [, tick] = useState(0);
  const [subject, setSubject] = useState('');
  const [custom, setCustom] = useState('');
  const [blur, setBlur] = useState(me.blur_default);
  const [caption, setCaption] = useState('');
  const preview = useRef(null);

  useEffect(() => R.subscribe(setSt), []);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  useEffect(() => {
    if (preview.current && st.stream && preview.current.srcObject !== st.stream) {
      preview.current.srcObject = st.stream; preview.current.play().catch(() => {});
    }
  });

  const subj = subject === 'Other' ? custom.trim() : subject;
  const live = ['live', 'check', 'paused'].includes(st.phase);

  if (st.phase === 'idle' || st.phase === 'starting') return (
    <div class="stack">
      <h1>Start a lock-in</h1>
      {st.error && <div class="alert" role="alert">{st.error} <button class="link-btn" onClick={R.clearError}>Dismiss</button></div>}
      <div class="frame-guide">
        <svg width="120" height="80" viewBox="0 0 150 100" fill="none" stroke="#C6F432" stroke-width="2" stroke-dasharray="6 5" aria-hidden="true"><rect x="20" y="10" width="110" height="68" rx="6" /><path d="M8 88h134" /></svg>
        <strong>Prop your phone behind you</strong>
        <span class="small muted">Point it at your screen. Keep your face and your room out of the shot. Keep Lockd open the whole time.</span>
      </div>
      <div class="small muted">What are you locking in on?</div>
      <div class="row wrap">
        {[...SUBJECTS, 'Other'].map((x) => <button type="button" class={`pill-btn ${subject === x ? 'on' : ''}`} aria-pressed={subject === x} onClick={() => setSubject(x)}>{x}</button>)}
      </div>
      {subject === 'Other' && <input maxLength={40} placeholder="Subject" value={custom} onInput={(e) => setCustom(e.target.value)} aria-label="Subject" />}
      <div class="setting">
        <div class="grow"><div class="strong">Auto-blur people</div><div class="small muted">People in the shot are blurred on your phone before anything uploads.</div></div>
        <button type="button" class={`switch ${blur ? 'on' : ''}`} role="switch" aria-checked={blur} aria-label="Auto-blur people" onClick={() => setBlur(!blur)}><span /></button>
      </div>
      <button class="btn big" disabled={!subj || st.phase === 'starting'} onClick={() => R.start({ subject: subj, blur })}>
        {st.phase === 'starting' ? st.status : 'Start recording'}
      </button>
      <p class="fine">Your time is measured by Lockd's server clock, not the video length. Random "Still there?" checks keep it honest.</p>
    </div>
  );

  if (live) {
    const secs = R.liveSeconds();
    return (
      <div class="stack">
        <div class="row"><span class={`dot ${st.phase === 'paused' ? 'off' : ''}`} /><span class="strong caps">{st.phase === 'paused' ? 'Paused' : 'Locked in'} · {st.subject}</span></div>
        <div class="preview">
          <video ref={preview} muted playsInline autoplay />
          <span class="tag left">{st.blur ? 'Auto-blur on' : 'Auto-blur off'}</span>
          <span class="tag bottom">{st.frames} frames · 1 every 2 sec</span>
        </div>
        <div class="clock">{fmtClock(secs)}</div>
        <div class="grid2">
          <div class="stat"><div class="small muted">Time-lapse (10x)</div><div class="strong">{fmtTL(st.frames)}</div></div>
          <div class="stat"><div class="small muted">Gaps</div><div class="strong">{st.gapCount}{st.gapSeconds ? ` · ${fmtDur(st.gapSeconds)}` : ''}</div></div>
        </div>
        {st.status && <p class="small muted">{st.status}</p>}
        {st.error && <div class="alert" role="alert">{st.error}</div>}
        {st.phase === 'paused' && (
          <div class="alert">
            <div>{st.pauseReason}</div>
            <button class="btn" onClick={R.resume}>Resume</button>
          </div>
        )}
        <button class="btn outline big" onClick={R.finish}>End session</button>
        <button class="link-btn muted" onClick={() => { if (confirm('Discard this session? Nothing will be posted.')) R.discard(); }}>Discard session</button>
        {st.phase === 'check' && (
          <div class="overlay">
            <div class="dialog" role="alertdialog" aria-label="Still there?">
              <div class="h-display">Still there?</div>
              <p class="muted">Tap within {Math.max(0, Math.ceil((st.checkDeadline - Date.now()) / 1000))} seconds or the clock stops.</p>
              <button class="btn big" onClick={R.confirmPresent}>I'm here</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (st.phase === 'finishing' || st.phase === 'uploading') return <div class="stack center-text"><div class="spinner" /><p>{st.status}</p></div>;

  // ready
  const doPost = async () => {
    const ok = await R.post(caption.trim());
    if (ok) { toast('Posted. Your hours are on the board.'); setCaption(''); go('/feed/friends'); }
  };
  return (
    <div class="stack">
      <h1>Session complete</h1>
      <div class="card">
        <div class="small muted">{st.subject}</div>
        <div class="h-display">{fmtDur(st.activeSeconds)}</div>
        <div class="grid2">
          <div><div class="small muted">Time-lapse (10x)</div><div class="strong">{fmtTL(st.frames)}</div></div>
          <div><div class="small muted">Presence checks</div><div class="strong">{st.checksPassed}/{st.checksTotal} passed</div></div>
          <div><div class="small muted">Gaps not counted</div><div class="strong">{st.gapCount ? fmtDur(st.gapSeconds) : 'None'}</div></div>
          <div><div class="small muted">Visible to</div><div class="strong">{me.is_public ? 'Everyone (public)' : 'Friends only'}</div></div>
        </div>
      </div>
      {st.blobUrl && <video class="review" src={st.blobUrl} controls playsInline muted />}
      {st.error && <div class="alert" role="alert">{st.error}</div>}
      <input maxLength={200} placeholder="Add a caption (optional)" value={caption} onInput={(e) => setCaption(e.target.value)} aria-label="Caption" />
      <button class="btn big" onClick={doPost}>Post lock-in</button>
      <button class="link-btn muted" onClick={() => { if (confirm('Discard this session?')) R.discard(); }}>Discard</button>
    </div>
  );
}
