import { useEffect, useState } from 'preact/hooks';
import { sb, VISIBLE, go } from './lib.js';
import { Seg, SessionCard, useCommentCounts, SESSION_FIELDS } from './ui.jsx';

export function Feed({ me, tab = 'friends' }) {
  const [items, setItems] = useState(null);
  const load = async () => {
    setItems(null);
    let q = sb.from('sessions').select(SESSION_FIELDS).in('status', VISIBLE).order('posted_at', { ascending: false }).limit(40);
    if (tab === 'friends') {
      const { data: fr } = await sb.from('friendships').select('requester,addressee').eq('status', 'accepted');
      const ids = [me.id, ...(fr || []).map((f) => (f.requester === me.id ? f.addressee : f.requester))];
      q = q.in('user_id', ids);
    }
    const { data } = await q;
    setItems(data || []);
  };
  useEffect(() => { load(); }, [tab]);
  const [counts, reloadCounts] = useCommentCounts(items);
  return (
    <div class="stack">
      <Seg value={tab} onChange={(v) => go(`/feed/${v}`)} options={[['friends', 'Friends'], ['discover', 'Discover']]} />
      {items === null && <p class="muted center-text">Loading…</p>}
      {items?.length === 0 && (
        <div class="empty">
          <h2>{tab === 'friends' ? 'Nothing here yet' : 'No public lock-ins yet'}</h2>
          <p class="muted">{tab === 'friends' ? 'Record your first lock-in or add friends to fill your feed.' : 'Be the first to post one.'}</p>
          <a class="btn" href="#/record">Start a lock-in</a>
        </div>
      )}
      {items?.map((s) => <SessionCard key={s.id} s={s} me={me} commentCount={counts[s.id]} onChanged={() => { reloadCounts(); }} />)}
    </div>
  );
}
