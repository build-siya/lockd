import { useEffect, useRef, useState } from 'preact/hooks';
import { sb, rpc, fmtDur, timeAgo, go, errToast, toast, VISIBLE, hasBanned } from './lib.js';
import { Avatar, Icon, SessionCard, useCommentCounts, SESSION_FIELDS } from './ui.jsx';

async function myFriendships() {
  const { data } = await sb.from('friendships').select('id,requester,addressee,status,created_at');
  return data || [];
}

export function Inbox({ me }) {
  const [rels, setRels] = useState(null);
  const [profs, setProfs] = useState({});
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const load = async () => {
    const r = await myFriendships();
    const ids = [...new Set(r.flatMap((f) => [f.requester, f.addressee]))].filter((x) => x !== me.id);
    const { data } = ids.length ? await sb.from('profiles').select('id,username,is_public').in('id', ids) : { data: [] };
    setProfs(Object.fromEntries((data || []).map((p) => [p.id, p])));
    setRels(r);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await sb.from('profiles').select('id,username,is_public').ilike('username', `${term.replace(/[%_]/g, '')}%`).neq('id', me.id).limit(10);
      setResults(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const accept = async (f) => { const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('id', f.id); if (error) errToast(error); load(); };
  const decline = async (f) => { await sb.from('friendships').delete().eq('id', f.id); load(); };
  const other = (f) => profs[f.requester === me.id ? f.addressee : f.requester];
  const incoming = (rels || []).filter((f) => f.status === 'pending' && f.addressee === me.id);
  const friends = (rels || []).filter((f) => f.status === 'accepted');
  return (
    <div class="stack">
      <h1>Friends</h1>
      <input type="search" autocapitalize="none" placeholder="Find people by username" value={q} onInput={(e) => setQ(e.target.value)} aria-label="Find people" />
      {results.map((p) => <a class="card row link" href={`#/u/${p.username}`} key={p.id}><Avatar name={p.username} size={32} /><span class="grow strong">@{p.username}</span><span class="small muted">{p.is_public ? 'Public' : 'Private'}</span></a>)}
      {incoming.length > 0 && <h2>Friend requests</h2>}
      {incoming.map((f) => other(f) && (
        <div class="card row" key={f.id}>
          <a class="row grow link" href={`#/u/${other(f).username}`}><Avatar name={other(f).username} size={32} /><span class="strong">@{other(f).username}</span></a>
          <button class="btn small" onClick={() => accept(f)}>Accept</button>
          <button class="btn small ghost" onClick={() => decline(f)}>Decline</button>
        </div>))}
      <h2>Your friends</h2>
      {rels === null ? <p class="muted">Loading…</p> : friends.length === 0 ? <p class="muted">No friends yet. Search for classmates above.</p> :
        friends.map((f) => other(f) && (
          <div class="card row" key={f.id}>
            <a class="row grow link" href={`#/u/${other(f).username}`}><Avatar name={other(f).username} size={32} /><span class="strong">@{other(f).username}</span></a>
            <a class="btn small" href={`#/chat/${other(f).username}`}><Icon name="chat" size={16} /> Message</a>
          </div>))}
    </div>
  );
}

export function UserPage({ me, username }) {
  const [p, setP] = useState(undefined);
  const [rel, setRel] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [items, setItems] = useState(null);
  const [week, setWeek] = useState(null);
  const load = async () => {
    const { data } = await sb.from('profiles').select('id,username,display_name,is_public').eq('username', username).maybeSingle();
    setP(data);
    if (!data) return;
    const r = (await myFriendships()).find((f) => [f.requester, f.addressee].includes(data.id));
    setRel(r || null);
    const { data: b } = await sb.from('blocks').select('blocked').eq('blocked', data.id);
    setBlocked(!!b?.length);
    const { data: s } = await sb.from('sessions').select(SESSION_FIELDS).eq('user_id', data.id).in('status', VISIBLE).order('posted_at', { ascending: false }).limit(20);
    setItems(s || []);
    const since = new Date(); since.setDate(since.getDate() - ((since.getDay() + 6) % 7)); since.setHours(0, 0, 0, 0);
    setWeek((s || []).filter((x) => new Date(x.posted_at) >= since).reduce((a, x) => a + x.active_seconds, 0));
  };
  useEffect(() => { load(); }, [username]);
  const [counts, reloadCounts] = useCommentCounts(items);
  if (p === undefined) return <p class="muted">Loading…</p>;
  if (!p) return <p class="muted">No user named @{username}.</p>;
  const self = p.id === me.id;
  const isFriend = rel?.status === 'accepted';
  const add = async () => { const { error } = await sb.from('friendships').insert({ requester: me.id, addressee: p.id }); if (error) errToast(/duplicate/.test(error.message) ? new Error('A request already exists.') : error); else toast('Friend request sent'); load(); };
  const accept = async () => { await sb.from('friendships').update({ status: 'accepted' }).eq('id', rel.id); load(); };
  const remove = async () => { if (!confirm(isFriend ? `Unfriend @${p.username}?` : 'Cancel request?')) return; await sb.from('friendships').delete().eq('id', rel.id); load(); };
  const block = async () => {
    if (blocked) { await sb.from('blocks').delete().eq('blocker', me.id).eq('blocked', p.id); toast('Unblocked'); }
    else {
      if (!confirm(`Block @${p.username}? They won't be able to see your posts, comment, or message you.`)) return;
      if (rel) await sb.from('friendships').delete().eq('id', rel.id);
      await sb.from('blocks').insert({ blocker: me.id, blocked: p.id }); toast('Blocked');
    }
    load();
  };
  const canSee = self || p.is_public || isFriend;
  return (
    <div class="stack">
      <div class="row">
        <Avatar name={p.username} size={64} />
        <div class="grow"><div class="h-display sm">@{p.username}</div><div class="small muted">{p.is_public ? 'Public account' : 'Private account'}{canSee && week !== null ? ` · ${fmtDur(week)} this week` : ''}</div></div>
      </div>
      {!self && (
        <div class="row wrap">
          {!rel && !blocked && <button class="btn small" onClick={add}>Add friend</button>}
          {rel?.status === 'pending' && rel.requester === me.id && <button class="btn small ghost" onClick={remove}>Requested · Cancel</button>}
          {rel?.status === 'pending' && rel.addressee === me.id && <button class="btn small" onClick={accept}>Accept request</button>}
          {isFriend && <a class="btn small" href={`#/chat/${p.username}`}>Message</a>}
          {isFriend && <button class="btn small ghost" onClick={remove}>Unfriend</button>}
          <button class="btn small ghost" onClick={block}>{blocked ? 'Unblock' : 'Block'}</button>
        </div>
      )}
      {!canSee && <div class="card"><div class="strong">This account is private</div><p class="muted">Become friends to see their lock-ins.</p></div>}
      {canSee && (items === null ? <p class="muted">Loading…</p> : items.length === 0 ? <p class="muted">No lock-ins posted yet.</p> :
        items.map((s) => <SessionCard key={s.id} s={s} me={me} commentCount={counts[s.id]} onChanged={reloadCounts} />))}
    </div>
  );
}

export function Chat({ me, username }) {
  const [p, setP] = useState(undefined);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const end = useRef(null);
  useEffect(() => { sb.from('profiles').select('id,username').eq('username', username).maybeSingle().then(({ data }) => setP(data)); }, [username]);
  const load = async () => {
    if (!p) return;
    const { data } = await sb.from('messages').select('id,sender,body,created_at')
      .or(`and(sender.eq.${me.id},recipient.eq.${p.id}),and(sender.eq.${p.id},recipient.eq.${me.id})`)
      .order('created_at', { ascending: true }).limit(200);
    setMsgs(data || []);
  };
  useEffect(() => { load(); const i = setInterval(load, 4000); return () => clearInterval(i); }, [p?.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  const send = async (e) => {
    e.preventDefault();
    const body = text.trim(); if (!body) return;
    if (hasBanned(body)) return toast("That message has a word that isn't allowed.");
    const { error } = await sb.from('messages').insert({ recipient: p.id, body });
    if (error) return toast(/row-level security/.test(error.message) ? 'You can only message friends.' : error.message);
    setText(''); load();
  };
  if (p === undefined) return <p class="muted">Loading…</p>;
  if (!p) return <p class="muted">User not found.</p>;
  return (
    <div class="chat">
      <a class="back" href="#/inbox"><Icon name="back" size={18} /> @{p.username}</a>
      <div class="msgs">
        {msgs.length === 0 && <p class="muted center-text">Say hi. Messages are between friends only.</p>}
        {msgs.map((m) => <div key={m.id} class={`msg ${m.sender === me.id ? 'mine' : ''}`}>{m.body}<span>{timeAgo(m.created_at)}</span></div>)}
        <div ref={end} />
      </div>
      <form class="row composer" onSubmit={send}>
        <input class="grow" maxLength={1000} placeholder="Message" value={text} onInput={(e) => setText(e.target.value)} aria-label="Message" />
        <button class="btn small">Send</button>
      </form>
    </div>
  );
}
