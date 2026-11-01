// sw.js — service worker versionado (padrão blueprint: bump a cada deploy)
const CACHE = 'diamond-pages-v59';
const SHELL = ['previsao-custo-domain.js?v=59','previsao-custo-store.js?v=59','previsao-custo.js?v=59','previsao-custo.css?v=59','corretores-domain.js?v=59','vendas-editor.js?v=59','vendas-editor.css?v=59','visual.js?v=59','visual.css?v=59','negociacoes.js?v=59','negociacoes.css?v=59','proposta-domain.js?v=59','precos.js?v=59','precos.css?v=59','clientes-editor.js?v=59','clientes-painel.js?v=59','gestao-domain.js?v=59','gestao.js?v=59','gestao-insights.js?v=59','gestao-painel.js?v=59','gestao-painel.css?v=59','gestao.css?v=59','navegacao.js?v=59','navegacao.css?v=59','vendor/jspdf.umd.min.js?v=59','envios-domain.js?v=59','envios.js?v=59','envios.css?v=59','vagas-disponiveis.js?v=59','./', 'index.html', 'styles.css?v=59', 'config.js?v=59', 'plano.js?v=59', 'disponibilidade-live.js?v=59', 'store.js?v=59', 'app.js?v=59','reservas.js?v=59','reservas.css?v=59',
  'vagas-vinculo.js?v=59','vagas-domain.js?v=59','vagas-pdf.js?v=59','vagas.js?v=59','vagas.css?v=59','logo-diamond.png','selo.png', 'wordmark.png', 'pdf-diamond.jpg', 'pdf-domo.jpg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
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
