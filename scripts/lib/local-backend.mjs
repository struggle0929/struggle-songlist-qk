// Local-only Supabase HTTP fixture backed by real PostgreSQL (PGlite).
// Never imports production credentials; all data lives in memory and is lost on exit.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const ids = {
  admin: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
};
export const localKey = 'local-publishable-key';
export const localSecret = 'local-service-only-key';
const ident = (s) => {
  if (!/^[a-z_]+$/.test(s)) throw new Error('Invalid fixture identifier');
  return `"${s}"`;
};
export async function startLocalBackend(port = 0) {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    grant usage on schema public to anon,authenticated,service_role;`);
  await db.exec(
    (await readFile('supabase/schema.sql', 'utf8')).replace('create extension if not exists pgcrypto;', '')
  );
  const users = new Map();
  const addUser = async (id, email, password) => {
    const user = {
      id,
      email,
      password,
      aud: 'authenticated',
      role: 'authenticated',
      created_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {}
    };
    users.set(id, user);
    await db.query('insert into auth.users(id) values($1)', [id]);
    return user;
  };
  const password = 'Local-only-0929!';
  await addUser(ids.admin, 'admin@local.test', password);
  await db.exec('grant all on all tables in schema public to service_role; grant select on songs,settings to anon;');
  await db.query('insert into songs(title,artist,language,status,tags) values($1,$2,$3,$4,$5)', [
    '本地测试歌曲',
    '测试原唱',
    '中文',
    'ready',
    ['流行']
  ]);
  await db.query('insert into songs(title,artist,language,status,is_public,tags) values($1,$2,$3,$4,false,$5)', [
    '本地隐藏歌曲',
    '测试原唱',
    '中文',
    'learning',
    ['甜歌']
  ]);
  const publicUser = (user) => {
    const { password, ...safe } = user;
    return safe;
  };
  const tokens = new Map();
  function session(user) {
    const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.local`;
    tokens.set(token, user.id);
    return {
      access_token: token,
      refresh_token: user.id,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: publicUser(user)
    };
  }
  const files = new Map();
  files.set('profile/local-background.png', {
    type: 'image/png',
    bytes: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=',
      'base64'
    )
  });
  await db.query(
    "insert into settings(key,value) values('background_path',$1) on conflict(key) do update set value=excluded.value",
    ['profile/local-background.png']
  );
  const uploadTokens = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const body = buffer.length && (req.headers['content-type'] || '').includes('json') ? JSON.parse(buffer) : {};
    const token = (req.headers.authorization || '').replace(/^Bearer /i, '');
    const privileged = req.headers.apikey === localSecret;
    const reply = (value, status = 200, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(value));
    };
    try {
      if (url.pathname === '/auth/v1/token') {
        const user =
          url.searchParams.get('grant_type') === 'refresh_token'
            ? users.get(body.refresh_token)
            : [...users.values()].find((u) => u.email === body.email && u.password === body.password);
        if (!user) return reply({ error: 'invalid_grant', msg: 'Invalid credentials' }, 400);
        return reply(session(user));
      }
      if (url.pathname === '/auth/v1/user') {
        const user = users.get(tokens.get(token));
        return user ? reply(publicUser(user)) : reply({ msg: 'Invalid token' }, 401);
      }
      if (url.pathname.startsWith('/auth/v1/admin/users')) {
        if (!privileged) return reply({ msg: 'Forbidden' }, 403);
        const id = url.pathname.split('/')[5];
        if (req.method === 'GET' && !id) {
          const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
          const perPage = Math.max(1, Number(url.searchParams.get('per_page')) || 25);
          const all = [...users.values()];
          return reply({
            users: all.slice((page - 1) * perPage, page * perPage).map(publicUser),
            aud: 'authenticated',
            total: all.length
          });
        }
        if (req.method === 'POST') {
          if ([...users.values()].some((u) => u.email === body.email)) return reply({ msg: 'Already exists' }, 422);
          return reply(publicUser(await addUser(randomUUID(), body.email, body.password)));
        }
        if (req.method === 'DELETE') {
          await db.query('delete from auth.users where id=$1', [id]);
          users.delete(id);
          for (const [access, userId] of tokens) if (userId === id) tokens.delete(access);
          return reply({});
        }
        return users.has(id) ? reply(publicUser(users.get(id))) : reply({ msg: 'Not found' }, 404);
      }
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        if (!privileged) return reply({ message: 'Forbidden' }, 403);
        const name = url.pathname.split('/').pop();
        const keys = Object.keys(body);
        const { rows } = await db.query(
          `select public.${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(',')}) as result`,
          Object.values(body).map((v) => (typeof v === 'object' ? JSON.stringify(v) : v))
        );
        return reply(rows[0].result || null);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.split('/').pop();
        if (!['songs', 'requests', 'settings'].includes(table)) throw new Error('Unknown table');
        if (req.method !== 'GET' && !privileged) return reply({ message: 'Forbidden' }, 403);
        const params = [],
          filters = [];
        const param = (value) => {
          params.push(value);
          return `$${params.length}`;
        };
        for (const [key, value] of url.searchParams) {
          if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(key)) continue;
          const dot = value.indexOf('.'),
            op = value.slice(0, dot),
            v = value.slice(dot + 1);
          if (op === 'eq') filters.push(`${ident(key)}=${param(v)}`);
          else if (op === 'in')
            filters.push(
              `${ident(key)} in (${v
                .slice(1, -1)
                .split(',')
                .map((x) => param(x.replace(/^"|"$/g, '')))
                .join(',')})`
            );
          else if (op === 'cs' || op === 'cd')
            filters.push(`${ident(key)} ${op === 'cs' ? '@>' : '<@'} ${param(v)}::text[]`);
          else throw new Error('Unsupported filter ' + op);
        }
        const where = filters.length ? ' where ' + filters.join(' and ') : '';
        const select = url.searchParams.get('select') || '*';
        const columns =
          select === '*'
            ? '*'
            : select
                .split(',')
                .map((c) => ident(c.trim()))
                .join(',');
        let sql;
        if (req.method === 'GET') {
          sql = `select ${columns} from public.${ident(table)}${where}`;
          const order = url.searchParams.get('order');
          if (order)
            sql +=
              ' order by ' +
              order
                .split(',')
                .map((o) => {
                  const [col, dir] = o.split('.');
                  return ident(col) + (dir === 'desc' ? ' desc' : ' asc');
                })
                .join(',');
          if (url.searchParams.has('limit')) sql += ' limit ' + param(Number(url.searchParams.get('limit')));
          if (url.searchParams.has('offset')) sql += ' offset ' + param(Number(url.searchParams.get('offset')));
        } else if (req.method === 'DELETE') sql = `delete from public.${ident(table)}${where} returning *`;
        else if (req.method === 'PATCH') {
          sql = `update public.${ident(table)} set ${Object.entries(body)
            .map(([k, v]) => `${ident(k)}=${param(v)}`)
            .join(',')}${where} returning *`;
        } else {
          const records = Array.isArray(body) ? body : [body],
            keys = Object.keys(records[0]);
          sql = `insert into public.${ident(table)} (${keys.map(ident).join(',')}) values ${records.map((record) => '(' + keys.map((k) => param(record[k])).join(',') + ')').join(',')}`;
          if ((req.headers.prefer || '').includes('resolution=merge-duplicates')) {
            const conflict = (
              url.searchParams.get('on_conflict') ||
              keys.filter((k) => ['id', 'key', 'streamer_id', 'user_id'].includes(k)).join(',')
            ).split(',');
            sql += ` on conflict (${conflict.map(ident).join(',')}) do update set ${keys.map((k) => `${ident(k)}=excluded.${ident(k)}`).join(',')}`;
          }
          sql += ' returning *';
        }
        const rows = await db.transaction(async (tx) => {
          await tx.exec(`set local role ${privileged ? 'service_role' : 'anon'};`);
          return (await tx.query(sql, params)).rows;
        });
        const headers = { 'Content-Range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` };
        if ((req.headers.accept || '').includes('application/vnd.pgrst.object+json')) {
          if (rows.length !== 1)
            return reply({ code: 'PGRST116', details: `${rows.length} rows`, message: 'Not a single row' }, 406);
          return reply(rows[0], 200, headers);
        }
        return reply(rows, 200, headers);
      }
      if (url.pathname.startsWith('/storage/v1/')) {
        const path = decodeURIComponent(url.pathname);
        const publicPrefix = '/storage/v1/object/public/site-assets/';
        if (path.startsWith(publicPrefix)) {
          const file = files.get(path.slice(publicPrefix.length));
          if (!file) return reply({ message: 'Not found' }, 404);
          res.writeHead(200, { 'Content-Type': file.type });
          res.end(file.bytes);
          return;
        }
        const signPrefix = '/storage/v1/object/upload/sign/site-assets/';
        if (path.startsWith(signPrefix)) {
          const key = path.slice(signPrefix.length);
          if (req.method === 'POST' && privileged) {
            const token = randomUUID();
            uploadTokens.set(token, key);
            return reply({ url: `/object/upload/sign/site-assets/${key}?token=${token}` });
          }
          if (req.method !== 'PUT' || uploadTokens.get(url.searchParams.get('token')) !== key)
            return reply({ message: 'Invalid token' }, 403);
          const form = await new Request('http://localhost', {
            method: 'POST',
            headers: req.headers,
            body: buffer
          }).formData();
          const file = [...form.values()].find((v) => v instanceof File);
          files.set(key, { bytes: Buffer.from(await file.arrayBuffer()), type: file.type });
          return reply({ Key: 'site-assets/' + key });
        }
        if (!privileged) return reply({ message: 'Forbidden' }, 403);
        if (path === '/storage/v1/object/list/site-assets')
          return reply(
            [...files]
              .filter(([key]) => key.startsWith(body.prefix + '/') && !key.slice(body.prefix.length + 1).includes('/'))
              .map(([key, f]) => ({ name: key.slice(body.prefix.length + 1), metadata: { size: f.bytes.length } }))
          );
        if (path === '/storage/v1/object/site-assets' && req.method === 'DELETE') {
          for (const p of body.prefixes || []) files.delete(p);
          return reply([]);
        }
        const prefix = '/storage/v1/object/site-assets/';
        if (path.startsWith(prefix) && req.method === 'POST') {
          const form = await new Request('http://localhost', {
            method: 'POST',
            headers: req.headers,
            body: buffer
          }).formData();
          const file = [...form.values()].find((v) => v instanceof File);
          const key = path.slice(prefix.length);
          files.set(key, { bytes: Buffer.from(await file.arrayBuffer()), type: file.type });
          return reply({ Id: randomUUID(), Key: 'site-assets/' + key });
        }
      }
      return reply({ message: 'Fixture endpoint not found: ' + url.pathname }, 404);
    } catch (e) {
      reply({ message: e.message, code: e.code || 'LOCAL_ERROR', details: e.detail }, 400);
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    db,
    server,
    users,
    files,
    ids,
    url: `http://127.0.0.1:${server.address().port}`,
    password,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    }
  };
}
