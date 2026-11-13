import { useEffect, useState } from 'preact/hooks';
import { sb, rpc, fmtDur, go, errToast, toast, must } from './lib.js';
import { Seg, Avatar, Icon } from './ui.jsx';

function Board({ rows }) {
  if (!rows) return <p class="muted">Loading…</p>;
  if (!rows.length) return <p class="muted">No hours logged yet this week.</p>;
  return (
    <ol class="board">
      {rows.map((r) => (
        <li key={r.user_id} class={r.is_me ? 'me' : ''}>
          <span class="rank">#{r.rank}</span>
          <a class="row grow link" href={`#/u/${r.username}`}><Avatar name={r.username} size={32} /><span class="strong">@{r.username}</span></a>
          <span class="strong">{fmtDur(r.seconds)}</span>
        </li>
      ))}
    </ol>
  );
}

export function Ranks({ me, tab = 'global' }) {
  const [rows, setRows] = useState(null);
  const [groups, setGroups] = useState(null);
  const [name, setName] = useState('');
  useEffect(() => {
    setRows(null);
    if (tab === 'global' && me.is_public) rpc('leaderboard_global').then(setRows).catch(errToast);
    if (tab === 'friends') rpc('leaderboard_friends').then(setRows).catch(errToast);
    if (tab === 'groups') loadGroups();
  }, [tab, me.is_public]);
  const loadGroups = async () => {
    const { data } = await sb.from('groups').select('id,name,owner').order('created_at', { ascending: false });
    setGroups(data || []);
  };
  const create = async (e) => {
    e.preventDefault();
    try {
      const g = must(await sb.from('groups').insert({ name: name.trim(), owner: me.id }).select().single());
      setName(''); go(`/group/${g.id}`);
    } catch (err) { errToast(err); }
  };
  return (
    <div class="stack">
      <h1>Leaderboards</h1>
      <Seg value={tab} onChange={(v) => go(`/ranks/${v}`)} options={[['global', 'Global'], ['friends', 'Friends'], ['groups', 'Groups']]} />
      <p class="small muted">This week (resets Monday). Removed sessions don't count.</p>
      {tab === 'global' && !me.is_public && (
        <div class="card">
          <div class="strong">Your account is private</div>
          <p class="muted">Private accounts compete with friends only. Switch to public to join the global board and create groups.</p>
          <a class="btn small" href="#/me">Go to settings</a>
        </div>
      )}
      {(tab === 'friends' || (tab === 'global' && me.is_public)) && <Board rows={rows} />}
      {tab === 'groups' && (
        <>
          {me.is_public ? (
            <form class="row" onSubmit={create}>
              <input class="grow" required minLength={2} maxLength={40} placeholder="New group name" value={name} onInput={(e) => setName(e.target.value)} aria-label="New group name" />
              <button class="btn small">Create</button>
            </form>
          ) : <p class="muted">Only public accounts can create groups.</p>}
          {groups === null ? <p class="muted">Loading…</p> : groups.length === 0 ? <p class="muted">No groups yet. Create one and add your friends.</p> :
            groups.map((g) => <a class="card row link" href={`#/group/${g.id}`} key={g.id}><span class="grow strong">{g.name}</span><span class="small muted">{g.owner === me.id ? 'Owner' : 'Member'}</span></a>)}
        </>
      )}
    </div>
  );
}

export function GroupPage({ me, id }) {
  const [g, setG] = useState(undefined);
  const [rows, setRows] = useState(null);
  const [friends, setFriends] = useState([]);
  const load = async () => {
    const { data } = await sb.from('groups').select('id,name,owner').eq('id', id).maybeSingle();
    setG(data);
    if (!data) return;
    rpc('leaderboard_group', { p_group: id }).then(setRows).catch(errToast);
    if (data.owner === me.id) {
      const { data: fr } = await sb.from('friendships').select('requester,addressee').eq('status', 'accepted');
      const ids = (fr || []).map((f) => (f.requester === me.id ? f.addressee : f.requester));
      const { data: members } = await sb.from('group_members').select('user_id').eq('group_id', id);
      const inGroup = new Set((members || []).map((m) => m.user_id));
      const { data: profs } = ids.length ? await sb.from('profiles').select('id,username,is_public').in('id', ids) : { data: [] };
      setFriends((profs || []).filter((p) => p.is_public && !inGroup.has(p.id)));
    }
  };
  useEffect(() => { load(); }, [id]);
  if (g === undefined) return <p class="muted">Loading…</p>;
  if (!g) return <p class="muted">Group not found.</p>;
  const owner = g.owner === me.id;
  const add = async (uid) => { const { error } = await sb.from('group_members').insert({ group_id: id, user_id: uid }); if (error) errToast(error); else { toast('Added'); load(); } };
  const leave = async () => {
    if (owner) { if (!confirm('Delete this group for everyone?')) return; await sb.from('groups').delete().eq('id', id); }
    else { if (!confirm('Leave this group?')) return; await sb.from('group_members').delete().eq('group_id', id).eq('user_id', me.id); }
    go('/ranks/groups');
  };
  return (
    <div class="stack">
      <a class="back" href="#/ranks/groups"><Icon name="back" size={18} /> Groups</a>
      <h1>{g.name}</h1>
      <p class="small muted">This week's hours. Only public members appear.</p>
      <Board rows={rows} />
      {owner && (
        <div class="card">
          <div class="strong">Add friends</div>
          {friends.length === 0 ? <p class="small muted">Public friends you can add will show here.</p> :
            friends.map((f) => <div class="row" key={f.id}><Avatar name={f.username} size={32} /><span class="grow">@{f.username}</span><button class="btn small" onClick={() => add(f.id)}>Add</button></div>)}
        </div>
      )}
      <button class="link-btn danger" onClick={leave}>{owner ? 'Delete group' : 'Leave group'}</button>
    </div>
  );
}
