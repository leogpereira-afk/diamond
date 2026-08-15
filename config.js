// config.js — segredo leve do app (mesmo valor da env TOKEN no Netlify)
window.APP_TOKEN = 'dmd-b76c186ad7d614a529ac66eb944d42bd';

// backend Supabase (Edge Functions) — a cópia do GitHub Pages fala com estas URLs
window.API_BASE = 'https://reoghclxripktzpdwhiy.supabase.co/functions/v1';
window.P_URL = window.API_BASE + '/dmd-p'; // landing pública da proposta (link do WhatsApp)
