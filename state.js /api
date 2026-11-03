// API compartida: guarda todo el pacto como un solo JSON.
// Funciona con Supabase o con Upstash Redis (usa el que esté conectado en Vercel).
// GET  /api/state          -> { state, version }
// PUT  /api/state          -> body { state, baseVersion } -> { version } | 409 { state, version }

const ROW_ID = 'main';

function findEnv(pattern) {
  const key = Object.keys(process.env).find((k) => pattern.test(k) && process.env[k]);
  return key ? process.env[key] : null;
}

/* ---------------- Supabase ---------------- */
function supabaseCreds() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || findEnv(/SUPABASE_URL$/);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || findEnv(/SUPABASE_(SERVICE_ROLE|SECRET)_KEY$/);
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

function supabaseBackend(c) {
  const headers = { apikey: c.key, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  if (c.key.startsWith('eyJ')) headers.Authorization = `Bearer ${c.key}`;
  const base = `${c.url}/rest/v1/pacto`;

  async function call(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) {
      const err = new Error(data?.message || `Supabase ${r.status}`);
      err.status = r.status;
      err.code = data?.code;
      throw err;
    }
    return data;
  }

  async function read() {
    const rows = await call(`${base}?id=eq.${ROW_ID}&select=state,version`);
    const row = rows?.[0];
    return { state: row?.state ?? null, version: Number(row?.version || 0) };
  }

  async function write(state, baseVersion) {
    if (baseVersion === 0) {
      try {
        await call(base, { method: 'POST', body: JSON.stringify({ id: ROW_ID, state, version: 1 }) });
        return 1;
      } catch (e) {
        if (e.status === 409 || e.code === '23505') return -1; // ya existe: otro teléfono guardó primero
        throw e;
      }
    }
    const rows = await call(`${base}?id=eq.${ROW_ID}&version=eq.${baseVersion}`, {
      method: 'PATCH',
      body: JSON.stringify({ state, version: baseVersion + 1, updated_at: new Date().toISOString() }),
    });
    return rows?.length ? baseVersion + 1 : -1;
  }

  return { read, write };
}

/* ---------------- Upstash Redis ---------------- */
const KEY = 'pacto:state';
const VKEY = 'pacto:version';
const SCRIPT = `
local v = tonumber(redis.call('GET', KEYS[2]) or '0')
if v ~= tonumber(ARGV[2]) then return -1 end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], v + 1)
return v + 1
`;

function redisCreds() {
  const env = process.env;
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    const key = Object.keys(env).find((k) => /(REST_API_URL|REDIS_REST_URL)$/.test(k));
    if (key) {
      url = env[key];
      token = env[key.replace(/URL$/, 'TOKEN')];
    }
  }
  return url && token ? { url, token } : null;
}

function redisBackend(c) {
  async function cmd(command) {
    const r = await fetch(c.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  }
  return {
    async read() {
      const [raw, v] = await cmd(['MGET', KEY, VKEY]);
      return { state: raw ? JSON.parse(raw) : null, version: Number(v || 0) };
    },
    async write(state, baseVersion) {
      return Number(await cmd(['EVAL', SCRIPT, '2', KEY, VKEY, JSON.stringify(state), String(baseVersion)]));
    },
  };
}

function backend() {
  const r = redisCreds();
  if (r) return redisBackend(r);
  const s = supabaseCreds();
  if (s) return supabaseBackend(s);
  return null;
}

/* ---------------- handler ---------------- */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const db = backend();
  if (!db) {
    return res.status(503).json({
      error: 'not_configured',
      message: 'No hay base de datos conectada. Conecta Supabase o Upstash en Vercel (Storage) y haz Redeploy.',
    });
  }

  const pin = process.env.APP_PIN;
  if (pin && req.headers['x-pin'] !== pin) return res.status(401).json({ error: 'pin' });

  try {
    if (req.method === 'GET') return res.status(200).json(await db.read());

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      if (!body.state || typeof body.state !== 'object') return res.status(400).json({ error: 'missing_state' });
      if (JSON.stringify(body.state).length > 900000) return res.status(413).json({ error: 'too_large' });

      const result = await db.write(body.state, Number(body.baseVersion) || 0);
      if (result === -1) return res.status(409).json(await db.read());
      return res.status(200).json({ version: result });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error(err);
    const missingTable = err.status === 404 || err.code === '42P01' || err.code === 'PGRST205';
    return res.status(500).json({
      error: missingTable ? 'missing_table' : 'server_error',
      message: missingTable
        ? 'Supabase está conectado, pero falta crear la tabla «pacto». Corre el SQL del README en el SQL Editor de Supabase.'
        : `Error de la base de datos: ${err.message}`,
    });
  }
}
