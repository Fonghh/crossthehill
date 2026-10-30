// Cloudflare Pages Function: POST /api/turn → short-lived TURN credentials.
// Secrets (Pages project → Settings → Variables and Secrets):
//   TURN_KEY_ID          Cloudflare Realtime TURN key id
//   TURN_KEY_API_TOKEN   that key's API token
// The token never reaches the browser; clients only get credentials that expire.

const TTL_SECONDS = 6 * 60 * 60;

export async function onRequestPost({ env }) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return json({ error: 'TURN not configured' }, 501);
  }
  const base = `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials`;
  const init = {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL_SECONDS }),
  };
  // Newer endpoint returns { iceServers: [...] }; the older one returns { iceServers: {...} }.
  let res = await fetch(`${base}/generate-ice-servers`, init);
  if (res.status === 404) res = await fetch(`${base}/generate`, init);
  if (!res.ok) return json({ error: 'TURN request failed', status: res.status }, 502);
  const data = await res.json();
  // Cloudflare's docs note the alternate port-53 URLs can time out in browsers; drop them.
  const list = (Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers]).map((s) => ({
    ...s,
    urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)),
  }));
  return json({ iceServers: list });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// GET /api/turn → quick setup check from a phone browser (never returns credentials).
export async function onRequestGet({ env }) {
  return json({ configured: Boolean(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) });
}
