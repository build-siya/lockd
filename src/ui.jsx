import { useEffect, useRef, useState } from 'preact/hooks';
import { sb, initials, fmtDur, fmtTL, timeAgo, rpc, errToast, toast, hasBanned, go } from './lib.js';

const P = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  bars: 'M6 20V10M12 20V4M18 20v-7',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c1-4 4-6 7-6s6 2 7 6M17 11a3 3 0 1 0 0-6M22 21c-.6-2.6-2.2-4.4-4.5-5.2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  play: 'M8 5v14l11-7z',
  back: 'M15 18l-6-6 6-6',
  x: 'M6 6l12 12M18 6L6 18',
};
export function Icon({ name, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'play' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}

export const Avatar = ({ name, size = 40 }) => <div class="avatar" style={{ width: size, height: size, fontSize: size * 0.35 }} aria-hidden="true">{initials(name)}</div>;

export function Seg({ options, value, onChange }) {
  return (
    <div class="seg" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map(([v, label]) => <button type="button" class={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  );
}

export function Sheet({ title, onClose, children }) {
  return (
    <div class="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-label={title}>
        <div class="row between"><h2>{title}</h2><button class="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}

// Signed-in-only playback: short-lived link, no download button, viewer watermark.
export function TimelapsePlayer({ path, viewer }) {
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    const { data, error } = await sb.storage.from('timelapses').createSignedUrl(path, 300);
    setBusy(false);
    if (error) return errToast(error);
    setUrl(data.signedUrl);
  };
  const marks = Array.from({ length: 6 }, (_, i) => <span key={i}>@{viewer} · do not repost</span>);
  return (
    <div class="player" onContextMenu={(e) => e.preventDefault()}>
      {url
        ? <video src={url} autoplay playsInline controls controlsList="nodownload noremoteplayback" disablePictureInPicture disableRemotePlayback />
        : <button class="play" aria-label="Play time-lapse" onClick={load} disabled={busy}><Icon name="play" size={22} /></button>}
      <div class="watermark" aria-hidden="true">{marks}</div>
      <span class="tag">10x</span>
    </div>
  );
}

const STATUS = { under_review: ['Under review', 'warn'], verified: ['Verified', 'ok'] };

export function SessionCard({ s, me, commentCount = 0, onChanged }) {
  const [sheet, setSheet] = useState(null);
  const name = s.profiles?.username || 'user';
  const st = STATUS[s.status];
  return (
    <article class="card">
      <div class="row">
        <a href={`#/u/${name}`} class="row grow link"><Avatar name={name} />
          <div class="grow"><div class="strong">@{name}</div><div class="small muted">{timeAgo(s.posted_at)}</div></div>
        </a>
        {st && <span class={`badge ${st[1]}`}>{st[0]}</span>}
      </div>
      {s.video_path && <TimelapsePlayer path={s.video_path} viewer={me.username} />}
      <div class="row wrap">
        <span class="chip">{s.subject}</span>
        <span class="strong">Locked in {fmtDur(s.active_seconds)}</span>
        <span class="small muted">· {fmtTL(s.frame_count)} time-lapse</span>
      </div>
      {s.caption && <p class="caption">{s.caption}</p>}
      <div class="row">
        <button class="btn small ghost grow" onClick={() => setSheet('comments')}><Icon name="chat" size={18} /> {commentCount || ''} Comments</button>
        {s.user_id !== me.id && <button class="btn small ghost grow" onClick={() => setSheet('report')}><Icon name="flag" size={18} /> Report</button>}
      </div>
      {sheet === 'comments' && <Comments s={s} me={me} onClose={() => { setSheet(null); onChanged && onChanged(); }} />}
      {sheet === 'report' && <Report s={s} onClose={() => setSheet(null)} onDone={onChanged} />}
    </article>
  );
}

function Comments({ s, me, onClose }) {
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const load = async () => {
    const { data } = await sb.from('comments').select('id,body,created_at,user_id,profiles(username)').eq('session_id', s.id).order('created_at');
    setList(data || []);
  };
  useEffect(() => { load(); }, []);
  const send = async (e) => {
    e.preventDefault();
    const body = text.trim(); if (!body) return;
    if (hasBanned(body)) return toast("That comment has a word that isn't allowed.");
    const { error } = await sb.from('comments').insert({ session_id: s.id, body });
    if (error) return toast(/row-level security/.test(error.message) ? "You can't comment on this post." : error.message);
    setText(''); load();
  };
  const del = async (id) => { await sb.from('comments').delete().eq('id', id); load(); };
  return (
    <Sheet title="Comments" onClose={onClose}>
      <div class="list">
        {list === null ? <p class="muted">Loading…</p> : list.length === 0 ? <p class="muted">No comments yet.</p> :
          list.map((c) => (
            <div class="comment" key={c.id}>
              <div><a class="strong" href={`#/u/${c.profiles?.username}`}>@{c.profiles?.username}</a> <span class="small muted">{timeAgo(c.created_at)}</span></div>
              <div>{c.body}</div>
              {(c.user_id === me.id || s.user_id === me.id) && <button class="link-btn small" onClick={() => del(c.id)}>Delete</button>}
            </div>))}
      </div>
      <form class="row" onSubmit={send}>
        <input class="grow" maxLength={300} placeholder="Add a comment" value={text} onInput={(e) => setText(e.target.value)} aria-label="Comment" />
        <button class="btn small">Post</button>
      </form>
    </Sheet>
  );
}

function Report({ s, onClose, onDone }) {
  const [reason, setReason] = useState('not_studying');
  const [note, setNote] = useState('');
  const send = async () => {
    const { error } = await sb.from('reports').insert({ session_id: s.id, reason, note: note.trim() || null });
    if (error) return toast(/duplicate/.test(error.message) ? 'You already reported this session.' : error.message);
    toast('Reported. The footage will be reviewed.'); onClose(); onDone && onDone();
  };
  return (
    <Sheet title="Report this session" onClose={onClose}>
      <Seg value={reason} onChange={setReason} options={[['not_studying', 'Not studying'], ['inappropriate', 'Inappropriate'], ['other', 'Other']]} />
      <label class="field">Details (optional)<textarea maxLength={300} rows={3} value={note} onInput={(e) => setNote(e.target.value)} /></label>
      <button class="btn" onClick={send}>Send report</button>
    </Sheet>
  );
}

export function useCommentCounts(sessions) {
  const [counts, setCounts] = useState({});
  const key = (sessions || []).map((s) => s.id).join(',');
  const load = async () => {
    if (!sessions?.length) return setCounts({});
    const { data } = await sb.from('comments').select('session_id').in('session_id', sessions.map((s) => s.id));
    const c = {}; (data || []).forEach((r) => { c[r.session_id] = (c[r.session_id] || 0) + 1; });
    setCounts(c);
  };
  useEffect(() => { load(); }, [key]);
  return [counts, load];
}

export const SESSION_FIELDS = 'id,user_id,subject,status,active_seconds,frame_count,video_path,caption,posted_at,profiles(username,is_public)';
