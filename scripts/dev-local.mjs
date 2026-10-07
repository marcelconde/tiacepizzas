// Ambiente local de teste, sem Docker e sem tocar nos dados reais:
// um Postgres em memória (PGlite) com as migrações e o cardápio de exemplo, exposto por um
// subconjunto da API do Supabase (REST e login), mais o servidor de desenvolvimento do site.
// Uso: npm run dev:local  →  http://localhost:5173  (painel: dona@teste.local / teste1234)
// Não cobre: tempo real (o painel atualiza a cada 45 s), fotos e funções de servidor (nota fiscal, usuários).
// Os dados somem ao encerrar.
import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const projeto = join(dirname(fileURLToPath(import.meta.url)), '..')
const db = new PGlite()

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create publication supabase_realtime;
`)
for (const f of readdirSync(join(projeto, 'supabase/migrations')).sort()) await db.exec(readFileSync(join(projeto, 'supabase/migrations', f), 'utf8'))
await db.exec(readFileSync(join(projeto, 'supabase/seed.sql'), 'utf8'))
await db.exec(`
  update configuracoes set loja_aberta_manual = true, whatsapp = '11999990000', telefone = '1133334444', chave_pix = 'pix@tiacepizzas.com.br',
    logradouro = 'Rua das Oliveiras', numero = '250', bairro = 'Centro', cidade = 'São Paulo', uf = 'SP', instagram = '@tiacepizzas';
  insert into auth.users (email, raw_user_meta_data) values ('dona@teste.local', '{"nome":"Tia Cê"}');
  insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('cozinha@teste.local', '{"nome":"Zé da Cozinha"}', '{"papel":"cozinha","ativo":true}');
  insert into entregadores (nome, telefone, valor_por_entrega) values ('Carlos Moto', '11988881111', 6);
`)

// relacionamentos (FKs) para resolver os "embeds" do select
const fks = (await db.query(`
  select c.conrelid::regclass::text as filho, a.attname as coluna, c.confrelid::regclass::text as pai, af.attname as ref
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace`)).rows
const pks = Object.fromEntries((await db.query(`
  select i.indrelid::regclass::text as t, array_agg(a.attname order by a.attnum) as cols
  from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indisprimary group by 1`)).rows.map((r) => [r.t, r.cols]))

const tiposCol = {}
for (const r of (await db.query(`
  select c.relname as t, a.attname as col, format_type(a.atttypid, a.atttypmod) as tipo
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'v')`)).rows) (tiposCol[r.t] ??= {})[r.col] = r.tipo
const tiposFn = {}
for (const r of (await db.query(`
  select p.proname as f, p.proargnames as nomes,
         (select array_agg(format_type(x.t, null) order by x.ord) from unnest(p.proargtypes::oid[]) with ordinality x(t, ord)) as tipos
  from pg_proc p where p.pronamespace = 'public'::regnamespace`)).rows) tiposFn[r.f] = Object.fromEntries((r.nomes ?? []).map((nome, i) => [nome, r.tipos[i]]))

const id = (s) => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error('identificador inválido: ' + s); return `"${s}"` }

function dividir(s) { // separa por vírgulas de nível 0
  const out = []; let nivel = 0, atual = ''
  for (const ch of s) {
    if (ch === '(') nivel++
    if (ch === ')') nivel--
    if (ch === ',' && nivel === 0) { out.push(atual.trim()); atual = '' } else atual += ch
  }
  if (atual.trim()) out.push(atual.trim())
  return out
}

let n = 0
function linha(tabela, alias, select) {
  const partes = []; const cols = []
  for (const item of dividir(select || '*')) {
    const m = item.match(/^([a-z_0-9]+)\((.*)\)$/is)
    if (item === '*') partes.push(`to_jsonb(${alias}.*)`)
    else if (m) {
      const [, rel, interno] = m; const a2 = `t${++n}`
      const umParaMuitos = fks.find((f) => f.filho === rel && f.pai === tabela)
      const muitosParaUm = fks.find((f) => f.filho === tabela && f.pai === rel)
      if (umParaMuitos) partes.push(`jsonb_build_object('${rel}', (select coalesce(jsonb_agg(${linha(rel, a2, interno)}), '[]'::jsonb) from public.${id(rel)} ${a2} where ${a2}.${id(umParaMuitos.coluna)} = ${alias}.${id(umParaMuitos.ref)}))`)
      else if (muitosParaUm) partes.push(`jsonb_build_object('${rel}', (select ${linha(rel, a2, interno)} from public.${id(rel)} ${a2} where ${a2}.${id(muitosParaUm.ref)} = ${alias}.${id(muitosParaUm.coluna)}))`)
      else throw Object.assign(new Error(`Could not find a relationship between '${tabela}' and '${rel}'`), { code: 'PGRST200' })
    } else cols.push(item)
  }
  if (cols.length) partes.push(`jsonb_build_object(${cols.map((c) => `'${c}', ${alias}.${id(c)}`).join(', ')})`)
  return partes.join(' || ')
}

const RESERVADOS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
function filtros(params, alias, valores, tabela) {
  const conds = []
  for (const [col, bruto] of params) {
    if (RESERVADOS.has(col)) continue
    const i = bruto.indexOf('.'); const op = bruto.slice(0, i); const val = bruto.slice(i + 1)
    const c = `${alias}.${id(col)}`
    const tipo = tiposCol[tabela]?.[col]; if (!tipo) throw new Error(`column ${tabela}.${col} does not exist`)
    const p = (v) => { valores.push(v); return `($${valores.length}::text)::${tipo}` }
    const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }
    if (ops[op]) conds.push(`${c} ${ops[op]} ${p(val)}`)
    else if (op === 'in') { valores.push(val.slice(1, -1).replace(/"/g, '')); conds.push(`${c}::text = any(string_to_array($${valores.length}::text, ','))`) }
    else if (op === 'is') conds.push(`${c} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`)
    else if (op === 'ilike' || op === 'like') { valores.push(val.replace(/\*/g, '%')); conds.push(`${c} ${op} $${valores.length}::text`) }
    else throw new Error('operador não suportado: ' + bruto)
  }
  return conds.length ? ' where ' + conds.join(' and ') : ''
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (u) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.local`
const lerToken = (h) => { try { const p = JSON.parse(Buffer.from((h ?? '').replace(/^Bearer /i, '').split('.')[1], 'base64url').toString()); return p.sub ? p : null } catch { return null } }
const usuarioJson = (u) => ({ id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: u.raw_app_meta_data, user_metadata: u.raw_user_meta_data, created_at: new Date().toISOString() })
const sessao = (u) => ({ access_token: token(u), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: `r.${u.id}`, user: usuarioJson(u) })

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,HEAD,OPTIONS', 'Access-Control-Expose-Headers': 'Content-Range' }

http.createServer(async (req, res) => {
  const enviar = (status, corpo, extra = {}) => { res.writeHead(status, { ...CORS, 'Content-Type': 'application/json', ...extra }); res.end(corpo === undefined ? '' : JSON.stringify(corpo)) }
  if (req.method === 'OPTIONS') return enviar(204)
  const url = new URL(req.url, 'http://x')
  let bruto = ''; for await (const c of req) bruto += c
  const corpo = bruto ? JSON.parse(bruto) : null
  const claims = lerToken(req.headers.authorization)
  const papel = claims ? 'authenticated' : 'anon'
  n = 0
  try {
    // ---------- auth
    if (url.pathname === '/auth/v1/token') {
      const u = url.searchParams.get('grant_type') === 'password'
        ? (await db.query(`select * from auth.users where email = $1`, [corpo.email])).rows[0]
        : (await db.query(`select * from auth.users where id = $1`, [String(corpo.refresh_token).slice(2)])).rows[0]
      if (!u || (corpo.password !== undefined && corpo.password !== 'teste1234')) return enviar(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' })
      return enviar(200, sessao(u))
    }
    if (url.pathname === '/auth/v1/user') {
      const u = claims && (await db.query(`select * from auth.users where id = $1`, [claims.sub])).rows[0]
      return u ? enviar(200, usuarioJson(u)) : enviar(401, { msg: 'invalid token' })
    }
    if (url.pathname === '/auth/v1/logout') return enviar(204)
    if (url.pathname.startsWith('/functions/v1/')) return enviar(400, { erro: 'Funções de servidor não existem no backend local de teste.' })

    const executar = (fn) => db.transaction(async (tx) => {
      await tx.exec(`set local role ${papel}`)
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [claims?.sub ?? ''])
      return fn(tx)
    })

    // ---------- rpc
    let m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/)
    if (m) {
      const args = Object.entries(corpo ?? {})
      if (!tiposFn[m[1]]) return enviar(404, { code: 'PGRST202', message: `Could not find the function public.${m[1]}` })
      const sql = `select to_jsonb(f) as r from public.${id(m[1])}(${args.map(([k], i) => `${id(k)} => ($${i + 1}::text)::${tiposFn[m[1]][k]}`).join(', ')}) f`
      const r = await executar((tx) => tx.query(sql, args.map(([, v]) => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)))))
      return enviar(200, r.rows[0]?.r ?? null)
    }

    // ---------- tabelas
    m = url.pathname.match(/^\/rest\/v1\/([a-z_0-9]+)$/)
    if (!m) return enviar(404, { message: 'rota não encontrada: ' + url.pathname })
    const tabela = m[1]; const t = `public.${id(tabela)}`
    const prefer = req.headers.prefer ?? ''
    const objeto = (req.headers.accept ?? '').includes('vnd.pgrst.object')
    const params = [...url.searchParams]
    const valores = []
    let linhas = []; let total = null

    if (req.method === 'GET' || req.method === 'HEAD') {
      const where = filtros(params, 'a', valores, tabela)
      const ordem = (url.searchParams.get('order') ?? '').split(',').filter(Boolean).map((o) => { const [c, d] = o.split('.'); return `a.${id(c)} ${d === 'desc' ? 'desc' : 'asc'}` })
      const limite = url.searchParams.get('limit')
      const sql = `select ${linha(tabela, 'a', url.searchParams.get('select'))} as r from ${t} a${where}${ordem.length ? ' order by ' + ordem.join(', ') : ''}${limite ? ' limit ' + Number(limite) : ''}`
      await executar(async (tx) => {
        if (req.method === 'GET') linhas = (await tx.query(sql, valores)).rows.map((r) => r.r)
        if (prefer.includes('count=exact')) total = (await tx.query(`select count(*)::int as c from ${t} a${where}`, valores)).rows[0].c
      })
    } else if (req.method === 'POST') {
      const lista = Array.isArray(corpo) ? corpo : [corpo]
      const cols = [...new Set(lista.flatMap((o) => Object.keys(o)))].map(id)
      let sql = `insert into ${t} (${cols.join(', ')}) select ${cols.join(', ')} from jsonb_populate_recordset(null::${t}, $1::jsonb)`
      if (prefer.includes('resolution=merge-duplicates')) {
        const pk = pks[tabela].map(id); const resto = cols.filter((c) => !pk.includes(c))
        sql += ` on conflict (${pk.join(', ')}) do ${resto.length ? 'update set ' + resto.map((c) => `${c} = excluded.${c}`).join(', ') : 'nothing'}`
      }
      linhas = (await executar((tx) => tx.query(sql + ' returning to_jsonb(' + id(tabela) + '.*) as r', [JSON.stringify(lista)]))).rows.map((r) => r.r)
    } else if (req.method === 'PATCH') {
      const cols = Object.keys(corpo).map(id)
      valores.push(JSON.stringify(corpo))
      const atrib = cols.length === 1 ? cols[0] : `(${cols.join(', ')})`
      const sql = `update ${t} a set ${atrib} = (select ${cols.join(', ')} from jsonb_populate_record(null::${t}, $1::jsonb))${filtros(params, 'a', valores, tabela)} returning to_jsonb(a.*) as r`
      linhas = (await executar((tx) => tx.query(sql, valores))).rows.map((r) => r.r)
    } else if (req.method === 'DELETE') {
      linhas = (await executar((tx) => tx.query(`delete from ${t} a${filtros(params, 'a', valores, tabela)} returning to_jsonb(a.*) as r`, valores))).rows.map((r) => r.r)
    }

    const cabecalhos = total != null ? { 'Content-Range': `${linhas.length ? `0-${linhas.length - 1}` : '*'}/${total}` } : {}
    const devolve = req.method === 'GET' || prefer.includes('return=representation')
    if (!devolve) return enviar(req.method === 'POST' ? 201 : req.method === 'HEAD' ? 200 : 204, undefined, cabecalhos)
    if (objeto) {
      if (linhas.length !== 1) return enviar(406, { code: 'PGRST116', details: `The result contains ${linhas.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' })
      return enviar(200, linhas[0], cabecalhos)
    }
    return enviar(req.method === 'POST' ? 201 : 200, linhas, cabecalhos)
  } catch (e) {
    console.error(`[erro] ${req.method} ${req.url}\n   ${e.message}`)
    return enviar(/permission denied|row-level security/.test(e.message) ? 403 : 400, { code: e.code ?? 'P0001', message: e.message, details: null, hint: null })
  }
}).listen(54321, () => {
  console.log('backend local em http://localhost:54321 — painel: dona@teste.local / teste1234')
  const vite = spawn('npx', ['vite', '--port', '5173', '--strictPort'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: 'local' },
  })
  vite.on('exit', (codigo) => process.exit(codigo ?? 0))
  process.on('SIGINT', () => vite.kill('SIGINT'))
  process.on('SIGTERM', () => vite.kill('SIGTERM'))
})
