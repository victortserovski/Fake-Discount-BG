// Supabase sync — best-effort write-through of every recorded price datapoint
// to a remote Postgres table. Local chrome.storage remains the source of truth;
// network errors here MUST NOT block the local save or the widget render.
//
// SETUP (one-time, in Supabase dashboard):
//   1. Create a project, copy Project URL + anon public key into the constants
//      below.
//   2. SQL editor — run:
//        create table public.price_history (
//          id            bigserial primary key,
//          device_id     uuid not null,
//          product_id    text not null,
//          site          text not null,
//          url           text not null,
//          title         text,
//          thumbnail     text,
//          ean           text,
//          price         numeric(10,2) not null,
//          original_price numeric(10,2),
//          discount      int,
//          observed_at   timestamptz not null default now(),
//          observed_date date not null,
//          ext_version   text,
//          user_agent    text
//        );
//        create unique index price_history_dedup_idx
//          on public.price_history (device_id, product_id, observed_date);
//        create index price_history_product_idx
//          on public.price_history (product_id, observed_date desc);
//        alter table public.price_history enable row level security;
//        create policy "anon can insert" on public.price_history
//          for insert to anon with check (true);
//   3. Add the project host to manifest.json host_permissions:
//        "https://<project>.supabase.co/*"
//   4. Reload the extension at chrome://extensions/.
//
// Until both constants are filled in, pushDatapoint() is a silent no-op.

(function () {
  'use strict';

  // === CONFIGURE THESE TWO ===
  const SUPABASE_URL = 'https://gdfsqujcjqktjhhgkxbs.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkZnNxdWpjanFrdGpoaGdreGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNjUyNzIsImV4cCI6MjA5Mzg0MTI3Mn0.zstsdOtjfoPxG3t0e6M1IpYtCEZ4ISbNgpQ31-eGNeM';
  // ===========================

  const DEVICE_ID_KEY = 'supabase_device_id';
  let cachedDeviceId = null;
  let warnedNotConfigured = false;

  function isConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  // RFC 4122 v4 UUID using crypto.getRandomValues (available in service workers).
  function generateUuid() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
    return (
      hex.slice(0, 4).join('') + '-' +
      hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' +
      hex.slice(10, 16).join('')
    );
  }

  async function getDeviceId() {
    if (cachedDeviceId) return cachedDeviceId;
    const result = await chrome.storage.local.get([DEVICE_ID_KEY]);
    if (result[DEVICE_ID_KEY]) {
      cachedDeviceId = result[DEVICE_ID_KEY];
      return cachedDeviceId;
    }
    const uuid = generateUuid();
    await chrome.storage.local.set({ [DEVICE_ID_KEY]: uuid });
    cachedDeviceId = uuid;
    return uuid;
  }

  function getExtVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (e) {
      return null;
    }
  }

  // Best-effort fire-and-forget POST. Failures are logged once and swallowed.
  async function pushDatapoint(entry) {
    if (!isConfigured()) {
      if (!warnedNotConfigured) {
        console.log('[Fake Discount] Supabase sync disabled (URL/key not set).');
        warnedNotConfigured = true;
      }
      return;
    }
    try {
      const deviceId = await getDeviceId();
      const body = {
        device_id: deviceId,
        product_id: entry.productId,
        site: entry.site,
        url: entry.url,
        title: entry.title || null,
        thumbnail: entry.thumbnail || null,
        ean: entry.ean || null,
        price: entry.price,
        original_price: typeof entry.originalPrice === 'number' ? entry.originalPrice : null,
        discount: typeof entry.discount === 'number' ? entry.discount : null,
        observed_date: entry.date,
        ext_version: getExtVersion(),
        user_agent: (typeof navigator !== 'undefined' && navigator.userAgent) || null
      };
      // PostgREST upsert requires BOTH:
      //   1. ?on_conflict=<columns> query param — tells it which unique
      //      index to use as the conflict target. Without this it defaults
      //      to the primary key (id, a bigserial that never conflicts), so
      //      same-day re-visits fall through to a plain INSERT and bounce
      //      off the price_history_dedup_idx unique constraint with 23505.
      //   2. Prefer: resolution=merge-duplicates header — tells it to do
      //      ON CONFLICT DO UPDATE (instead of DO NOTHING).
      const res = await fetch(`${SUPABASE_URL}/rest/v1/price_history?on_conflict=device_id,product_id,observed_date`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn('[Fake Discount] Supabase push failed:', res.status, text);
      }
    } catch (e) {
      console.warn('[Fake Discount] Supabase push error:', e);
    }
  }

  // Expose for the service worker. importScripts() runs in the SW global scope.
  const _scope = (typeof self !== 'undefined') ? self : globalThis;
  _scope.SupabaseSync = {
    pushDatapoint,
    getDeviceId,
    isConfigured
  };
})();
