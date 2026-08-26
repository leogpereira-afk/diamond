// store.js — camada de dados/sync offline-first (padrão Impresilk, blueprint-sync-nuvem.md)
// Expõe window.STORE. Dados em localStorage, fotos em IndexedDB, fila assinada com versão.
const STORE = (() => {
  const API_URL = window.API_BASE + '/dmd-api'; // Supabase Edge Function (antes: /.netlify/functions/api)
  const K = { un: 'dv_unidades', cfg: 'dv_cfg', user: 'dv_user', fila: 'dv_fila', last: 'dv_lastsync', prop: 'dv_propostas', usuarios: 'dv_usuarios', leads: 'dv_leads', reservas: 'dv_reservas' };
  let _syncing = false;
  const _flagged = new Set();
  const _falhas = {};
  let _ultimoErro = null; // { tipo:'descartado'|'auth' } — alteração que NÃO subiu; some quando um item volta a sincronizar
  const ouvintes = { sync: [], dados: [] };

  // ---------- util ----------
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const now = () => new Date().toISOString();
  const on = (ev, fn) => ouvintes[ev].push(fn);
  const emit = (ev, x) => ouvintes[ev].forEach((f) => { try { f(x); } catch (e) {} });

  async function sha256(txt) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function diaLocalISO(iso) { const s = String(iso); return s.includes('T') ? ymdLocal(new Date(s)) : s.slice(0, 10); }
  function ymdLocal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  // ---------- API ----------
  async function api(action, body = {}) {
    const sess = getUser();
    const payload = { action, ...body };
    if (sess && !payload.auth) payload.auth = { usuario: sess.usuario, senhaHash: sess.senhaHash };
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-token': window.APP_TOKEN },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.erro || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return data;
  }

  // ---------- sessão (localStorage = manter conectado; sessionStorage = só nesta aba) ----------
  function getUser() {
    try { const s = sessionStorage.getItem(K.user); if (s) return JSON.parse(s); } catch (e) {}
    return lsGet(K.user, null);
  }
  function setUser(sess, lembrar) {
    localStorage.removeItem(K.user); sessionStorage.removeItem(K.user);
    if (lembrar) lsSet(K.user, sess);
    else { try { sessionStorage.setItem(K.user, JSON.stringify(sess)); } catch (e) { lsSet(K.user, sess); } }
  }
  // ao trocar de usuário no MESMO aparelho, descarta caches/fila do dono anterior
  // (evita vazar dados de A para B e enviar a fila de A sob a credencial de B)
  function limparDadosLocais() {
    [K.un, K.cfg, K.prop, K.usuarios, K.fila, K.last, K.leads, K.reservas].forEach((k) => localStorage.removeItem(k));
  }
  async function login(usuario, senha, lembrar) {
    const senhaHash = await sha256(String(senha).trim()); // ignora espaços acidentais na senha (comum no teclado do celular)
    const login0 = usuario.toLowerCase().trim();
    const r = await api('login', { usuario: login0, senhaHash, auth: { usuario, senhaHash } });
    // LOGIN ÚNICO DE CORRETOR: o servidor devolveu o elenco (todos os nomes) em vez
    // de uma conta. Guarda uma sessão TEMPORÁRIA (sem escolher nome ainda); a tela de
    // "quem está acessando" lista o elenco e chama entrarComoUniversal ao clicar.
    if (r && r.universal) {
      const dono0 = localStorage.getItem('dv_owner');
      if (dono0 && dono0 !== 'corretor') limparDadosLocais();
      localStorage.setItem('dv_owner', 'corretor');
      const tmp = { _universal: true, aguardandoNome: true, papel: 'corretor', usuario: 'corretor',
        nome: 'Corretores', senhaHashUniversal: senhaHash, elenco: Array.isArray(r.elenco) ? r.elenco : [], corretorAtivo: null };
      setUser(tmp, lembrar !== false);
      return tmp;
    }
    const dono = localStorage.getItem('dv_owner');
    if (dono && dono !== r.usuario) limparDadosLocais(); // dono anterior diferente → começa limpo
    localStorage.setItem('dv_owner', r.usuario);
    const sess = { usuario: r.usuario, nome: r.nome, telefone: r.telefone, papel: r.papel, empresa: r.empresa || '',
      corretores: Array.isArray(r.corretores) ? r.corretores : [], corretorAtivo: null, senhaHash,
      ehMaster: !!r.ehMaster, temSenhaEquipe: !!r.temSenhaEquipe, logoId: r.logoId || '' }; // a SENHA usada define o papel (master x equipe)
    setUser(sess, lembrar !== false);
    // migra os hashes legados p/ salgado UMA vez, disparado pelo ADMIN (single-writer; o login é read-only no servidor).
    // fire-and-forget: não trava o login e é idempotente (só migra o que ainda é legado; depois vira no-op).
    if (r.papel === 'admin') {
      api('migrarSenhasLegado', { auth: { usuario: r.usuario, senhaHash } }).catch(() => {});
      api('numerarEnvios', { auth: { usuario: r.usuario, senhaHash } }).catch(() => {}); // numera as propostas antigas (idempotente)
    }
    return sess;
  }
  // Finaliza o login único: a pessoa clicou no nome dela. A sessão passa a ser a da
  // imobiliária dela COMO MEMBRO DE EQUIPE (vê só os próprios clientes). O crachá é a
  // senha única (senhaHashUniversal), que o servidor aceita como senha de equipe de
  // qualquer imobiliária (validarUsuario/viaUniversal).
  function entrarComoUniversal(pick) {
    const cur = getUser() || {};
    const lembrar = !!localStorage.getItem(K.user);
    const dono = localStorage.getItem('dv_owner');
    if (dono && dono !== pick.empresaLogin) limparDadosLocais();
    localStorage.setItem('dv_owner', pick.empresaLogin);
    const sess = {
      usuario: pick.empresaLogin, nome: pick.empresaNome, papel: 'corretor', empresa: pick.empresaNome,
      corretores: [{ nome: pick.nome, telefone: pick.telefone || '' }],
      corretorAtivo: { nome: pick.nome, telefone: pick.telefone || '' },
      senhaHash: cur.senhaHashUniversal, senhaHashUniversal: cur.senhaHashUniversal,
      ehMaster: false, temSenhaEquipe: true, _universal: true, elenco: cur.elenco || [], logoId: '',
    };
    setUser(sess, lembrar);
    lsSet(K.leads, []); lsSet(K.prop, []); // escopo por corretor: começa limpo
    return sess;
  }
  // Define/remove a senha ÚNICA do login de corretor (admin ou domo). Senha vazia remove.
  async function setSenhaCorretorGeral(senha) {
    const s = getUser(); if (!s) throw new Error('sessão inválida');
    const senhaHash = senha ? await sha256(String(senha).trim()) : '';
    return api('setSenhaCorretorGeral', { senhaHash, auth: { usuario: s.usuario, senhaHash: s.senhaHash } });
  }
  // define/troca a senha COMPARTILHADA da equipe (só o master; admin pode passar usuario da empresa)
  async function setSenhaEquipe(senhaNova, usuarioEmpresa) {
    const s = getUser(); if (!s) throw new Error('sessão inválida');
    await api('setSenhaEquipe', { senhaNova, usuario: usuarioEmpresa, auth: { usuario: s.usuario, senhaHash: s.senhaHash } });
    if (!usuarioEmpresa || usuarioEmpresa === s.usuario) { s.temSenhaEquipe = true; setUser(s, !!localStorage.getItem(K.user)); }
    return true;
  }
  // define quem está acessando (empresa com login compartilhado); persiste no mesmo modo da sessão
  function setCorretorAtivo(nome, telefone) {
    const s = getUser(); if (!s) return;
    const antes = (s.corretorAtivo && s.corretorAtivo.nome) || '';
    s.corretorAtivo = { nome, telefone: telefone || '' };
    setUser(s, !!localStorage.getItem(K.user));
    // leads e propostas são ESCOPADOS por corretor (o servidor filtra) → trocar de corretor zera e repuxa
    if (antes !== nome) { lsSet(K.leads, []); lsSet(K.prop, []); }
  }
  // a EMPRESA edita a própria lista de corretores; servidor só deixa mexer no próprio usuário.
  // renomeados = [{de, para}] → servidor guarda alias p/ os leads antigos não ficarem órfãos.
  async function setMeusCorretores(corretores, renomeados) {
    const s = getUser(); if (!s) throw new Error('sessão inválida');
    const r = await api('setMeusCorretores', { corretores, renomeados: renomeados || [], auth: { usuario: s.usuario, senhaHash: s.senhaHash } });
    s.corretores = Array.isArray(r.corretores) ? r.corretores : [];
    const a = s.corretorAtivo;
    if (a && a.nome) {
      const ren = (renomeados || []).find((x) => x.de === a.nome); // se o ativo foi renomeado, segue com o nome novo
      if (ren) { s.corretorAtivo = { nome: ren.para, telefone: (s.corretores.find((c) => c.nome === ren.para) || {}).telefone || '' }; lsSet(K.leads, []); }
      else if (!s.corretores.some((c) => c.nome === a.nome && c.telefone === (a.telefone || ''))) s.corretorAtivo = null; // ativo removido (match nome+telefone p/ homônimos) → volta ao picker
    }
    setUser(s, !!localStorage.getItem(K.user));
    return s.corretores;
  }
  // sobe o PDF da proposta e devolve o LINK público (o cliente abre pelo link no WhatsApp)
  async function enviarPropostaPdf(base64, meta) {
    const s = getUser(); if (!s) throw new Error('sessão inválida');
    const m = meta || {};
    const r = await api('putPropostaPdf', { base64, unidade: m.unidade || '', valor: m.valor || 0, area: m.area || 0, andar: m.andar, cliente: m.cliente || '', corretor: m.corretor || '', corretorTel: m.corretorTel || '', empresa: m.empresa || '', logoId: s.logoId || '', propostaId: m.propostaId || '', leadId: m.leadId || '', auth: { usuario: s.usuario, senhaHash: s.senhaHash } });
    return window.P_URL + '/' + r.id; // a landing vive na Edge Function dmd-p
  }
  // aberturas/interesse dos links (escopado pelo servidor: admin=tudo, master=empresa, corretor=os seus)
  async function listEnvios() { const r = await api('listEnvios', { comoCorretor: _como() }); return r.envios || []; }
  // ---------- pedidos de reserva pendentes (todos veem: é o aviso do espelho) ----------
  const getReservas = () => lsGet(K.reservas, []);
  async function pullReservas() {
    if (!navigator.onLine || !getUser()) return getReservas();
    try { const r = await api('listReservas'); lsSet(K.reservas, r.reservas || []); emit('dados', { tipo: 'reservas' }); } catch (e) {}
    return getReservas();
  }
  async function pedirReserva(dados, mesmoAssim) {
    const r = await api('pedirReserva', { ...dados, mesmoAssim: !!mesmoAssim });
    if (r.reserva) { const l = getReservas().filter((x) => x.unidadeId !== r.reserva.unidadeId); l.push(r.reserva); lsSet(K.reservas, l); emit('dados', { tipo: 'reservas' }); }
    return r;
  }
  async function excluirReserva(unidadeId) {
    await api('delReserva', { unidadeId });
    lsSet(K.reservas, getReservas().filter((x) => x.unidadeId !== unidadeId));
    emit('dados', { tipo: 'reservas' });
  }
  // ---------- CRM / leads (clientes do corretor) — offline-first: escreve local + enfileira ----------
  const _como = () => { const s = getUser() || {}; return (s.corretorAtivo && s.corretorAtivo.nome) || ''; };
  const getLeads = () => lsGet(K.leads, []);
  // grava local NA HORA (some o lag do list()) e enfileira p/ o servidor; funciona offline
  function salvarLead(lead) {
    const s = getUser(); if (!s) throw new Error('sessão inválida');
    const lista = getLeads();
    const i = lista.findIndex((x) => x.id === lead.id);
    const base = i >= 0 ? lista[i] : {
      empresaUsuario: s.usuario, empresaNome: s.papel === 'admin' ? '' : (s.nome || ''),
      corretorNome: _como() || s.nome || '', corretorTel: (s.corretorAtivo && s.corretorAtivo.telefone) || '', criadoEm: now(),
    };
    const nova = { ...base, ...lead, atualizadoEm: now() };
    if (i >= 0) lista[i] = nova; else lista.push(nova);
    lsSet(K.leads, lista);
    emit('dados', { tipo: 'leads' });
    enqueue({ action: 'upsertLead', lead: nova, comoCorretor: _como() });
    return nova;
  }
  function excluirLead(id) {
    lsSet(K.leads, getLeads().filter((x) => x.id !== id));
    emit('dados', { tipo: 'leads' });
    enqueue({ action: 'delLead', id, comoCorretor: _como() });
    return true;
  }
  // puxa os leads do servidor p/ o espelho local (escopo = corretor ativo; o servidor filtra)
  async function pullLeads() {
    const s = getUser(); if (!s || !navigator.onLine) return getLeads();
    if (s.papel !== 'admin' && !_como()) return getLeads(); // empresa sem corretor escolhido: nada a puxar
    try {
      const fila = filaGet();
      const delPend = new Set(fila.filter((x) => x.action === 'delLead').map((x) => x.id));
      const upPend = new Set(fila.filter((x) => x.action === 'upsertLead').map((x) => x.lead.id));
      const r = await api('listLeads', { comoCorretor: _como() });
      const vistas = new Set();
      for (const l of r.leads || []) { vistas.add(l.id); if (!delPend.has(l.id)) aplicaLead(l); }
      // varredura de exclusão (preserva o que está na fila E o que é RECENTE: o list() do Blobs
      // demora a enumerar um blob novo — sem isso o lead recém-salvo sumiria da tela ao recarregar)
      const agora = Date.now();
      const recente = (l) => (agora - Date.parse(l.atualizadoEm || l.criadoEm || 0)) < 120000;
      lsSet(K.leads, getLeads().filter((l) => vistas.has(l.id) || upPend.has(l.id) || delPend.has(l.id) || recente(l)));
      emit('dados', { tipo: 'leads' });
    } catch (e) { /* offline/transitório: fica com o espelho local */ }
    return getLeads();
  }

  // a empresa (ou admin) troca a PRÓPRIA senha de login
  async function trocarMinhaSenha(senhaNova) {
    const s = getUser(); if (!s) throw new Error('sessão inválida');
    const r = await api('setSenha', { senhaNova, auth: { usuario: s.usuario, senhaHash: s.senhaHash } });
    s.senhaHash = r.senhaHash;
    setUser(s, !!localStorage.getItem(K.user));
    return true;
  }
  function logout() { localStorage.removeItem(K.user); sessionStorage.removeItem(K.user); }
  const isAdmin = () => { const u = getUser(); return !!u && u.papel === 'admin'; };
  const ehDomo = () => { const u = getUser(); return !!u && u.usuario === 'domo'; };       // login da construtora
  const podeVerPainel = () => isAdmin() || ehDomo();                                          // vê tudo (admin OU domo)
  // muda SÓ o status + vendedor de uma unidade (admin/domo). Direto no servidor + atualiza local.
  async function setVendedor(unidade, status, vendedorNome, vendedorEmpresa) {
    const s = getUser(); if (!s) throw new Error('sessão inválida');
    const r = await api('setVendedor', { unidade, status, vendedorNome, vendedorEmpresa, auth: { usuario: s.usuario, senhaHash: s.senhaHash } });
    if (r && r.unidade) { const arr = getUnidades(); const i = arr.findIndex((u) => u.id === r.unidade.id); if (i >= 0) { arr[i] = r.unidade; localStorage.setItem(K.un, JSON.stringify(arr)); } }
    return r;
  }

  // ---------- dados locais ----------
  const getUnidades = () => lsGet(K.un, []);
  const getCfg = () => lsGet(K.cfg, null);
  const getPropostas = () => lsGet(K.prop, []);
  const getUsuarios = () => lsGet(K.usuarios, []);
  const unidadePorId = (id) => getUnidades().find((u) => u.id === id);

  // ---------- fila offline (assinatura por item, remoção sensível à versão) ----------
  const filaGet = () => lsGet(K.fila, []);
  const filaSet = (f) => { lsSet(K.fila, f); emit('sync', status()); };
  const assinatura = (it) =>
    it.action === 'upsert' ? 'upsert:' + it.unidade.id
    : it.action === 'del' ? 'del:' + it.id
    : it.action === 'putFoto' ? 'putFoto:' + it.fileId
    : it.action === 'delFoto' ? 'delFoto:' + it.fileId
    : it.action === 'upsertProposta' ? 'upsertProposta:' + it.proposta.id
    : it.action === 'delProposta' ? 'delProposta:' + it.id
    : it.action === 'upsertLead' ? 'upsertLead:' + it.lead.id
    : it.action === 'delLead' ? 'delLead:' + it.id
    : it.action === 'setCfg' ? 'setCfg' : it.action + ':' + Math.random();

  function enqueue(item) {
    let fila = filaGet();
    const sig = assinatura(item);
    if (item.action === 'upsert' || item.action === 'upsertProposta' || item.action === 'upsertLead' || item.action === 'setCfg') {
      fila = fila.filter((x) => assinatura(x) !== sig);
    }
    if (item.action === 'del') fila = fila.filter((x) => assinatura(x) !== 'upsert:' + item.id);
    if (item.action === 'delFoto') fila = fila.filter((x) => assinatura(x) !== 'putFoto:' + item.fileId);
    if (item.action === 'delLead') fila = fila.filter((x) => assinatura(x) !== 'upsertLead:' + item.id); // apagar cancela upsert pendente do mesmo lead
    fila.push(item);
    filaSet(fila);
    trySync();
  }

  function removeDaFila(item) {
    const sig = assinatura(item);
    let fila = filaGet();
    fila = fila.filter((x) => {
      if (assinatura(x) !== sig) return true;
      if (x.action === 'upsert') return x.unidade.atualizadoEm !== item.unidade.atualizadoEm; // versão mudou em voo → fica
      if (x.action === 'upsertProposta') return x.proposta.atualizadoEm !== item.proposta.atualizadoEm;
      if (x.action === 'upsertLead') return x.lead.atualizadoEm !== item.lead.atualizadoEm; // edição de lead em voo não é descartada
      if (x.action === 'setCfg') return x.cfg.atualizadoEm !== item.cfg.atualizadoEm; // edição de cfg em voo não é descartada
      return false;
    });
    filaSet(fila);
  }

  // ---------- mutações ----------
  function salvarUnidade(mut) {
    const lista = getUnidades();
    const i = lista.findIndex((u) => u.id === mut.id);
    const nova = { ...(i >= 0 ? lista[i] : {}), ...mut, atualizadoEm: now(), atualizadoPor: (getUser() || {}).usuario };
    if (i >= 0) lista[i] = nova; else lista.push(nova);
    lsSet(K.un, lista);
    emit('dados', { tipo: 'unidades' });
    enqueue({ action: 'upsert', unidade: nova });
    return nova;
  }
  function salvarCfg(cfg) {
    const c = { ...cfg, atualizadoEm: now() };
    lsSet(K.cfg, c);
    emit('dados', { tipo: 'cfg' });
    enqueue({ action: 'setCfg', cfg: c });
  }
  function salvarProposta(p) {
    const lista = getPropostas();
    const i = lista.findIndex((x) => x.id === p.id);
    const nova = { ...p, atualizadoEm: now() };
    if (i >= 0) lista[i] = nova; else lista.push(nova);
    lsSet(K.prop, lista);
    emit('dados', { tipo: 'propostas' });
    enqueue({ action: 'upsertProposta', proposta: nova });
    return nova;
  }
  function excluirProposta(id) {
    lsSet(K.prop, getPropostas().filter((x) => x.id !== id));
    emit('dados', { tipo: 'propostas' });
    enqueue({ action: 'delProposta', id });
  }
  // REATRIBUIR corretor: troca o dono do lead + das propostas do mesmo cliente (ação DIRETA no servidor,
  // não offline — é rara e precisa da autorização do servidor). No lead local aplica só os campos de DONO
  // (preserva edições de campo em andamento); as propostas vêm inteiras do servidor.
  async function reatribuirCorretor(leadId, alvo) {
    const r = await api('reatribuirCorretor', { leadId, alvo });
    if (r && r.lead) {
      const leads = getLeads(); const i = leads.findIndex((x) => x.id === r.lead.id);
      if (i >= 0) leads[i] = { ...leads[i], empresaUsuario: r.lead.empresaUsuario, empresaNome: r.lead.empresaNome, corretorNome: r.lead.corretorNome, corretorTel: r.lead.corretorTel, atualizadoEm: r.lead.atualizadoEm };
      else leads.push(r.lead);
      lsSet(K.leads, leads);
    }
    if (r && Array.isArray(r.propostas) && r.propostas.length) {
      const props = getPropostas();
      r.propostas.forEach((np) => { const j = props.findIndex((x) => x.id === np.id); if (j >= 0) props[j] = np; else props.push(np); });
      lsSet(K.prop, props);
    }
    emit('dados', { tipo: 'leads' });
    return r;
  }

  // ---------- fotos (IndexedDB) ----------
  let _db = null;
  function idb() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open('dv_fotos', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('fotos', { keyPath: 'id' });
      rq.onsuccess = () => { _db = rq.result; res(_db); };
      rq.onerror = () => rej(rq.error);
    });
  }
  async function fotoLocalSet(id, base64, mime) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('fotos', 'readwrite');
      tx.objectStore('fotos').put({ id, base64, mime });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function fotoLocalGet(id) {
    const db = await idb();
    return new Promise((res) => {
      const rq = db.transaction('fotos').objectStore('fotos').get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    });
  }
  async function comprimir(file, max = 1280, q = 0.75) {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej;
      i.src = URL.createObjectURL(file);
    });
    const esc = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * esc); cv.height = Math.round(img.height * esc);
    const cx2d = cv.getContext('2d');
    // fundo branco: PNG transparente virava BLOCO PRETO ao exportar JPEG (logos!)
    cx2d.fillStyle = '#fff'; cx2d.fillRect(0, 0, cv.width, cv.height);
    cx2d.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(img.src);
    return cv.toDataURL('image/jpeg', q).split(',')[1];
  }

  // foto por TIPO de planta (final 01..08 / LOJA) — uma imagem vale p/ a coluna toda
  async function anexarFotoTipo(tipo, file) {
    const base64 = await comprimir(file);
    const fileId = 'ft-' + tipo + '-' + Date.now();
    await fotoLocalSet(fileId, base64, 'image/jpeg');
    enqueue({ action: 'putFoto', fileId, mime: 'image/jpeg' });
    const cfg = getCfg() || {};
    const antiga = (cfg.fotosTipo || {})[tipo];
    salvarCfg({ ...cfg, fotosTipo: { ...(cfg.fotosTipo || {}), [tipo]: fileId } });
    if (antiga) enqueue({ action: 'delFoto', fileId: antiga });
    return fileId;
  }

  // gira a foto do tipo 90° horário (corrigir orientação/encaixe)
  async function girarFotoTipo(tipo) {
    const cfg = getCfg() || {};
    const fid = (cfg.fotosTipo || {})[tipo];
    if (!fid) return null;
    const f = await obterFoto(fid);
    if (!f) return null;
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej;
      i.src = `data:${f.mime};base64,${f.base64}`;
    });
    const cv = document.createElement('canvas');
    cv.width = img.height; cv.height = img.width;
    const cx = cv.getContext('2d');
    cx.translate(cv.width / 2, cv.height / 2);
    cx.rotate(Math.PI / 2);
    cx.drawImage(img, -img.width / 2, -img.height / 2);
    const b64 = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
    const novo = 'ft-' + tipo + '-' + Date.now();
    await fotoLocalSet(novo, b64, 'image/jpeg');
    enqueue({ action: 'putFoto', fileId: novo, mime: 'image/jpeg' });
    salvarCfg({ ...cfg, fotosTipo: { ...(cfg.fotosTipo || {}), [tipo]: novo } });
    enqueue({ action: 'delFoto', fileId: fid });
    return novo;
  }

  // fotos da página do empreendimento
  async function anexarFotoEmp(file) {
    const base64 = await comprimir(file, 1600, 0.78);
    const fileId = 'fe-' + Date.now() + '-' + Math.floor(Math.random() * 1e4);
    await fotoLocalSet(fileId, base64, 'image/jpeg');
    enqueue({ action: 'putFoto', fileId, mime: 'image/jpeg' });
    const cfg = getCfg() || {};
    salvarCfg({ ...cfg, empFotos: [...(cfg.empFotos || []), fileId] });
    return fileId;
  }
  // logo da imobiliária (por empresa; opcional). Sobe direto (não é offline-first — é ação rara e deliberada).
  async function anexarLogo(file) {
    const s = getUser(); if (!s) throw new Error('sessão inválida');
    const base64 = await comprimir(file, 520, 0.9); // logo pequena, boa qualidade
    const r = await api('setLogoEmpresa', { base64, mime: 'image/jpeg', auth: { usuario: s.usuario, senhaHash: s.senhaHash } });
    s.logoId = r.logoId; setUser(s, !!localStorage.getItem(K.user));
    await fotoLocalSet(r.logoId, base64, 'image/jpeg'); // já deixa em cache p/ o PDF/topo não precisar buscar
    return r.logoId;
  }
  async function removerLogo() {
    const s = getUser(); if (!s) throw new Error('sessão inválida');
    await api('removerLogoEmpresa', { auth: { usuario: s.usuario, senhaHash: s.senhaHash } });
    s.logoId = ''; setUser(s, !!localStorage.getItem(K.user));
    return true;
  }
  // Variante do ADMIN: sobe/remove a logo de OUTRA empresa (o servidor aceita
  // body.usuario quando quem chama é admin). Atualiza o cache local de
  // usuários para a tela refletir sem esperar o próximo pull.
  async function anexarLogoDe(usuarioAlvo, file) {
    const s = getUser(); if (!s) throw new Error('sessão inválida');
    const base64 = await comprimir(file, 520, 0.9);
    const r = await api('setLogoEmpresa', { usuario: usuarioAlvo, base64, mime: 'image/jpeg', auth: { usuario: s.usuario, senhaHash: s.senhaHash } });
    await fotoLocalSet(r.logoId, base64, 'image/jpeg');
    const us = lsGet(K.usuarios, []); const i = us.findIndex((x) => x.usuario === usuarioAlvo);
    if (i >= 0) { us[i].logoId = r.logoId; lsSet(K.usuarios, us); }
    return r.logoId;
  }
  async function removerLogoDe(usuarioAlvo) {
    const s = getUser(); if (!s) throw new Error('sessão inválida');
    await api('removerLogoEmpresa', { usuario: usuarioAlvo, auth: { usuario: s.usuario, senhaHash: s.senhaHash } });
    const us = lsGet(K.usuarios, []); const i = us.findIndex((x) => x.usuario === usuarioAlvo);
    if (i >= 0) { us[i].logoId = ''; lsSet(K.usuarios, us); }
    return true;
  }
  function removerFotoEmp(fileId) {
    const cfg = getCfg() || {};
    const amen = { ...(cfg.amenFotos || {}) };
    Object.keys(amen).forEach((k) => { if (amen[k] === fileId) delete amen[k]; }); // solta vínculos
    salvarCfg({ ...cfg, empFotos: (cfg.empFotos || []).filter((f) => f !== fileId), amenFotos: amen });
    enqueue({ action: 'delFoto', fileId });
  }
  // move uma foto da galeria para esquerda(-1) ou direita(+1)
  function moverFotoEmp(fileId, dir) {
    const cfg = getCfg() || {};
    const arr = [...(cfg.empFotos || [])];
    const i = arr.indexOf(fileId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    salvarCfg({ ...cfg, empFotos: arr });
  }
  // vincula/desvincula uma amenidade a uma foto da galeria (por fileId; '' = solta)
  function vincularAmenFoto(nome, fileId) {
    const cfg = getCfg() || {};
    const amen = { ...(cfg.amenFotos || {}) };
    if (fileId) amen[nome] = fileId; else delete amen[nome];
    salvarCfg({ ...cfg, amenFotos: amen });
  }

  // APARTAMENTOS (tipos e planta humanizada) — lista própria [{nome, fotoId}], com fotos dedicadas (não a galeria do prédio)
  async function anexarFotoApart(nome, file) {
    const base64 = await comprimir(file, 1600, 0.78);
    const fileId = 'fa-' + Date.now() + '-' + Math.floor(Math.random() * 1e4);
    await fotoLocalSet(fileId, base64, 'image/jpeg');
    enqueue({ action: 'putFoto', fileId, mime: 'image/jpeg' });
    const cfg = getCfg() || {};
    salvarCfg({ ...cfg, apartamentos: [...(cfg.apartamentos || []), { nome: String(nome || '').trim(), fotoId: fileId }] });
    return fileId;
  }
  async function trocarFotoApart(idx, file) {
    const cfg = getCfg() || {};
    const arr = [...(cfg.apartamentos || [])];
    if (idx < 0 || idx >= arr.length) return null;
    const base64 = await comprimir(file, 1600, 0.78);
    const fileId = 'fa-' + Date.now() + '-' + Math.floor(Math.random() * 1e4);
    await fotoLocalSet(fileId, base64, 'image/jpeg');
    enqueue({ action: 'putFoto', fileId, mime: 'image/jpeg' });
    const antiga = arr[idx].fotoId;
    arr[idx] = { ...arr[idx], fotoId: fileId };
    salvarCfg({ ...cfg, apartamentos: arr });
    if (antiga) enqueue({ action: 'delFoto', fileId: antiga });
    return fileId;
  }
  function renomearApart(idx, nome) {
    const cfg = getCfg() || {};
    const arr = [...(cfg.apartamentos || [])];
    if (idx < 0 || idx >= arr.length) return;
    arr[idx] = { ...arr[idx], nome: String(nome || '').trim() };
    salvarCfg({ ...cfg, apartamentos: arr });
  }
  function removerApart(idx) {
    const cfg = getCfg() || {};
    const arr = [...(cfg.apartamentos || [])];
    if (idx < 0 || idx >= arr.length) return;
    const [rm] = arr.splice(idx, 1);
    salvarCfg({ ...cfg, apartamentos: arr });
    if (rm && rm.fotoId) enqueue({ action: 'delFoto', fileId: rm.fotoId });
  }
  function moverApart(idx, dir) {
    const cfg = getCfg() || {};
    const arr = [...(cfg.apartamentos || [])];
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    salvarCfg({ ...cfg, apartamentos: arr });
  }
  async function obterFoto(fileId) {
    if (!fileId) return null;
    const local = await fotoLocalGet(fileId);
    if (local) return local;
    try {
      const r = await api('getFoto', { fileId });
      await fotoLocalSet(fileId, r.base64, r.mime);
      return { id: fileId, base64: r.base64, mime: r.mime };
    } catch (e) { return null; }
  }

  // ---------- sync ----------
  function status() {
    const n = filaGet().length;
    const travados = _flagged.size;
    if (!navigator.onLine) return { estado: 'offline', pendentes: n, travados };
    if (travados || _ultimoErro) return { estado: 'erro', pendentes: n, travados, motivo: _ultimoErro ? _ultimoErro.tipo : 'auth' };
    return n ? { estado: 'pending', pendentes: n, travados: 0 } : { estado: 'ok', pendentes: 0, travados: 0 };
  }
  // re-tenta tudo, inclusive o que foi barrado por auth (401/403) — usar após re-login
  function retentarTudo() { _flagged.clear(); _ultimoErro = null; return trySync(); }

  async function trySync() {
    if (_syncing || !navigator.onLine || !getUser()) return;
    _syncing = true;
    try {
      const snapshot = filaGet().slice();
      for (const item of snapshot) {
        const sig = assinatura(item);
        if (_flagged.has(sig)) continue;
        try {
          let res;
          if (item.action === 'putFoto') {
            const f = await fotoLocalGet(item.fileId);
            if (!f) { removeDaFila(item); continue; }
            res = await api('putFoto', { fileId: item.fileId, base64: f.base64, mime: f.mime });
          } else {
            res = await api(item.action, item);
          }
          if (res && res.conflito) {
            // servidor mais novo vence; aplica e notifica
            if (item.action === 'upsert') aplicaUnidade(res.servidor);
            if (item.action === 'upsertProposta') aplicaProposta(res.servidor);
            if (item.action === 'upsertLead') { aplicaLead(res.servidor); emit('dados', { tipo: 'leads' }); }
            _ultimoErro = null; // a nuvem respondeu (venceu a versão dela); não é falha de envio
            emit('sync', { ...status(), conflito: true });
            removeDaFila(item);
            continue;
          }
          removeDaFila(item);
          delete _falhas[sig];
          _ultimoErro = null; // um item subiu: a nuvem está aceitando de novo
        } catch (e) {
          if (!navigator.onLine || !e.status || e.status >= 500 || e.status === 429 || e.status === 408) { break; } // transiente (rede/5xx/rate-limit/timeout): para e retenta depois
          if (e.status === 401 || e.status === 403) { _flagged.add(sig); _ultimoErro = { tipo: 'auth' }; continue; } // auth/permissão: pula esse item (pode voltar após re-login) sem travar a fila
          // 4xx permanente (400/404/409/422…): item inválido, nunca vai passar → descarta p/ não bloquear os itens atrás dele
          _ultimoErro = { tipo: 'descartado' };
          removeDaFila(item); emit('sync', { ...status(), descartado: sig });
        }
      }
    } finally {
      _syncing = false;
      emit('sync', status());
    }
  }

  function aplicaUnidade(remota) {
    const lista = getUnidades();
    const i = lista.findIndex((u) => u.id === remota.id);
    if (i >= 0) { if ((remota.atualizadoEm || '') >= (lista[i].atualizadoEm || '')) lista[i] = remota; }
    else lista.push(remota);
    lsSet(K.un, lista);
  }
  function aplicaProposta(remota) {
    const lista = getPropostas();
    const i = lista.findIndex((u) => u.id === remota.id);
    if (i >= 0) { if ((remota.atualizadoEm || '') >= (lista[i].atualizadoEm || '')) lista[i] = remota; }
    else lista.push(remota);
    lsSet(K.prop, lista);
  }
  function aplicaLead(remota) {
    const lista = getLeads();
    const i = lista.findIndex((u) => u.id === remota.id);
    if (i >= 0) { if ((remota.atualizadoEm || '') >= (lista[i].atualizadoEm || '')) lista[i] = remota; }
    else lista.push(remota);
    lsSet(K.leads, lista);
  }

  async function pull(onRefresh) {
    if (!navigator.onLine || !getUser()) return;
    try {
      const filaInicio = filaGet();
      const deletesPend = new Set(filaInicio.filter((x) => x.action === 'del').map((x) => x.id));
      const upsertsPend = new Set(filaInicio.filter((x) => x.action === 'upsert').map((x) => x.unidade.id));

      // unidades — keyset
      let after = null; const vistas = new Set(); let mudou = false;
      for (let pg = 0; pg < 50; pg++) {
        const r = await api('list', { after });
        for (const remota of r.unidades) {
          vistas.add(remota.id);
          if (deletesPend.has(remota.id)) continue; // não ressuscitar
          const local = unidadePorId(remota.id);
          if (!local || (remota.atualizadoEm || '') > (local.atualizadoEm || '')) { aplicaUnidade(remota); mudou = true; }
        }
        if (!r.nextAfter) break;
        after = r.nextAfter;
      }
      // varredura de exclusão (preserva upserts pendentes)
      const lista = getUnidades().filter((u) => vistas.has(u.id) || upsertsPend.has(u.id) || deletesPend.has(u.id));
      if (lista.length !== getUnidades().length) { lsSet(K.un, lista); mudou = true; }

      // cfg — não sobrescrever se há setCfg pendente
      if (!filaInicio.some((x) => x.action === 'setCfg')) {
        const rc = await api('getCfg');
        const cfgLocal = getCfg();
        if (!cfgLocal || (rc.cfg.atualizadoEm || '') > (cfgLocal.atualizadoEm || '')) { lsSet(K.cfg, rc.cfg); mudou = true; }
        lsSet(K.usuarios, rc.usuarios || []);
        if (rc.temSenhaCorretorGeral !== undefined) lsSet('dv_temGeral', !!rc.temSenhaCorretorGeral); // login único: senha já definida?
        // logo subida pelo ADM chega à sessão sem re-login (o PDF lê s.logoId)
        const sess = getUser();
        if (sess && sess.papel !== 'admin' && rc.meuLogoId != null && sess.logoId !== rc.meuLogoId) {
          sess.logoId = rc.meuLogoId; setUser(sess, !!localStorage.getItem(K.user));
        }
      }

      // propostas
      const delPropPend = new Set(filaInicio.filter((x) => x.action === 'delProposta').map((x) => x.id));
      let afterP = null; const vistasP = new Set();
      for (let pg = 0; pg < 50; pg++) {
        const r = await api('listPropostas', { after: afterP, comoCorretor: _como() }); // servidor escopa: master vê a equipe, corretor só as suas
        for (const p of r.propostas) {
          vistasP.add(p.id);
          if (delPropPend.has(p.id)) continue;
          aplicaProposta(p);
        }
        if (!r.nextAfter) break;
        afterP = r.nextAfter;
      }
      const upsertsPropPend = new Set(filaGet().filter((x) => x.action === 'upsertProposta').map((x) => x.proposta.id));
      const listaP = getPropostas().filter((p) => vistasP.has(p.id) || upsertsPropPend.has(p.id) || delPropPend.has(p.id));
      lsSet(K.prop, listaP);

      await pullLeads(); // CRM (escopado pelo corretor ativo)
      await pullReservas(); // pedidos de reserva pendentes (aviso do espelho)

      lsSet(K.last, now());
      if (mudou && onRefresh) onRefresh();
      emit('sync', status());
    } catch (e) { /* offline/erro transitório */ }
  }

  // ---------- ciclo ----------
  function iniciar(onRefresh) {
    setInterval(() => { trySync(); }, 8000);
    setInterval(() => { pull(onRefresh); }, 30000);
    window.addEventListener('online', () => { trySync(); pull(onRefresh); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(onRefresh); });
    trySync(); pull(onRefresh);
  }

  return {
    api, sha256, login, logout, getUser, setUser, setCorretorAtivo, setMeusCorretores, trocarMinhaSenha, setSenhaEquipe, enviarPropostaPdf, isAdmin,
    entrarComoUniversal, setSenhaCorretorGeral, temSenhaCorretorGeral: () => lsGet('dv_temGeral', false),
    getLeads, pullLeads, salvarLead, excluirLead, listEnvios,
    getReservas, pullReservas, pedirReserva, excluirReserva,
    getUnidades, getCfg, getPropostas, getUsuarios, unidadePorId,
    salvarUnidade, salvarCfg, salvarProposta, excluirProposta, reatribuirCorretor,
    anexarFotoTipo, girarFotoTipo, anexarFotoEmp, removerFotoEmp, moverFotoEmp, vincularAmenFoto, obterFoto, comprimir,
    anexarFotoApart, trocarFotoApart, renomearApart, removerApart, moverApart,
    anexarLogo, removerLogo, anexarLogoDe, removerLogoDe, ehDomo, podeVerPainel, setVendedor,
    trySync, retentarTudo, pull, iniciar, status, on, filaGet, diaLocalISO, ymdLocal,
  };
})();
window.STORE = STORE;
