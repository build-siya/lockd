import { createClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'preact/hooks';

export const SUPABASE_URL = 'https://fsepnkvkhmkjvcdjuoow.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_W9ryJIhh8SyWoXxpaMjt6A_UCl28_ha';
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

export const VISIBLE = ['posted', 'under_review', 'verified'];

export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export function must({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
// Each captured frame = 2s of real time, played back at 0.2s => 10x.
export const FRAME_MS = 2000;
export const PLAYBACK_MS = 200;
export function fmtTL(frames) {
  const s = Math.round((frames || 0) * PLAYBACK_MS / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
export function timeAgo(iso) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'Just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 7 * 86400) return `${Math.floor(d / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
export const initials = (u = '') => u.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';

// ---- tiny hash router ----
export function useRoute() {
  const get = () => (location.hash.replace(/^#/, '') || '/feed');
  const [r, setR] = useState(get());
  useEffect(() => {
    const on = () => { setR(get()); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const go = (path) => { location.hash = path; };

// ---- toast ----
let toastSet = null;
export const bindToast = (fn) => { toastSet = fn; };
export const toast = (msg) => toastSet && toastSet(msg);
export const errToast = (e) => toast(e?.message || String(e));

// Client-side copy of the server word filter, for instant feedback.
const BANNED = ['fuck', 'shit', 'bitch', 'cunt', 'whore', 'slut', 'retard', 'kys'];
export const hasBanned = (t) => BANNED.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i').test(t || ''));
