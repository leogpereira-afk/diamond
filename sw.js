// sw.js — service worker versionado (padrão blueprint: bump a cada deploy)
const CACHE = 'diamond-pages-v33';
const SHELL = ['clientes-painel.js?v=33','gestao-domain.js?v=33','gestao.js?v=33','gestao.css?v=33','navegacao.js?v=33','navegacao.css?v=33','vendor/jspdf.umd.min.js?v=33','envios-domain.js?v=33','envios.js?v=33','envios.css?v=33','vagas-disponiveis.js?v=33','./', 'index.html', 'styles.css?v=33', 'config.js?v=33', 'plano.js?v=33', 'store.js?v=33', 'app.js?v=33','reservas.js?v=33','reservas.css?v=33',
  'vagas-domain.js?v=33','vagas-pdf.js?v=33','vagas.js?v=33','vagas.css?v=33','logo-diamond.png','selo.png', 'wordmark.png', 'pdf-diamond.jpg', 'pdf-domo.jpg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
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
    try {
      // `cache: 'reload'` PULA o cache HTTP do navegador: sem isto, network-first
      // ainda entregava o arquivo velho que o GitHub Pages mandou guardar por ~10
      // min, e todo deploy demorava a aparecer para quem já tinha o site aberto.
      // Agora a rede é sempre a de verdade; o cache do SW é só para quando cai.
      const net = await fetch(e.request, { cache: 'reload' });
      const c = await caches.open(CACHE);
      c.put(e.request, net.clone());
      return net;
    } catch (err) {
      const hit = await caches.match(e.request);
      return hit || Response.error();
    }
  })());
});
