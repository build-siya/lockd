import { useEffect, useState } from 'preact/hooks';
import { sb, rpc, useRoute, go, bindToast, errToast } from './lib.js';
import { subscribe, liveSeconds } from './recorder.js';
import { fmtClock } from './lib.js';
import { Feed } from './Feed.jsx';
import { Record } from './Record.jsx';
import { Ranks, GroupPage } from './Ranks.jsx';
import { Inbox, Chat, UserPage } from './Social.jsx';
import { Me, Admin, Terms } from './Me.jsx';
import { Icon } from './ui.jsx';

export function App() {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(undefined);
  const [toastMsg, setToastMsg] = useState('');
  const route = useRoute();

  useEffect(() => {
    let t;
    bindToast((m) => { setToastMsg(m); clearTimeout(t); t = setTimeout(() => setToastMsg(''), 3200); });
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadMe = async () => {
    if (!session) { setMe(null); return; }
    const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    setMe(data || null);
  };
  useEffect(() => { loadMe(); }, [session?.user?.id]);

  const parts = route.split('/').filter(Boolean);
  const toastEl = toastMsg && <div class="toast" role="status">{toastMsg}</div>;

  if (parts[0] === 'terms') return <div class="app"><Terms />{toastEl}</div>;
  if (session === undefined || (session && me === undefined)) return <div class="app center"><div class="brand big">Lockd</div></div>;
  if (!session) return <div class="app"><Auth />{toastEl}</div>;
  if (!me) return <div class="app"><Onboarding onDone={loadMe} />{toastEl}</div>;

  let screen;
  switch (parts[0]) {
    case 'record': screen = <Record me={me} />; break;
    case 'ranks': screen = <Ranks me={me} tab={parts[1]} />; break;
    case 'group': screen = <GroupPage me={me} id={parts[1]} />; break;
    case 'inbox': screen = <Inbox me={me} />; break;
    case 'chat': screen = <Chat me={me} username={parts[1]} />; break;
    case 'u': screen = <UserPage me={me} username={parts[1]} />; break;
    case 'me': screen = <Me me={me} reload={loadMe} />; break;
    case 'admin': screen = <Admin me={me} />; break;
    default: screen = <Feed me={me} tab={parts[1]} />;
  }
  const tab = parts[0] || 'feed';
  return (
    <div class="app">
      <header class="top">
        <a class="brand" href="#/feed">Lockd</a>
        <RecordingPill hidden={tab === 'record'} />
      </header>
      <main class="main">{screen}</main>
      {toastEl}
      <nav class="tabs" aria-label="Main">
        <a href="#/feed" class={tab === 'feed' ? 'on' : ''}><Icon name="home" />Feed</a>
        <a href="#/ranks" class={tab === 'ranks' || tab === 'group' ? 'on' : ''}><Icon name="bars" />Ranks</a>
        <a href="#/record" class="rec" aria-label="Record a lock-in"><span><i></i></span></a>
        <a href="#/inbox" class={['inbox', 'chat', 'u'].includes(tab) ? 'on' : ''}><Icon name="people" />Friends</a>
        <a href="#/me" class={tab === 'me' || tab === 'admin' ? 'on' : ''}><Icon name="user" />Me</a>
      </nav>
    </div>
  );
}

function RecordingPill({ hidden }) {
  const [st, setSt] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => subscribe(setSt), []);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  if (hidden || !st || !['live', 'check', 'paused'].includes(st.phase)) return null;
  return <a class="pill live" href="#/record">{st.phase === 'paused' ? 'Paused' : 'Locked in'} · {fmtClock(liveSeconds())}</a>;
}

function Auth() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) setSent(true);
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      }
    } catch (err) { errToast(err); } finally { setBusy(false); }
  };
  if (sent) return (
    <div class="page narrow">
      <div class="brand big">Lockd</div>
      <h1>Check your email</h1>
      <p class="muted">We sent a confirmation link to {email}. Open it on this phone to finish signing up.</p>
      <button class="btn ghost" onClick={() => { setSent(false); setMode('signin'); }}>Back to sign in</button>
    </div>
  );
  return (
    <form class="page narrow" onSubmit={submit}>
      <div class="brand big">Lockd</div>
      <p class="lead">Lock in. Prove it. Climb the board.</p>
      <label class="field">Email<input type="email" required autocomplete="email" value={email} onInput={(e) => setEmail(e.target.value)} /></label>
      <label class="field">Password<input type="password" required minLength={8} autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} value={pw} onInput={(e) => setPw(e.target.value)} /></label>
      <button class="btn" disabled={busy}>{mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      <button type="button" class="btn ghost" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>
        {mode === 'signup' ? 'I already have an account' : 'New here? Create an account'}
      </button>
      <p class="fine">Lockd is for ages 13 and up. <a href="#/terms">Terms &amp; privacy</a></p>
    </form>
  );
}

function Onboarding({ onDone }) {
  const [username, setUsername] = useState('');
  const [birth, setBirth] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!agree) return errToast('Please agree to the Terms to continue.');
    setBusy(true);
    try { await rpc('create_profile', { p_username: username.trim().toLowerCase(), p_birthdate: birth }); await onDone(); }
    catch (err) {
      if (/at least 13/.test(err.message)) { await sb.auth.signOut(); }
      errToast(err);
    } finally { setBusy(false); }
  };
  return (
    <form class="page narrow" onSubmit={submit}>
      <div class="brand big">Lockd</div>
      <h1>Set up your profile</h1>
      <label class="field">Username<input required pattern="[a-zA-Z0-9._]{3,20}" maxLength={20} autocapitalize="none" placeholder="e.g. maya.locks" value={username} onInput={(e) => setUsername(e.target.value)} /></label>
      <p class="fine">3–20 characters: letters, numbers, dots, underscores. Don't use your full real name.</p>
      <label class="field">Birthdate<input type="date" required value={birth} onInput={(e) => setBirth(e.target.value)} /></label>
      <p class="fine">You must be 13 or older. Your birthdate is private and never shown.</p>
      <label class="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree to the <a href="#/terms">Terms of Service and Privacy Policy</a></label>
      <button class="btn" disabled={busy}>Start locking in</button>
      <button type="button" class="btn ghost" onClick={() => sb.auth.signOut()}>Sign out</button>
    </form>
  );
}
