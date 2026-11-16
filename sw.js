// sw.js — service worker versionado (padrão blueprint: bump a cada deploy)
const CACHE = 'diamond-pages-v79';
const SHELL = ['caixa-pdf.js?v=79','caixa-money-domain.js?v=79','previsao-graficos-domain.js?v=79','previsao-pdf.js?v=79','caixa-dashboard-domain.js?v=79','caixa-dashboard.js?v=79','caixa-dashboard.css?v=79','caixa-domain.js?v=79','caixa.js?v=79','caixa.css?v=79','previsao-custo-schema.js?v=79','previsao-custo-domain.js?v=79','previsao-cobertura-domain.js?v=79','previsao-custo-store.js?v=79','previsao-custo.js?v=79','previsao-custo.css?v=79','corretores-domain.js?v=79','vendas-editor.js?v=79','vendas-editor.css?v=79','visual.js?v=79','visual.css?v=79','negociacoes.js?v=79','negociacoes.css?v=79','proposta-domain.js?v=79','precos.js?v=79','precos.css?v=79','clientes-editor.js?v=79','clientes-painel.js?v=79','gestao-domain.js?v=79','gestao.js?v=79','gestao-insights.js?v=79','gestao-painel.js?v=79','gestao-painel.css?v=79','gestao.css?v=79','navegacao.js?v=79','navegacao.css?v=79','vendor/jspdf.umd.min.js?v=79','envios-domain.js?v=79','envios.js?v=79','envios.css?v=79','vagas-disponiveis.js?v=79','./', 'index.html', 'styles.css?v=79', 'config.js?v=79', 'plano.js?v=79', 'disponibilidade-live.js?v=79', 'store.js?v=79', 'app.js?v=79','reservas.js?v=79','reservas.css?v=79',
  'vagas-vinculo.js?v=79','vagas-domain.js?v=79','vagas-pdf.js?v=79','vagas.js?v=79','vagas.css?v=79','logo-diamond.png','selo.png', 'wordmark.png', 'pdf-diamond.jpg', 'pdf-domo.jpg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
const CDN = [];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // `cache: 'reload'` também AQUI: sem isto, addAll aceitava o arquivo velho que o
    // cache HTTP do navegador ainda guardava para a MESMA URL e o assava dentro do
    // cache novo — foi assim que a tela nova rodou com as regras antigas (21/09).
    await c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))); // falha ⇒ aborta ⇒ cache antigo íntegro permanece
    await Promise.allSettled(CDN.map((u) => c.add(u))); // CDN não bloqueia
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('diamond-pages-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.hostname.endsWith('supabase.co')) return; // NUNCA cachear API/Supabase
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    // O shell foi instalado por inteiro com esta versão. Arquivos da versão
    // atual não precisam atravessar a rede em toda abertura do sistema.
    const instalado = url.origin === self.location.origin && SHELL.some(u => u !== './' && u !== 'index.html' && new URL(u, self.location.href).href === url.href);
    if (instalado) { const hit = await c.match(e.request); if (hit) return hit; }
    try {
      // HTML e URLs de outras versões consultam a rede para receber publicações.
      const net = await fetch(e.request, { cache: 'reload' });
      if (net.ok) await c.put(e.request, net.clone()).catch(() => {});
      return net;
    } catch (err) {
      const hit = await c.match(e.request);
      return hit || Response.error();
    }
  })());
});
