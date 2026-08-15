// blobs-shim.mjs — implementa a interface do Netlify Blobs (get/setJSON/delete/list) em cima do Supabase.
// Stores de REGISTROS → tabela dmd_kv (Postgres, consistência FORTE — some o lag eventual do Blobs).
// Stores de BINÁRIOS (fotos, propostasPdf) → bucket dmd-arquivos (não incha o banco).
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
const BINARIOS = new Set(['fotos', 'propostasPdf']);
const BUCKET = 'dmd-arquivos';

export function connectLambda() { /* no-op — só existia no runtime do Netlify */ }

export function getStore(store) {
  return BINARIOS.has(store) ? storeBucket(store) : storeKv(store);
}

function storeKv(store) {
  return {
    async get(key, opts) {
      const { data, error } = await sb.from('dmd_kv').select('valor').eq('store', store).eq('key', key).maybeSingle();
      if (error) throw new Error('kv get ' + store + '/' + key + ': ' + error.message);
      if (!data) return null;
      return (opts && opts.type === 'json') ? data.valor : JSON.stringify(data.valor);
    },
    async setJSON(key, val) {
      const { error } = await sb.from('dmd_kv').upsert({ store, key, valor: val, atualizado_em: new Date().toISOString() });
      if (error) throw new Error('kv set ' + store + '/' + key + ': ' + error.message);
    },
    async delete(key) {
      const { error } = await sb.from('dmd_kv').delete().eq('store', store).eq('key', key);
      if (error) throw new Error('kv del ' + store + '/' + key + ': ' + error.message);
    },
    async list() {
      const keys = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('dmd_kv').select('key').eq('store', store).order('key').range(from, from + 999);
        if (error) throw new Error('kv list ' + store + ': ' + error.message);
        (data || []).forEach((r) => keys.push(r.key));
        if (!data || data.length < 1000) break;
      }
      return { blobs: keys.map((key) => ({ key })) };
    },
  };
}

function storeBucket(store) {
  const path = (key) => store + '/' + key + '.json';
  return {
    async get(key, opts) {
      const { data, error } = await sb.storage.from(BUCKET).download(path(key));
      if (error || !data) return null; // não encontrado = null (semântica do Blobs)
      const txt = await data.text();
      return (opts && opts.type === 'json') ? JSON.parse(txt) : txt;
    },
    async setJSON(key, val) {
      const body = new Blob([JSON.stringify(val)], { type: 'application/json' });
      const { error } = await sb.storage.from(BUCKET).upload(path(key), body, { upsert: true, contentType: 'application/json' });
      if (error) throw new Error('bucket set ' + path(key) + ': ' + error.message);
    },
    async delete(key) {
      await sb.storage.from(BUCKET).remove([path(key)]); // best-effort, igual ao delFoto
    },
    async list() {
      const keys = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await sb.storage.from(BUCKET).list(store, { limit: 1000, offset });
        if (error) throw new Error('bucket list ' + store + ': ' + error.message);
        (data || []).forEach((f) => { if (f.name.endsWith('.json')) keys.push(f.name.slice(0, -5)); });
        if (!data || data.length < 1000) break;
      }
      return { blobs: keys.map((key) => ({ key })) };
    },
  };
}
