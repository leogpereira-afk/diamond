// sw.js — service worker versionado (padrão blueprint: bump a cada deploy)
const CACHE = 'diamond-pages-v77';
const SHELL = ['caixa-pdf.js?v=77','caixa-money-domain.js?v=77','previsao-graficos-domain.js?v=77','previsao-pdf.js?v=77','caixa-dashboard-domain.js?v=77','caixa-dashboard.js?v=77','caixa-dashboard.css?v=77','caixa-domain.js?v=77','caixa.js?v=77','caixa.css?v=77','previsao-custo-schema.js?v=77','previsao-custo-domain.js?v=77','previsao-cobertura-domain.js?v=77','previsao-custo-store.js?v=77','previsao-custo.js?v=77','previsao-custo.css?v=77','corretores-domain.js?v=77','vendas-editor.js?v=77','vendas-editor.css?v=77','visual.js?v=77','visual.css?v=77','negociacoes.js?v=77','negociacoes.css?v=77','proposta-domain.js?v=77','precos.js?v=77','precos.css?v=77','clientes-editor.js?v=77','clientes-painel.js?v=77','gestao-domain.js?v=77','gestao.js?v=77','gestao-insights.js?v=77','gestao-painel.js?v=77','gestao-painel.css?v=77','gestao.css?v=77','navegacao.js?v=77','navegacao.css?v=77','vendor/jspdf.umd.min.js?v=77','envios-domain.js?v=77','envios.js?v=77','envios.css?v=77','vagas-disponiveis.js?v=77','./', 'index.html', 'styles.css?v=77', 'config.js?v=77', 'plano.js?v=77', 'disponibilidade-live.js?v=77', 'store.js?v=77', 'app.js?v=77','reservas.js?v=77','reservas.css?v=77',
  'vagas-vinculo.js?v=77','vagas-domain.js?v=77','vagas-pdf.js?v=77','vagas.js?v=77','vagas.css?v=77','logo-diamond.png','selo.png', 'wordmark.png', 'pdf-diamond.jpg', 'pdf-domo.jpg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
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
