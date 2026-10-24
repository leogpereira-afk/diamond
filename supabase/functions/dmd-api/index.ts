// dmd-api — adaptador Deno para o handler portado do Netlify (api-core.mjs).
// CORS liberado (o app roda no GitHub Pages, origem diferente); OPTIONS responde antes do gate.
import { handler } from './api-core.mjs';
import { sb } from '../_shared/blobs-shim.mjs';
import { disponibilidadeStream } from './disponibilidade-stream.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const event = {
    httpMethod: req.method,
    headers: Object.fromEntries(req.headers),
    body: await req.text(),
    path: url.pathname,
    rawUrl: req.url,
    queryStringParameters: Object.fromEntries(url.searchParams),
  };
  let res: { statusCode: number; headers?: Record<string, string>; body: string; isBase64Encoded?: boolean };
  try {
    res = await handler(event);
  } catch (e) {
    res = { statusCode: 500, body: JSON.stringify({ erro: 'erro interno: ' + ((e as Error)?.message || e) }) };
  }
  if (res.statusCode === 200 && JSON.parse(event.body || '{}').action === 'disponibilidadeAoVivo') {
    return new Response(disponibilidadeStream(sb, req.signal), {headers: {...CORS, 'Content-Type':'application/x-ndjson', 'Cache-Control':'no-store', 'X-Accel-Buffering':'no'}});
  }
  const headers = { 'Content-Type': 'application/json; charset=utf-8', ...(res.headers || {}), ...CORS };
  if (res.isBase64Encoded) {
    const bin = Uint8Array.from(atob(res.body), (c) => c.charCodeAt(0));
    return new Response(bin, { status: res.statusCode, headers });
  }
  return new Response(res.body, { status: res.statusCode, headers });
});
