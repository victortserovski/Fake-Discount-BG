// Best-effort write-only RPC ingestion. Deploy supabase/ingestion.sql first.
// Local history remains authoritative; never fall back to direct table writes.
(function () {
  'use strict';
  const SUPABASE_URL = 'https://gdfsqujcjqktjhhgkxbs.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkZnNxdWpjanFrdGpoaGdreGJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNjUyNzIsImV4cCI6MjA5Mzg0MTI3Mn0.zstsdOtjfoPxG3t0e6M1IpYtCEZ4ISbNgpQ31-eGNeM';
  let identityPromise = null;
  let lastObservationTime = 0;
  let queueWrites = Promise.resolve();
  let flushPromise = null;
  const PENDING_PREFIX = 'sync_pending_';

  function withQueueLock(operation) {
    const pending = queueWrites.then(operation);
    queueWrites = pending.catch(() => {});
    return pending;
  }

  function isConfigured() { return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY); }

  function getIdentity() {
    if (!identityPromise) {
      identityPromise = (async () => {
        const result = await chrome.storage.local.get(['supabase_identity']);
        if (result.supabase_identity) return result.supabase_identity;
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const secret = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
        const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
        const deviceId = [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
        const identity = { deviceId, secret };
        // Retain supabase_device_id for deletion requests concerning old uploads.
        await chrome.storage.local.set({ supabase_identity: identity });
        return identity;
      })().catch(error => { identityPromise = null; throw error; });
    }
    return identityPromise;
  }

  async function getDeviceId() { return (await getIdentity()).deviceId; }

  async function pushDatapoint(entry) {
    if (!isConfigured()) return;
    // Assigned before any await so concurrent calls retain observation order.
    lastObservationTime = Math.max(Date.now(), lastObservationTime + 1);
    const observedAt = new Date(lastObservationTime).toISOString();
    try {
      const url = new URL(entry.url);
      url.search = '';
      url.hash = '';
      const payload = {
        product_id: entry.productId, site: entry.site, url: url.href,
        title: entry.title || null, thumbnail: entry.thumbnail || null, ean: entry.ean || null,
        price: entry.price, original_price: entry.originalPrice ?? null, discount: entry.discount ?? null,
        observed_date: entry.date, client_observed_at: observedAt,
        ext_version: chrome.runtime.getManifest().version,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null
      };
      await withQueueLock(async () => {
        const saved = await chrome.storage.local.get(['supabase_last_observation']);
        lastObservationTime = Math.max(Date.parse(observedAt), (saved.supabase_last_observation || 0) + 1);
        payload.client_observed_at = new Date(lastObservationTime).toISOString();
        const key = PENDING_PREFIX + entry.productId + ':' + entry.date;
        await chrome.storage.local.set({ [key]: payload, supabase_last_observation: lastObservationTime });
      });
      await flushPending();
    } catch (error) {
      console.warn('[Fake Discount] Secure upload unavailable:', error.message);
    }
  }

  function flushPending() {
    if (!isConfigured()) return Promise.resolve();
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      const identity = await getIdentity();
      const pending = await withQueueLock(async () => {
        const data = await chrome.storage.local.get(null);
        return Object.entries(data).filter(([key]) => key.startsWith(PENDING_PREFIX))
          .sort((a, b) => (a[1]._lastAttempt || 0) - (b[1]._lastAttempt || 0));
      });
      // Bound each worker run; keep rejected entries without blocking later ones.
      for (const [key, payload] of pending.slice(0, 20)) {
        const observation = { ...payload };
        delete observation._lastAttempt;
        const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/ingest_price_observation', {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ installation_secret: identity.secret, observation }),
          signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) {
          if (res.status >= 500 || res.status === 429 || res.status === 408) throw new Error('HTTP ' + res.status);
          console.warn('[Fake Discount] Observation remains queued:', res.status);
          await withQueueLock(async () => {
            const current = (await chrome.storage.local.get([key]))[key];
            if (current?.client_observed_at === payload.client_observed_at) {
              await chrome.storage.local.set({ [key]: { ...current, _lastAttempt: Date.now() } });
            }
          });
          continue;
        }
        await withQueueLock(async () => {
          const current = (await chrome.storage.local.get([key]))[key];
          // A newer visit may have replaced this queued day during the request.
          if (current?.client_observed_at === payload.client_observed_at) await chrome.storage.local.remove([key]);
        });
      }
    })().catch(error => console.warn('[Fake Discount] Upload remains queued:', error.message))
      .finally(() => { flushPromise = null; });
    return flushPromise;
  }

  const scope = typeof self !== 'undefined' ? self : globalThis;
  scope.SupabaseSync = { pushDatapoint, flushPending, getDeviceId, isConfigured };
})();
