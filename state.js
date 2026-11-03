// API compartida: guarda todo el pacto como un solo JSON en Upstash Redis.
// GET  /api/state          -> { state, version }
// PUT  /api/state          -> body { state, baseVersion } -> { version } | 409 { state, version }

const KEY = 'pacto:state';
const VKEY = 'pacto:version';

// Guarda solo si nadie más guardó entre medio (evita que un teléfono pise al otro).
const SCRIPT = `
local v = tonumber(redis.call('GET', KEYS[2]) or '0')
if v ~= tonumber(ARGV[2]) then return -1 end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], v + 1)
return v + 1
`;

function credentials() {
  const env = process.env;
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Vercel permite ponerle un prefijo propio a las variables; las buscamos igual.
    const key = Object.keys(env).find((k) => /(REST_API_URL|REDIS_REST_URL)$/.test(k));
    if (key) {
      url = env[key];
      token = env[key.replace(/URL$/, 'TOKEN')];
    }
  }
  return url && token ? { url, token } : null;
}

async function redis(creds, command) {
  const r = await fetch(creds.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function readState(creds) {
  const [raw, v] = await redis(creds, ['MGET', KEY, VKEY]);
  return { state: raw ? JSON.parse(raw) : null, version: Number(v || 0) };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const creds = credentials();
  if (!creds) return res.status(503).json({ error: 'not_configured' });

  const pin = process.env.APP_PIN;
  if (pin && req.headers['x-pin'] !== pin) return res.status(401).json({ error: 'pin' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await readState(creds));
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      if (!body.state || typeof body.state !== 'object') {
        return res.status(400).json({ error: 'missing_state' });
      }
      const json = JSON.stringify(body.state);
      if (json.length > 900000) return res.status(413).json({ error: 'too_large' });

      const result = await redis(creds, ['EVAL', SCRIPT, '2', KEY, VKEY, json, String(Number(body.baseVersion) || 0)]);
      if (Number(result) === -1) return res.status(409).json(await readState(creds));
      return res.status(200).json({ version: Number(result) });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
}
