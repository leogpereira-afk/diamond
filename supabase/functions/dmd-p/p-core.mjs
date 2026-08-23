// p-core.mjs — PORTE FIEL do netlify/functions/p.js (landing pública da proposta).
import { getStore, connectLambda } from '../_shared/blobs-shim.mjs';
import crypto from 'node:crypto';

const now = () => new Date().toISOString();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// escape p/ contexto <script> inline: neutraliza </script>, <!-- e separadores de linha JS
const telWa = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 12 ? d : d.length >= 10 ? '55' + d : d; };
// html() ainda serve o aviso de proposta inexistente (texto curto, sem layout).
const html = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body });
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
// bots/preview-crawlers a NÃO contar. NÃO inclui "whatsapp" — o navegador in-app do WhatsApp (onde o cliente abre) tem "WhatsApp" na UA e é uma abertura REAL.
const ehBot = (ua) => /bot\b|facebookexternalhit|crawler|spider|slurp|bingpreview|telegrambot|googlebot|bingbot|yandex|applebot|twitterbot|discordbot|slackbot|linkpreview|embedly|preview/i.test(String(ua || ''));
const MAX_EVENTOS = 50;
// Onde a página do cliente mora agora (GitHub Pages serve HTML; o Supabase não).
const SITE = 'https://leogpereira-afk.github.io/diamond';

const aviso = (code, msg) => html(code, `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Proposta Diamond</title><body style="margin:0;font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#0d0d0d;color:#eee;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px"><div><div style="color:#e4f72b;font-weight:800;font-size:28px;letter-spacing:.13em">DIAMOND</div><p style="margin-top:14px;color:#aaa">${esc(msg)}</p></div></body>`);

export const handler = async (event) => {
  try { connectLambda(event); } catch (e) { /* contexto injetado pelo runtime */ }
  const seg = (event.path || '').split('/').filter(Boolean).pop() || '';
  const q = event.queryStringParameters || {};
  const id = (((q.id) || (/^pp-/i.test(seg) ? seg : '')) || '').trim();
  if (!/^pp-[a-f0-9]{16,}$/i.test(id)) return aviso(400, 'Link inválido.');
  const envios = getStore('envios');
  const ua = (event.headers || {})['user-agent'];

  // POST → registra interação do cliente. Exige envio VIVO (bloqueia spam/órfãos) e limita a MAX_EVENTOS por link.
  if (event.httpMethod === 'POST') {
    let acao = '';
    try { acao = (JSON.parse(event.body || '{}').acao || '').slice(0, 20); } catch (e) {}
    if (!/^[a-z_]+$/.test(acao)) return json(400, { erro: 'ação inválida' });
    try {
      const ev = await envios.get(id, { type: 'json' });
      if (!ev) return json(404, { erro: 'não encontrado' });
      if ((ev.nEv || 0) < MAX_EVENTOS) {
        await getStore('enviosEv').setJSON(id + '-' + crypto.randomBytes(6).toString('hex'), { envioId: id, tipo: acao, em: now() });
        try { ev.nEv = (ev.nEv || 0) + 1; await envios.setJSON(id, ev); } catch (e) {} // contador do limite (aprox., best-effort)
      }
    } catch (e) { /* best-effort */ }
    return json(200, { ok: true });
  }

  // GET ?pdf=1 → PDF cru (+ registra abriu_pdf server-side, mais confiável que o onclick)
  if (q.pdf) {
    try {
      const rec = await getStore('propostasPdf').get(id, { type: 'json' });
      if (!rec || !rec.base64) return aviso(404, 'Proposta não encontrada.');
      if (!ehBot(ua) && !q.preview) { try { const ev = await envios.get(id, { type: 'json' }); if (ev && (ev.nEv || 0) < MAX_EVENTOS) { await getStore('enviosEv').setJSON(id + '-' + crypto.randomBytes(6).toString('hex'), { envioId: id, tipo: 'abriu_pdf', em: now() }); try { ev.nEv = (ev.nEv || 0) + 1; await envios.setJSON(id, ev); } catch (e) {} } } catch (e) {} }
      const nome = 'Proposta-Diamond' + (rec.unidade ? '-' + String(rec.unidade).replace(/[^\w]/g, '') : '') + '.pdf';
      return { statusCode: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + nome + '"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }, body: rec.base64, isBase64Encoded: true };
    } catch (e) { return aviso(500, 'Erro ao abrir a proposta.'); }
  }

  // GET ?dados=1 → os números da proposta em JSON, para a página do site montar a tela.
  //
  // POR QUE ISTO EXISTE: no domínio compartilhado do Supabase, TODA resposta em
  // HTML é reescrita para text/plain com CSP `sandbox` (é como a plataforma
  // impede que alguém hospede página falsa ali). O cliente recebia o código na
  // cara, com os acentos quebrados. JSON e PDF passam intactos — então os DADOS
  // continuam saindo daqui e quem desenha a tela é o site (p.html), onde HTML é
  // permitido. Não conta abertura: quem conta é o encaminhamento, abaixo.
  if (q.dados) {
    let e1;
    try { e1 = await envios.get(id, { type: 'json' }); } catch (e) { e1 = null; }
    if (!e1) return json(404, { erro: 'Proposta não encontrada — o link pode ter sido removido.' });
    let logoUri = '';
    try { if (e1.logoId) { const lf = await getStore('fotos').get(e1.logoId, { type: 'json' }); if (lf && lf.base64) logoUri = 'data:' + (lf.mime || 'image/jpeg') + ';base64,' + lf.base64; } } catch (e) {}
    let domoNum2 = '11972746113';
    try { const c = await getStore('cfg').get('cfg', { type: 'json' }); if (c && c.contatoWhats) domoNum2 = c.contatoWhats; } catch (e) {}
    return json(200, {
      id,
      cliente: e1.cliente || '',
      unidade: e1.unidade || '',
      valor: e1.valor || 0,
      area: e1.area || 0,
      andar: (e1.andar || e1.andar === 0) ? e1.andar : null,
      corretor: e1.corretor || '',
      empresa: e1.empresa || '',
      numero: e1.numero || 0,
      em: e1.em || '',
      whats: telWa(e1.corretorTel) || telWa(domoNum2),
      logoUri,
    });
  }

  // GET landing → conta a abertura (menos bots/preview e menos o ?preview do painel)
  // e ENCAMINHA para a página no site. O link que já está no WhatsApp do cliente
  // continua sendo este; só o destino final mudou. Encaminhamento não é HTML,
  // então atravessa a trava da plataforma.
  let ev;
  try { ev = await envios.get(id, { type: 'json' }); } catch (e) { ev = null; }
  if (!ev) return aviso(404, 'Proposta não encontrada — o link pode ter sido removido.');
  if (!ehBot(ua) && !q.preview) { try { ev.views = (ev.views || 0) + 1; ev.lastView = now(); if (!ev.firstView) ev.firstView = ev.lastView; await envios.setJSON(id, ev); } catch (e) {} }
  return {
    statusCode: 302,
    headers: {
      Location: SITE + '/p.html?id=' + encodeURIComponent(id) + (q.preview ? '&preview=1' : ''),
      'Cache-Control': 'no-store',
    },
    body: '',
  };
};
