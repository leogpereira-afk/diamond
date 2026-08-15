// p-core.mjs — PORTE FIEL do netlify/functions/p.js (landing pública da proposta).
import { getStore, connectLambda } from '../_shared/blobs-shim.mjs';
import crypto from 'node:crypto';

const now = () => new Date().toISOString();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// escape p/ contexto <script> inline: neutraliza </script>, <!-- e separadores de linha JS
const js = (v) => JSON.stringify(String(v == null ? '' : v)).replace(/</g, '\u003c').replace(/>/g, '\u003e');
const telWa = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 12 ? d : d.length >= 10 ? '55' + d : d; };
const fmtBRL = (v) => { const n = Number(v) || 0; return n ? 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : ''; };
const fmtArea = (v) => { const n = Number(v) || 0; return n ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m²' : ''; };
const html = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body });
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
// bots/preview-crawlers a NÃO contar. NÃO inclui "whatsapp" — o navegador in-app do WhatsApp (onde o cliente abre) tem "WhatsApp" na UA e é uma abertura REAL.
const ehBot = (ua) => /bot\b|facebookexternalhit|crawler|spider|slurp|bingpreview|telegrambot|googlebot|bingbot|yandex|applebot|twitterbot|discordbot|slackbot|linkpreview|embedly|preview/i.test(String(ua || ''));
const MAX_EVENTOS = 50;

const aviso = (code, msg) => html(code, `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Proposta Diamond</title><body style="margin:0;font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#0d0d0d;color:#eee;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px"><div><div style="color:#e4f72b;font-weight:800;font-size:28px;letter-spacing:.13em">DIAMOND</div><p style="margin-top:14px;color:#aaa">${esc(msg)}</p></div></body>`);

function landing(id, ev, domoNum, base, logoUri, selfUrl) {
  const num = telWa(ev.corretorTel) || telWa(domoNum || '11972746113'); // sem tel do corretor → cai no WhatsApp da Domo
  const cli = esc(ev.cliente || 'você');
  const un = esc(ev.unidade || '');
  const cor = esc(ev.corretor || 'o corretor');
  const emp = esc(ev.empresa || ''); // imobiliária do corretor (NÃO é a Domo — o prédio é que é da Domo)
  // teaser: valor/área/andar aparecem ANTES de abrir o PDF (a landing deixa de ser "porta vazia")
  const valorTxt = fmtBRL(ev.valor);
  const areaTxt = fmtArea(ev.area);
  const andarTxt = (ev.andar || ev.andar === 0) ? (Number(ev.andar) === 0 ? 'Térreo' : esc(ev.andar) + 'º andar') : '';
  // validade: 7 dias a partir da geração — não bloqueia, mas avisa se passou
  const emDate = ev.em ? new Date(ev.em) : null;
  const dias = emDate && !isNaN(emDate) ? Math.floor((Date.now() - emDate.getTime()) / 86400000) : null;
  const geradaEm = emDate && !isNaN(emDate) ? emDate.toLocaleDateString('pt-BR') : '';
  const vencida = dias != null && dias > 7;
  const ogDesc = esc((valorTxt ? valorTxt + ' · ' : '') + 'Sua proposta da unidade ' + (ev.unidade || '') + ' no Edifício Diamond. Toque para ver os detalhes.');
  const ogImg = esc((base || 'https://diamond-vendas.netlify.app') + '/icon-512.png');
  return html(200, `<!doctype html><html lang=pt-BR><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Sua proposta · Edifício Diamond</title>
<meta property="og:title" content="Sua proposta · Edifício Diamond">
<meta property="og:description" content="${ogDesc}">
<meta property="og:image" content="${ogImg}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary"><style>
*{box-sizing:border-box;margin:0}body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#0d0d0d;color:#f0f0f0;min-height:100vh;padding:30px 20px;display:flex;justify-content:center}
.wrap{max-width:440px;width:100%}.logo{color:#e4f72b;font-weight:800;font-size:32px;letter-spacing:.14em;text-align:center}.sub{color:#9a9a9a;text-align:center;font-size:13px;margin-top:4px}
.card{background:#171717;border:1px solid #262626;border-radius:16px;padding:24px;margin-top:24px}.oi{font-size:20px;font-weight:700}.oi span{color:#e4f72b}
.un{color:#c2c2c2;margin-top:10px;font-size:15px}.btn{display:block;width:100%;text-align:center;text-decoration:none;padding:16px;border-radius:12px;font-weight:700;font-size:16px;border:0;cursor:pointer;font-family:inherit}
.btn-pdf{background:#e4f72b;color:#000;margin-top:18px}.q{color:#9a9a9a;font-size:14px;margin:24px 0 10px;text-align:center}.acoes{display:flex;gap:10px}
.btn-sim{background:#1f2d10;color:#c7f24a;border:1px solid #3a5216}.btn-duv{background:#1c1c1c;color:#eee;border:1px solid #333}
.ok{text-align:center;color:#c7f24a;font-weight:700;margin-top:20px;display:none;line-height:1.5}.foot{color:#666;font-size:12px;text-align:center;margin-top:26px}
.imob-logo{text-align:center;margin-top:26px}.imob-logo span{display:block;color:#8a8a8a;font-size:11px;margin-bottom:7px}.imob-logo img{max-height:44px;max-width:190px;background:#fff;border-radius:8px;padding:5px 9px}
.teaser{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}.t-item{flex:1;min-width:96px;background:#111;border:1px solid #262626;border-radius:12px;padding:12px 14px}
.t-lab{color:#8a8a8a;font-size:11px;text-transform:uppercase;letter-spacing:.05em}.t-val{font-weight:700;font-size:15px;margin-top:3px}.t-val.big{color:#e4f72b;font-size:21px}
.validade{color:#8a8a8a;font-size:12px;text-align:center;margin-top:14px}.validade.venc{color:#e7b64b;background:#241d0b;border:1px solid #3d3212;border-radius:10px;padding:10px 12px;line-height:1.5}</style></head>
<body><div class=wrap>
<div class=logo>DIAMOND</div><div class=sub>Edifício Diamond · Domo Construtora</div>
<div class=card>
<div class=oi>Olá, <span>${cli}</span>! 👋</div>
<div class=un>Sua proposta da <b>unidade ${un}</b> está pronta:</div>
${(valorTxt || areaTxt || andarTxt) ? `<div class=teaser>
${valorTxt ? `<div class=t-item><div class=t-lab>Valor</div><div class="t-val big">${esc(valorTxt)}</div></div>` : ''}
${areaTxt ? `<div class=t-item><div class=t-lab>Área privativa</div><div class=t-val>${esc(areaTxt)}</div></div>` : ''}
${andarTxt ? `<div class=t-item><div class=t-lab>Andar</div><div class=t-val>${andarTxt}</div></div>` : ''}
</div>` : ''}
<a class="btn btn-pdf" href="${esc(selfUrl)}?pdf=1" target="_blank" rel="noopener">📄 Ver proposta completa (PDF)</a>
${geradaEm ? `<div class="validade${vencida ? ' venc' : ''}">${vencida
  ? '⚠ Proposta gerada em ' + geradaEm + ' (há ' + dias + ' dias). Os valores podem ter mudado — confirme com ' + cor + ' antes de decidir.'
  : 'Gerada em ' + geradaEm + ' · válida por 7 dias.'}</div>` : ''}
<div class=q>O que você achou? Responda ao corretor:</div>
<div class=acoes id=acoes>
<button class="btn btn-sim" onclick="acao('interesse')">✅ Tenho interesse</button>
<button class="btn btn-duv" onclick="acao('duvida')">💬 Tirar dúvida</button>
</div>
<div class=ok id=ok>Perfeito! ${cor} foi avisado e já vai te chamar aqui no WhatsApp. 🎉</div>
</div>
${logoUri ? `<div class=imob-logo><span>apresentado por</span><img src="${logoUri}" alt="${emp}"></div>` : ''}
<div class=foot>${ev.numero ? 'Proposta nº ' + String(ev.numero).padStart(3, '0') + ' · ' : ''}enviada por ${cor}${emp ? ' · ' + emp : ''}</div>
</div><script>
var ID=${js(id)},NUM=${js(num)},UN=${js(ev.unidade || '')},SELF=${js(selfUrl)};
function reg(t){var b=JSON.stringify({acao:t});try{if(!navigator.sendBeacon(SELF,new Blob([b],{type:'application/json'})))throw 0;}catch(e){fetch(SELF,{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true})}}
function acao(t){reg(t);document.getElementById('acoes').style.display='none';document.querySelector('.q').style.display='none';document.getElementById('ok').style.display='block';
if(NUM){var m=t==='duvida'?('Olá! Tenho uma dúvida sobre a proposta da unidade '+UN+' do Edifício Diamond.'):('Olá! Tenho interesse na unidade '+UN+' do Edifício Diamond. Podemos conversar?');setTimeout(function(){location.href='https://wa.me/'+NUM+'?text='+encodeURIComponent(m)},700)}}
</script></body></html>`);
}

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

  // GET landing → conta a abertura (menos bots/preview e menos o ?preview do painel) e mostra a página
  let ev;
  try { ev = await envios.get(id, { type: 'json' }); } catch (e) { ev = null; }
  if (!ev) return aviso(404, 'Proposta não encontrada — o link pode ter sido removido.');
  if (!ehBot(ua) && !q.preview) { try { ev.views = (ev.views || 0) + 1; ev.lastView = now(); if (!ev.firstView) ev.firstView = ev.lastView; await envios.setJSON(id, ev); } catch (e) {} }
  // WhatsApp da Domo como fallback quando o corretor não tem telefone (senão o comprador fica sem canal)
  let domoNum = '11972746113';
  try { const c = await getStore('cfg').get('cfg', { type: 'json' }); if (c && c.contatoWhats) domoNum = c.contatoWhats; } catch (e) {}
  const h = event.headers || {};
  const base = (h['x-forwarded-proto'] || 'https') + '://' + (h.host || 'diamond-vendas.netlify.app');
  // logo da imobiliária (opcional) — embutida como data URI no rodapé
  let logoUri = '';
  try { if (ev.logoId) { const lf = await getStore('fotos').get(ev.logoId, { type: 'json' }); if (lf && lf.base64) logoUri = 'data:' + (lf.mime || 'image/jpeg') + ';base64,' + lf.base64; } } catch (e) {}
  // URL PÚBLICA da própria function: nem req.url nem os headers internos são públicos — a fonte confiável é a env SUPABASE_URL
  const selfUrl = (Deno.env.get('SUPABASE_URL') || 'https://reoghclxripktzpdwhiy.supabase.co') + '/functions/v1/dmd-p/' + id;
  return landing(id, ev, domoNum, base, logoUri, selfUrl);
};
