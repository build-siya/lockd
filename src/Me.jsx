import { useEffect, useState } from 'preact/hooks';
import { sb, rpc, fmtDur, fmtTL, timeAgo, errToast, toast, VISIBLE } from './lib.js';
import { Avatar, Seg, SessionCard, TimelapsePlayer, useCommentCounts, SESSION_FIELDS, Icon } from './ui.jsx';

export function Me({ me, reload }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    sb.from('sessions').select(SESSION_FIELDS).eq('user_id', me.id).in('status', [...VISIBLE, 'removed']).order('posted_at', { ascending: false }).limit(30)
      .then(({ data }) => setItems(data || []));
  }, []);
  const [counts, reloadCounts] = useCommentCounts(items);
  const save = async (patch) => {
    const { error } = await sb.from('profiles').update(patch).eq('id', me.id);
    if (error) return errToast(error);
    await reload(); toast('Saved');
  };
  return (
    <div class="stack">
      <div class="row"><Avatar name={me.username} size={64} /><div><div class="h-display sm">@{me.username}</div><div class="small muted">{me.is_public ? 'Public account' : 'Private account'}</div></div></div>

      <section class="card">
        <div class="strong">Account</div>
        <Seg value={me.is_public} onChange={(v) => save({ is_public: v })} options={[[true, 'Public'], [false, 'Private']]} />
        <p class="small muted">{me.is_public
          ? 'Public: you compete on the global board, can create groups, and anyone signed in can watch your time-lapses.'
          : 'Private: only friends see your lock-ins, and you compete on the friends board.'}</p>
      </section>

      <section class="card setting">
        <div class="grow"><div class="strong">Auto-blur people (default)</div><div class="small muted">Applied on your phone before upload. Recommended on.</div></div>
        <button type="button" class={`switch ${me.blur_default ? 'on' : ''}`} role="switch" aria-checked={me.blur_default} aria-label="Auto-blur default" onClick={() => save({ blur_default: !me.blur_default })}><span /></button>
      </section>

      <section class="card">
        <div class="strong">Who can comment</div>
        <Seg value={me.comment_setting} onChange={(v) => save({ comment_setting: v })} options={[['everyone', 'Everyone'], ['friends', 'Friends only']]} />
        <p class="small muted">A word filter is always on. You can delete comments on your posts and block anyone.</p>
      </section>

      <section class="card list-rows">
        <div class="row between"><span>Direct messages</span><span class="muted">Friends only</span></div>
        <div class="row between"><span>Location data</span><span class="muted">Never collected</span></div>
        <div class="row between"><span>Video downloads</span><span class="muted">Off · watermarked</span></div>
      </section>

      {me.is_admin && <a class="btn outline" href="#/admin">Open review queue</a>}

      <h2>Your lock-ins</h2>
      {items === null ? <p class="muted">Loading…</p> : items.length === 0 ? <p class="muted">Nothing posted yet.</p> :
        items.map((s) => s.status === 'removed'
          ? <div class="card" key={s.id}><span class="badge bad">Removed after review</span><div class="small muted">{s.subject} · {fmtDur(s.active_seconds)} · {timeAgo(s.posted_at)}</div></div>
          : <SessionCard key={s.id} s={s} me={me} commentCount={counts[s.id]} onChanged={reloadCounts} />)}

      <a class="link-btn" href="#/terms">Terms &amp; privacy</a>
      <button class="btn ghost" onClick={() => sb.auth.signOut()}>Sign out</button>
    </div>
  );
}

export function Admin({ me }) {
  const [q, setQ] = useState(null);
  const load = () => rpc('admin_queue').then(setQ).catch((e) => { errToast(e); setQ([]); });
  useEffect(() => { if (me.is_admin) load(); }, []);
  if (!me.is_admin) return <p class="muted">Admins only.</p>;
  const decide = async (id, d) => {
    try { await rpc('resolve_session', { p_session: id, p_decision: d }); toast(d === 'verify' ? 'Marked verified' : 'Removed from feed and leaderboards'); load(); }
    catch (e) { errToast(e); }
  };
  const label = { not_studying: 'Not studying', inappropriate: 'Inappropriate', other: 'Other' };
  return (
    <div class="stack">
      <h1>Review queue</h1>
      <p class="small muted">Reported sessions only. Watch the time-lapse, then verify or remove. Removed sessions stop counting on every leaderboard.</p>
      {q === null ? <p class="muted">Loading…</p> : q.length === 0 ? <p class="muted">Nothing to review.</p> :
        q.map((s) => (
          <article class="card" key={s.session_id}>
            <div class="row between"><a class="strong" href={`#/u/${s.username}`}>@{s.username}</a><span class="badge warn">{s.report_count} report{s.report_count > 1 ? 's' : ''}</span></div>
            <div class="small">{s.reasons.map((r) => label[r] || r).join(', ')}</div>
            {s.notes?.length > 0 && <ul class="small muted">{s.notes.map((n) => <li>{n}</li>)}</ul>}
            {s.video_path && <TimelapsePlayer path={s.video_path} viewer={me.username} />}
            <div class="grid2 small">
              <div>Subject: <b>{s.subject}</b></div>
              <div>Logged: <b>{fmtDur(s.active_seconds)}</b></div>
              <div>Gaps: <b>{s.gap_count} ({fmtDur(s.gap_seconds)})</b></div>
              <div>Checks: <b>{s.checks_passed}/{s.checks_total}</b></div>
            </div>
            <div class="row">
              <button class="btn small grow" onClick={() => decide(s.session_id, 'verify')}>Verify</button>
              <button class="btn small danger grow" onClick={() => decide(s.session_id, 'remove')}>Remove</button>
            </div>
          </article>))}
    </div>
  );
}

export function Terms() {
  return (
    <div class="page prose">
      <a class="back" href="javascript:history.back()"><Icon name="back" size={18} /> Back</a>
      <h1>Lockd Terms of Service &amp; Privacy Policy</h1>
      <p class="alert">DRAFT for the pilot. Have a lawyer review this before a public launch.</p>
      <h2>Who can use Lockd</h2>
      <p>You must be at least 13 years old. If you are under 18, you confirm a parent or guardian knows you use Lockd and agrees to these terms. We do not knowingly collect information from children under 13; if we learn we have, we delete it.</p>
      <h2>How recording works</h2>
      <p>To log a lock-in you record yourself from behind, facing your screen, from start to finish. Lockd saves one frame every two seconds and turns it into a 10x time-lapse. Your time is measured by Lockd's server from start and end timestamps; gaps where the camera stops, the app closes, or a "Still there?" check is missed do not count.</p>
      <p>Keep your face, other people, and anything private (addresses, messages, passwords, ID cards) out of the shot. Auto-blur is on by default and blurs people on your phone before upload, but it is automated and can miss things. You are responsible for what you record and post.</p>
      <h2>Content rules</h2>
      <p>No nudity or sexual content, violence, harassment, hate, illegal activity, or recordings of people who haven't agreed to be filmed. No faking study time. Reported sessions are reviewed, and sessions that break the rules are removed and stop counting on leaderboards. Accounts that repeatedly break the rules may be suspended.</p>
      <h2>Public and private accounts</h2>
      <p>Public accounts' lock-ins can be watched by anyone signed in to Lockd and appear on the global leaderboard. Private accounts' lock-ins are visible to friends only. Videos can't be downloaded in the app and show the viewer's username as a watermark. Do not screen-record or repost other people's lock-ins.</p>
      <h2>Comments and messages</h2>
      <p>Public accounts can receive comments; you can limit comments to friends. Direct messages are only allowed between friends. You can block anyone.</p>
      <h2>Privacy</h2>
      <p>We store your email, username, birthdate (private, used only to confirm you are 13+), your lock-in time-lapses, and your activity in the app. We never collect location data. We do not sell your information. You can ask us to delete your account and data at any time by contacting [CONTACT EMAIL].</p>
      <h2>Limits of responsibility</h2>
      <p>Lockd is provided "as is." Users are responsible for the content they record and post. To the extent the law allows, Lockd is not liable for content posted by users or for how others use the app. Nothing in these terms limits rights you have under applicable law, including privacy laws that protect minors.</p>
      <h2>Contact</h2>
      <p>[COMPANY NAME] LLC · [CONTACT EMAIL]</p>
    </div>
  );
}
