// Optional live check: reads at most one ID and sends only an invalid credential.
// Never prints row contents or credentials, and cannot create a valid observation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./helpers.cjs');
test('configured REST table is private and the RPC rejects invalid credentials', async () => {
  const source = read('utils/supabase-sync.js');
  const url = source.match(/const SUPABASE_URL = '([^']+)'/)[1];
  const key = source.match(/const SUPABASE_ANON_KEY = '([^']+)'/)[1];
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const response = await fetch(url + '/rest/v1/price_history?select=id&limit=1', { headers });
  assert([401, 403].includes(response.status), 'Anonymous table read must be denied');
  const rpc = await fetch(url + '/rest/v1/rpc/ingest_price_observation', {
    method: 'POST', headers, body: JSON.stringify({ installation_secret: 'invalid', observation: {} })
  });
  assert.equal(rpc.status, 400);
  assert.equal((await rpc.json()).code, '22023');
});
