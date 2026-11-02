// sw.js — service worker versionado (padrão blueprint: bump a cada deploy)
const CACHE = 'diamond-pages-v66';
const SHELL = ['caixa-dashboard-domain.js?v=66','caixa-dashboard.js?v=66','caixa-dashboard.css?v=66','caixa-domain.js?v=66','caixa.js?v=66','caixa.css?v=66','previsao-custo-schema.js?v=66','previsao-custo-domain.js?v=66','previsao-cobertura-domain.js?v=66','previsao-custo-store.js?v=66','previsao-custo.js?v=66','previsao-custo.css?v=66','corretores-domain.js?v=66','vendas-editor.js?v=66','vendas-editor.css?v=66','visual.js?v=66','visual.css?v=66','negociacoes.js?v=66','negociacoes.css?v=66','proposta-domain.js?v=66','precos.js?v=66','precos.css?v=66','clientes-editor.js?v=66','clientes-painel.js?v=66','gestao-domain.js?v=66','gestao.js?v=66','gestao-insights.js?v=66','gestao-painel.js?v=66','gestao-painel.css?v=66','gestao.css?v=66','navegacao.js?v=66','navegacao.css?v=66','vendor/jspdf.umd.min.js?v=66','envios-domain.js?v=66','envios.js?v=66','envios.css?v=66','vagas-disponiveis.js?v=66','./', 'index.html', 'styles.css?v=66', 'config.js?v=66', 'plano.js?v=66', 'disponibilidade-live.js?v=66', 'store.js?v=66', 'app.js?v=66','reservas.js?v=66','reservas.css?v=66',
  'vagas-vinculo.js?v=66','vagas-domain.js?v=66','vagas-pdf.js?v=66','vagas.js?v=66','vagas.css?v=66','logo-diamond.png','selo.png', 'wordmark.png', 'pdf-diamond.jpg', 'pdf-domo.jpg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
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
