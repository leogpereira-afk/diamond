// sw.js — service worker versionado (padrão blueprint: bump a cada deploy)
const CACHE = 'diamond-pages-v11';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'plano.js', 'store.js', 'app.js',
  'selo.png', 'wordmark.png', 'pdf-diamond.jpg', 'pdf-domo.jpg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
const CDN = ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL); // falha ⇒ aborta ⇒ cache antigo íntegro permanece
    await Promise.allSettled(CDN.map((u) => c.add(u))); // CDN não bloqueia
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/.netlify/functions/') || url.hostname.endsWith('supabase.co')) return; // NUNCA cachear API/Supabase
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
