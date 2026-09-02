// api-core.mjs — PORTE FIEL do netlify/functions/api.js para Deno/Supabase.
// Mesmo contrato (36 actions, x-token), mesmo código; só o armazenamento mudou (blobs-shim → Postgres/Storage).
import { getStore, connectLambda } from '../_shared/blobs-shim.mjs';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import SEED from './seed-units.json' with { type: 'json' };

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ===== senhas EM REPOUSO: sal + KDF lento (scrypt) =====
// O cliente SEMPRE calcula/envia sha256(senha) ("clientHash"). O servidor guarda scrypt(clientHash, sal).
// Formato guardado NOVO: "s2$<salHex>$<derivadoHex>". LEGADO: sha256 puro (64 hex, sem "$").
// validarUsuario aceita os dois; o login regrava o legado no formato novo (migração transparente, ninguém troca senha).
// N=8192: o app revalida a senha a CADA request (sem token de sessão); corretor de equipe faz 2 scrypts/request.
// 8192 ≈ 16ms/chamada mantém o app ágil e ainda é salgado + ~16000× mais lento que sha256 puro (defesa enorme p/ o modelo de ameaça: vazamento do blob em repouso).
const KDF = { N: 8192, r: 8, p: 1, len: 32 };
const _scrypt = (clientHash, sal) => crypto.scryptSync(String(clientHash), sal, KDF.len, { N: KDF.N, r: KDF.r, p: KDF.p });
const ehHashNovo = (g) => typeof g === 'string' && g.startsWith('s2$');
const guardaSenha = (clientHash) => { const sal = crypto.randomBytes(16); return 's2$' + sal.toString('hex') + '$' + _scrypt(clientHash, sal).toString('hex'); };
// confere um clientHash contra o valor guardado (novo OU legado). Retorna { ok, legado }.
function confereSenha(clientHash, guardado) {
  if (!guardado || !clientHash) return { ok: false, legado: false };
  if (ehHashNovo(guardado)) {
    const p = String(guardado).split('$'); if (p.length !== 3) return { ok: false, legado: false };
    let calc; try { calc = _scrypt(clientHash, Buffer.from(p[1], 'hex')); } catch (e) { return { ok: false, legado: false }; }
    const want = Buffer.from(p[2], 'hex');
    return { ok: calc.length === want.length && crypto.timingSafeEqual(calc, want), legado: false };
  }
  const a = Buffer.from(String(guardado)), b = Buffer.from(String(clientHash)); // legado: sha256 puro
  return { ok: a.length === b.length && crypto.timingSafeEqual(a, b), legado: true };
}

const now = () => new Date().toISOString();
const PAGE = 100;

const DEFAULT_CFG = {
  dataTabela: '01/07/2026',
  versao: 'v1',
  reajuste: 0,
  indice: 'INCC',
  correcaoMensal: 0.006,
  correcaoDesde: 1,
  corretagem: 0.05,
  quemPaga: 'Construtora',
  entradaPct: 0.20,
  finalPct: 0.40,
  nParcelas: 30,
  planoEntradaPct: 0.20, // plano do corretor (o que o cliente vê) — padrão inicial da entrada
  planoFinalPct: 0.30, // padrão inicial da parcela final (chaves)
  planoEntradaOpcoes: [10, 20, 30], // opções de entrada que o corretor pode escolher (%)
  planoFinalOpcoes: [30, 40, 50], // opções de parcela final/chaves que o corretor pode escolher (%)
  planoParcelas: [12, 24, 36], // opções de parcelas oferecidas ao cliente
  balQtde: 5,
  balValor: 10000,
  balPrimeiro: 6,
  balIntervalo: 6,
  chavesMes: 36,
  diaVenc: 10,
  fotosTipo: {},
  empTitulo: 'EDIFÍCIO DIAMOND: um novo brilho na cidade',
  empTexto: [
    'Arquitetura lapidada em Montes Claros: 14 andares, 82 apartamentos e 1 loja, no encontro entre cidade e natureza, em frente à Avenida Mestra Fininha, um dos endereços mais estratégicos e valorizados da região.',
    'Plantas inteligentes de 39,79 m² a 46,85 m², pensadas para se adaptar a diferentes estilos de vida, com ambientes bem distribuídos e soluções que valorizam cada metro quadrado.',
    'Do hall ao rooftop, uma experiência completa: piscina panorâmica, área gourmet, academia e espaços compartilhados criam um ambiente que acompanha o seu ritmo, com 2 elevadores e 3 pavimentos de garagem com vagas exclusivas.',
    'Localização com infraestrutura completa: fácil acesso ao centro, comércios, shopping, centros de estudo, trabalho e lazer, e o parque como vizinho, para uma rotina mais leve.',
    'Um empreendimento Domo Construtora: compromisso sólido com qualidade, precisão e confiança, criado por empresários consolidados em Montes Claros.',
  ].join('\n'),
  empAmenidades: ['Piscina panorâmica no rooftop', 'Academia', 'Sauna', 'Deck molhado', 'Área gourmet', 'Espaço grill', 'Coworking', 'Sala de reuniões', 'Lavanderia equipada', '2 elevadores', '3 pavimentos de garagem', '1 vaga de garagem por apartamento', 'Loja no térreo'],
  empFotos: [],
};

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

async function getUsuarios(cfgStore) {
  return (await cfgStore.get('usuarios', { type: 'json' })) || null;
}

// namespace ÚNICO de login: uma string está tomada se for o usuario primário OU um alias (loginsAntigos) de qualquer outro
function loginTomado(usuarios, login, exceto) {
  return usuarios.some((x) => x.usuario !== exceto && (x.usuario === login || (x.loginsAntigos || []).includes(login)));
}

// ALIAS de corretor renomeado (nomeAntigo → nomeAtual). Os leads guardam corretorNome (string);
// sem o alias, renomear um corretor deixaria os leads antigos dele órfãos e geraria duplicatas.
// Mesma ideia do loginsAntigos das empresas. Só aceita rename cujo destino exista na lista final.
function aplicaAliasCorretor(base, renomeados, listaFinal) {
  const nomesAtuais = new Set((listaFinal || []).map((c) => c.nome));
  const rens = (Array.isArray(renomeados) ? renomeados : [])
    .map((r) => ({ de: String((r && r.de) || '').trim().slice(0, 60), para: String((r && r.para) || '').trim().slice(0, 60) }))
    .filter((r) => r.de && r.para && r.de !== r.para && nomesAtuais.has(r.para) && !nomesAtuais.has(r.de));
  if (!rens.length) return base.corretorAliases;
  const al = { ...(base.corretorAliases || {}) };
  for (const { de, para } of rens) {
    Object.keys(al).forEach((k) => { if (al[k] === de) al[k] = para; }); // cadeia: A→B e depois B→C ⇒ A→C
    al[de] = para;
    delete al[para]; // 'para' agora é nome ATUAL, não pode ser alias
  }
  const chaves = Object.keys(al);
  if (chaves.length > 200) chaves.slice(0, chaves.length - 200).forEach((k) => delete al[k]); // teto de segurança
  return al;
}

// master = quem AUTENTICOU com a senha do master (u.hash). NÃO depende de comoCorretor (que o cliente poderia forjar).
function ehMasterDe(usr) { return !!usr._ehMaster; }
// "super": vê TUDO (todas as imobiliárias) e pode mudar o vendedor — admin OU o login da Domo (construtora).
// NÃO dá acesso a config/preços/cadastro de imobiliárias (isso continua só do admin).
function ehSuper(usr) { return !!usr && (usr.papel === 'admin' || usr.usuario === 'domo'); }
// nomes que pertencem ao corretor ativo: o atual + os nomes ANTIGOS que apontam p/ ele (alias de rename).
// Sem isso, renomear um corretor deixaria os leads/envios antigos dele órfãos e geraria duplicatas.
function nomesDoCorretor(usr, como) {
  // quem entrou com a senha da EQUIPE NUNCA pode se declarar o master (nem p/ pegar os clientes dele)
  const masterNome = (((usr.corretores || [])[0] || {}).nome || '');
  if (!usr._ehMaster && masterNome && como === masterNome) return new Set();
  const al = usr.corretorAliases || {};
  const s = new Set([como]);
  Object.keys(al).forEach((k) => { if (al[k] === como) s.add(k); });
  // alias que aponta p/ o master também é do master
  if (!usr._ehMaster && masterNome) { Object.keys(al).forEach((k) => { if (al[k] === masterNome) s.delete(k); }); s.delete(masterNome); }
  return s;
}

async function ensureSeed(stores) {
  const { unidades, cfg } = stores;
  const usuarios = await getUsuarios(cfg);
  if (!usuarios) {
    await cfg.setJSON('usuarios', [{
      usuario: 'leonardo', hash: sha('domo2026'), nome: 'Leonardo', telefone: '',
      papel: 'admin', ativo: true, criadoEm: now(),
    }]);
  }
  const cfgAtual = await cfg.get('cfg', { type: 'json' });
  if (!cfgAtual) await cfg.setJSON('cfg', { ...DEFAULT_CFG, atualizadoEm: now() });
  const { blobs } = await unidades.list();
  if (!blobs.length) {
    for (const u of SEED) {
      const id = 'u-' + String(u.unidade);
      await unidades.setJSON(id, {
        id, unidade: String(u.unidade), andar: u.andar, area: u.area,
        precoBase: u.precoBase || 0, desconto: 0, status: u.status || 'Disponível',
        fotoId: null, obs: '', atualizadoEm: now(), atualizadoPor: 'seed',
      });
    }
  }
}

// DUAS senhas por empresa (a senha É a identidade — o servidor não confia no que o app diz):
//   u.hash           = senha do MASTER (responsável) → poderes de master
//   u.hashCorretores = senha da EQUIPE (compartilhada) → corretor comum (só vê os próprios clientes)
// Admin só tem u.hash. Devolve o usuário com _ehMaster.
// permitirCliente: o papel 'cliente' (acesso só-leitura da tabela/apresentação) é NEGADO POR PADRÃO.
// Fail-safe de propósito: qualquer ação que não passe explicitamente `true` já barra o cliente,
// então nenhuma ação nova (CRM, propostas, reservas, escrita) vaza por esquecimento.
async function validarUsuario(cfgStore, auth, precisaAdmin, permitirCliente) {
  if (!auth || !auth.usuario || !auth.senhaHash) return null;
  const usuarios = (await getUsuarios(cfgStore)) || [];
  const u = usuarios.find((x) => x.usuario === String(auth.usuario).toLowerCase().trim());
  if (!u || !u.ativo) return null;
  if (u.papel === 'cliente' && !permitirCliente) return null;
  const ehMaster = confereSenha(auth.senhaHash, u.hash).ok;
  let ehEquipe = ehMaster ? false : confereSenha(auth.senhaHash, u.hashCorretores).ok; // só checa a equipe se NÃO for master (poupa 1 scrypt)
  let viaUniversal = false;
  // LOGIN ÚNICO DE CORRETOR: a senha geral (cfg.corretorGeralHash) vale como senha
  // de EQUIPE para QUALQUER imobiliária. A pessoa entrou pelo login único "corretor",
  // escolheu o nome dela, e daí em diante a sessão é a da imobiliária dela como membro
  // de equipe (vê só os próprios clientes; nunca é master). Só custa 1 scrypt extra e
  // só quando master e equipe já falharam.
  if (!ehMaster && !ehEquipe && u.papel === 'corretor') {
    const cfg = (await cfgStore.get('cfg', { type: 'json' })) || {};
    if (cfg.corretorGeralHash && confereSenha(auth.senhaHash, cfg.corretorGeralHash).ok) { ehEquipe = true; viaUniversal = true; }
  }
  if (!ehMaster && !ehEquipe) return null;
  if (precisaAdmin && u.papel !== 'admin') return null;
  return { ...u, _ehMaster: ehMaster, _viaUniversal: viaUniversal };
}

function keyset(keys, after) {
  const sorted = keys.slice().sort();
  let inicio = 0;
  if (after) { inicio = sorted.findIndex((k) => k > after); if (inicio === -1) return { fatia: [], nextAfter: null, total: sorted.length }; }
  const fatia = sorted.slice(inicio, inicio + PAGE);
  const nextAfter = inicio + PAGE < sorted.length ? fatia[fatia.length - 1] : null;
  return { fatia, nextAfter, total: sorted.length };
}

export const handler = async (event) => {
  try { connectLambda(event); } catch (e) { /* contexto injetado pelo runtime */ }
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  // Porta do backup central (hub Impresilk): o token de ROTINA — um segredo
  // forte que nunca viaja no navegador — abre um `list` que devolve TUDO
  // (todas as coleções de registros), não só as unidades do espelho.
  const tokenRecebido = event.headers['x-token'] || event.headers['X-Token'];
  const ROTINA = Deno.env.get('DMD_ROTINA_TOKEN');
  const ehBackup = !!ROTINA && tokenRecebido === ROTINA;
  if (tokenRecebido !== Deno.env.get('DMD_TOKEN') && !ehBackup) {
    return json(401, { erro: 'não autorizado' });
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { erro: 'json inválido' }); }
  const action = body.action;

  const stores = {
    unidades: getStore('unidades'),
    fotos: getStore('fotos'),
    cfg: getStore('cfg'),
    propostas: getStore('propostas'),
    propostasPdf: getStore('propostasPdf'), // PDFs servidos por link público (função p.js)
    envios: getStore('envios'), // analytics do link (views/meta) — leve, sem base64
    enviosEv: getStore('enviosEv'), // 1 blob por interação (append sem RMW — nunca se perde)
    leads: getStore('leads'), // CRM: clientes/leads do corretor
    reservas: getStore('reservas'), // pedidos de reserva pendentes (key = unidadeId) — evita 2 corretores pedirem o mesmo apto
  };

  try {
    // ---------- básicos ----------
    if (action === 'ping') return json(200, { ok: true, em: now() });

    if (action === 'diag') {
      let auto = 'ERR';
      try { const r = await stores.cfg.list(); auto = 'ok(' + r.blobs.length + ')'; } catch (e) { auto = 'ERR: ' + e.message; }
      return json(200, { auto });
    }

    await ensureSeed(stores);

    if (action === 'saude') {
      const [un, pr] = await Promise.all([stores.unidades.list(), stores.propostas.list()]);
      const c = await stores.cfg.get('cfg', { type: 'json' });
      return json(200, { ok: true, totalUnidades: un.blobs.length, totalPropostas: pr.blobs.length, tabela: c ? c.dataTabela + ' ' + c.versao : '?', em: now() });
    }

    // ---------- login ----------
    // (Rate-limit removido de propósito: o Blobs não tem contador atômico e o get() volta desatualizado —
    //  o contador nunca acumulava sob ataque rápido, então não protegia e ainda virava DoS de conta. A defesa
    //  real é a senha mínima de 6 exigida ao DEFINIR senha; hardening extra pediria um backend com estado real.)
    if (action === 'login') {
      // LOGIN ÚNICO DE CORRETOR: usuário reservado "corretor" + a senha geral.
      // Não é uma conta na lista — é a porta única. Devolve o ELENCO (todos os
      // corretores de todas as imobiliárias) para a pessoa clicar no nome dela.
      // Escolhido o nome, a sessão vira membro de equipe da imobiliária dele
      // (ver validarUsuario/viaUniversal). Erro genérico, como o login normal.
      if (String(body.usuario || '').toLowerCase().trim() === 'corretor') {
        const cfg = (await stores.cfg.get('cfg', { type: 'json' })) || {};
        if (!cfg.corretorGeralHash || !confereSenha(String(body.senhaHash || ''), cfg.corretorGeralHash).ok) {
          return json(403, { erro: 'usuário ou senha inválidos (ou usuário desativado)' });
        }
        const usuarios = (await getUsuarios(stores.cfg)) || [];
        const elenco = [];
        for (const e of usuarios) {
          if (e.papel !== 'corretor' || e.ativo === false) continue;
          for (const c of (e.corretores || [])) {
            const nome = String(c.nome || '').trim();
            if (nome) elenco.push({ nome, telefone: c.telefone || '', empresaLogin: e.usuario, empresaNome: e.nome || e.usuario });
          }
        }
        elenco.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        return json(200, { ok: true, universal: true, elenco });
      }
      // LOGIN É SOMENTE-LEITURA (de propósito): NÃO migra hash aqui. O blob 'usuarios' não tem CAS e tem lag —
      // se o login escrevesse, a onda de logins pós-deploy poderia sobrescrever uma troca de senha concorrente e
      // TRAVAR o usuário com a senha nova (revisão adversarial confirmou, gravidade ALTA). O formato legado é aceito
      // para sempre por confereSenha; a migração p/ salgado acontece em 'migrarSenhasLegado' (admin, single-writer) e
      // ao trocar/definir qualquer senha. Adiar a migração não custa nada em segurança.
      const u = await validarUsuario(stores.cfg, { usuario: body.usuario, senhaHash: body.senhaHash }, false, true); // cliente também loga
      if (!u) return json(403, { erro: 'usuário ou senha inválidos (ou usuário desativado)' });
      return json(200, {
        ok: true, usuario: u.usuario, nome: u.nome, telefone: u.telefone || '', papel: u.papel, empresa: u.empresa || '',
        corretores: Array.isArray(u.corretores) ? u.corretores : [],
        ehMaster: !!u._ehMaster,              // entrou com a senha do master?
        temSenhaEquipe: !!u.hashCorretores,   // a senha compartilhada da equipe já existe?
        logoId: u.logoId || '',               // logo da imobiliária (opcional) — personaliza PDF/landing/topo
      });
    }

    // ---------- unidades ----------
    if (action === 'list' && ehBackup) {
      // Backup completo: as stores de REGISTROS, achatadas com `_col`, numa
      // paginação única (cursor "store|key"). Binários (fotos, PDFs) ficam de
      // fora — como em todos os backups do hub.
      const ORDEM = ['unidades', 'propostas', 'leads', 'reservas', 'envios', 'enviosEv', 'cfg'];
      const [aStore, aKey] = String(body.after || '').split('|');
      const registros = [];
      let nextAfter = null;
      for (let i = Math.max(0, ORDEM.indexOf(aStore)); i < ORDEM.length && !nextAfter; i++) {
        const nome = ORDEM[i];
        const { blobs } = await stores[nome].list();
        const keys = blobs.map((x) => x.key).sort();
        for (const k of keys) {
          if (nome === aStore && aKey && k <= aKey) continue;
          if (registros.length >= PAGE) {
            // O cursor é a posição do ÚLTIMO entregue (a página pode ter
            // enchido na fronteira entre stores — apontar a store atual aqui
            // pularia ou repetiria registros na retomada).
            const ult = registros[registros.length - 1];
            nextAfter = ult._col + '|' + ult._key;
            break;
          }
          const v = await stores[nome].get(k, { type: 'json' });
          if (v == null) continue;
          registros.push(typeof v === 'object' ? { _col: nome, _key: k, ...v } : { _col: nome, _key: k, valor: v });
        }
      }
      return json(200, { registros, nextAfter });
    }

    if (action === 'list') {
      const { blobs } = await stores.unidades.list();
      const { fatia, nextAfter, total } = keyset(blobs.map((b) => b.key), body.after);
      const unidades = (await Promise.all(fatia.map((k) => stores.unidades.get(k, { type: 'json' })))).filter(Boolean);
      return json(200, { unidades, total, nextAfter });
    }

    if (action === 'upsert') {
      const adm = await validarUsuario(stores.cfg, body.auth, true);
      if (!adm) return json(403, { erro: 'apenas administrador' });
      const u = body.unidade || {};
      if (!u.unidade) return json(400, { erro: 'unidade sem número' });
      const id = 'u-' + String(u.unidade);
      const existente = await stores.unidades.get(id, { type: 'json' });
      if (existente && u.atualizadoEm && existente.atualizadoEm > u.atualizadoEm) {
        return json(200, { conflito: true, servidor: existente });
      }
      const grava = { ...existente, ...u, id, atualizadoPor: adm.usuario };
      // regra 4 do blueprint: NÃO reescrever atualizadoEm do cliente
      if (!grava.atualizadoEm) grava.atualizadoEm = now();
      await stores.unidades.setJSON(id, grava);
      // resolveu o status → o pedido de reserva pendente cumpriu seu papel e sai do espelho
      if (grava.status === 'Reservado' || grava.status === 'Vendido') { try { await stores.reservas.delete(id); } catch (e) {} }
      return json(200, { ok: true, unidade: grava });
    }

    // muda SÓ o status + vendedor de uma unidade (não mexe em preço/desconto). Admin OU domo.
    if (action === 'setVendedor') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      if (!ehSuper(usr)) return json(403, { erro: 'sem permissão para mudar o vendedor' });
      const id = 'u-' + String(body.unidade || '');
      const existente = await stores.unidades.get(id, { type: 'json' });
      if (!existente) return json(404, { erro: 'unidade não encontrada' });
      const st = ['Disponível', 'Reservado', 'Vendido'].includes(body.status) ? body.status : existente.status;
      const disp = st === 'Disponível';
      const grava = { ...existente, status: st,
        vendedorNome: disp ? '' : String(body.vendedorNome || '').slice(0, 60),
        vendedorEmpresa: disp ? '' : String(body.vendedorEmpresa || '').slice(0, 60),
        atualizadoEm: now(), atualizadoPor: usr.usuario };
      await stores.unidades.setJSON(id, grava);
      if (st === 'Reservado' || st === 'Vendido') { try { await stores.reservas.delete(id); } catch (e) {} }
      return json(200, { ok: true, unidade: grava });
    }

    if (action === 'del') {
      const adm = await validarUsuario(stores.cfg, body.auth, true);
      if (!adm) return json(403, { erro: 'apenas administrador' });
      const u = await stores.unidades.get(body.id, { type: 'json' });
      if (u && u.fotoId) await stores.fotos.delete(u.fotoId);
      await stores.unidades.delete(body.id);
      return json(200, { ok: true });
    }

    // ---------- proposta em PDF por link público (corretor gera → cliente abre pelo link) ----------
    if (action === 'putPropostaPdf') {
      const usr = await validarUsuario(stores.cfg, body.auth, false); // qualquer sessão válida (corretor/admin)
      if (!usr) return json(403, { erro: 'sessão inválida' });
      if (!body.base64) return json(400, { erro: 'PDF vazio' });
      let _buf; try { _buf = Buffer.from(String(body.base64), 'base64'); } catch (e) { _buf = null; }
      if (!_buf || _buf.length > 3 * 1024 * 1024) return json(413, { erro: 'PDF inválido ou grande demais (máx 3 MB)' });
      if (_buf.slice(0, 5).toString('latin1') !== '%PDF-') return json(400, { erro: 'arquivo não é um PDF' }); // só aceita PDF de verdade
      const id = 'pp-' + crypto.randomBytes(12).toString('hex'); // 24 hex — inadivinhável (é a credencial do link)
      const unidade = String(body.unidade || '').slice(0, 20);
      // número sequencial da proposta (pra saber quantas saíram e localizar). Contador em Blobs: propostas saem
      // espaçadas, então o get() já vê o valor propagado; colisão só se 2 saírem no mesmo instante (raro, tolerável).
      let numero = 0; try { const seq = (await stores.cfg.get('seqEnvio', { type: 'json' })) || 0; numero = (Number(seq) || 0) + 1; await stores.cfg.setJSON('seqEnvio', numero); } catch (e) { numero = 0; }
      await stores.propostasPdf.setJSON(id, { base64: body.base64, unidade, em: now() }); // PDF (pesado)
      await stores.envios.setJSON(id, { // analytics (leve) — sem base64
        numero, // nº sequencial da proposta
        unidade, valor: Number(body.valor) || 0, area: Number(body.area) || 0, andar: Number.isFinite(+body.andar) ? +body.andar : null, // teaser da landing (sem abrir o PDF)
        logoId: String(body.logoId || '').slice(0, 80), // logo da imobiliária → aparece na landing
        cliente: String(body.cliente || '').slice(0, 80),
        corretor: String(body.corretor || '').slice(0, 60), corretorTel: String(body.corretorTel || '').slice(0, 30),
        empresa: String(body.empresa || '').slice(0, 60), propostaId: String(body.propostaId || '').slice(0, 60),
        leadId: String(body.leadId || '').slice(0, 60), // amarra ao cliente no CRM → o sinal volta pro corretor certo
        por: usr.usuario, em: now(), views: 0, firstView: null, lastView: null, eventos: [],
      });
      return json(200, { ok: true, id, numero });
    }
    // numera as propostas (envios) existentes que ainda não têm número, por ORDEM de criação. Admin, single-writer, idempotente.
    // Só numera as SEM número (preserva os já atribuídos pelo contador do putPropostaPdf), começando após o maior existente.
    if (action === 'numerarEnvios') {
      const adm = await validarUsuario(stores.cfg, body.auth, true);
      if (!adm) return json(403, { erro: 'apenas administrador' });
      const le = await stores.envios.list();
      const envios = (await Promise.all(le.blobs.map((b) => stores.envios.get(b.key, { type: 'json' }).then((e) => e && { key: b.key, ...e }).catch(() => null)))).filter(Boolean);
      let max = envios.reduce((m, e) => Math.max(m, Number(e.numero) || 0), 0);
      const semNum = envios.filter((e) => !Number(e.numero)).sort((a, b) => String(a.em || '') < String(b.em || '') ? -1 : 1);
      for (const e of semNum) { max++; const { key, ...rest } = e; await stores.envios.setJSON(key, { ...rest, numero: max }); }
      if (semNum.length) { try { const seq = (await stores.cfg.get('seqEnvio', { type: 'json' })) || 0; if (max > (Number(seq) || 0)) await stores.cfg.setJSON('seqEnvio', max); } catch (e) {} }
      return json(200, { ok: true, numerados: semNum.length, total: envios.length, ultimo: max });
    }
    // aberturas + interações dos links. Admin vê tudo; a EMPRESA vê os seus (master: todos da equipe; corretor: só os dele)
    // — o sinal do cliente ("tenho interesse") precisa chegar em quem vai ligar pra ele.
    if (action === 'listEnvios') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const [le, lev] = await Promise.all([stores.envios.list(), stores.enviosEv.list()]);
      let envios = (await Promise.all(le.blobs.map((b) => stores.envios.get(b.key, { type: 'json' }).then((e) => e && { id: b.key, ...e, eventos: [] }).catch(() => null)))).filter(Boolean);
      if (!ehSuper(usr)) { // admin e domo veem TUDO; demais, só o próprio
        const meus = new Set([usr.usuario, ...(usr.loginsAntigos || [])]);
        envios = envios.filter((e) => meus.has(e.por)); // isolamento entre empresas
        const como = String(body.comoCorretor || '').trim();
        if (!ehMasterDe(usr)) { const meusNomes = nomesDoCorretor(usr, como); envios = envios.filter((e) => meusNomes.has(e.corretor || '')); }
      }
      const porId = Object.fromEntries(envios.map((e) => [e.id, e]));
      const evs = (await Promise.all(lev.blobs.map((b) => stores.enviosEv.get(b.key, { type: 'json' }).catch(() => null)))).filter(Boolean);
      for (const ev of evs) { const dest = porId[ev.envioId]; if (dest) dest.eventos.push({ tipo: ev.tipo, em: ev.em }); }
      envios.sort((a, b) => String(b.em).localeCompare(String(a.em)));
      return json(200, { envios });
    }
    if (action === 'delEnvio') { // admin remove um envio: PDF + analytics + eventos
      const adm = await validarUsuario(stores.cfg, body.auth, true);
      if (!adm) return json(403, { erro: 'apenas administrador' });
      const id = String(body.id || '');
      if (!/^pp-[a-f0-9]{16,}$/i.test(id)) return json(400, { erro: 'id inválido' });
      await Promise.all([stores.propostasPdf.delete(id).catch(() => {}), stores.envios.delete(id).catch(() => {})]);
      try { const { blobs } = await stores.enviosEv.list({ prefix: id + '-' }); await Promise.all(blobs.map((b) => stores.enviosEv.delete(b.key).catch(() => {}))); } catch (e) {}
      return json(200, { ok: true });
    }

    // ---------- fotos ----------
    if (action === 'putFoto') {
      const usr = await validarUsuario(stores.cfg, body.auth, true);
      if (!usr) return json(403, { erro: 'apenas administrador' });
      if (!body.fileId || !body.base64) return json(400, { erro: 'fileId/base64 obrigatórios' });
      await stores.fotos.setJSON(body.fileId, { base64: body.base64, mime: body.mime || 'image/jpeg', em: now() });
      return json(200, { ok: true, fileId: body.fileId });
    }
    if (action === 'getFoto') {
      const f = await stores.fotos.get(body.fileId, { type: 'json' });
      if (!f) return json(404, { erro: 'foto não encontrada' });
      return json(200, f);
    }
    if (action === 'delFoto') {
      const usr = await validarUsuario(stores.cfg, body.auth, true);
      if (!usr) return json(403, { erro: 'apenas administrador' });
      await stores.fotos.delete(body.fileId);
      return json(200, { ok: true });
    }
    // ---------- logo da imobiliária (por empresa; opcional) ----------
    // Quem define: o MASTER da própria empresa, ou o admin (mirando uma empresa via body.usuario).
    if (action === 'setLogoEmpresa') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const alvo = (ehSuper(usr) && body.usuario) ? String(body.usuario).toLowerCase().trim() : usr.usuario;
      if (!ehSuper(usr) && (!usr._ehMaster || alvo !== usr.usuario)) return json(403, { erro: 'só o master pode definir a logo' });
      if (!body.base64) return json(400, { erro: 'imagem obrigatória' });
      let buf; try { buf = Buffer.from(String(body.base64), 'base64'); } catch (e) { buf = null; }
      if (!buf || buf.length > 1.5 * 1024 * 1024) return json(413, { erro: 'imagem inválida ou grande demais (máx 1,5 MB)' });
      const usuarios = (await getUsuarios(stores.cfg)) || [];
      const i = usuarios.findIndex((x) => x.usuario === alvo);
      if (i < 0) return json(404, { erro: 'empresa não encontrada' });
      const fileId = 'logo-' + alvo.replace(/[^a-z0-9._-]/g, '') + '-' + Date.now();
      await stores.fotos.setJSON(fileId, { base64: body.base64, mime: body.mime || 'image/png', em: now() });
      const antiga = usuarios[i].logoId;
      usuarios[i].logoId = fileId;
      await stores.cfg.setJSON('usuarios', usuarios);
      // NÃO apagar o blob antigo: landings de propostas já enviadas guardam o
      // logoId da época — apagar deixava a página do cliente sem logo.
      return json(200, { ok: true, logoId: fileId });
    }
    if (action === 'removerLogoEmpresa') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const alvo = (ehSuper(usr) && body.usuario) ? String(body.usuario).toLowerCase().trim() : usr.usuario;
      if (!ehSuper(usr) && (!usr._ehMaster || alvo !== usr.usuario)) return json(403, { erro: 'só o master pode remover a logo' });
      const usuarios = (await getUsuarios(stores.cfg)) || [];
      const i = usuarios.findIndex((x) => x.usuario === alvo);
      if (i < 0) return json(404, { erro: 'empresa não encontrada' });
      const antiga = usuarios[i].logoId;
      delete usuarios[i].logoId;
      await stores.cfg.setJSON('usuarios', usuarios);
      // NÃO apagar o blob antigo: landings de propostas já enviadas guardam o
      // logoId da época — apagar deixava a página do cliente sem logo.
      return json(200, { ok: true });
    }

    // ---------- config ----------
    if (action === 'getCfg') {
      const c = (await stores.cfg.get('cfg', { type: 'json' })) || { ...DEFAULT_CFG };
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      // Lista de contas SEM as senhas (hash/hashCorretores). Vai para o admin
      // (que edita tudo) E para o domo/super — que precisa dela para o painel de
      // Corretores. Sem isto o domo abria a aba Corretores e via a lista vazia,
      // e o corretor recém-criado não aparecia nem depois de salvar.
      // temSenhaCorretorGeral: o painel mostra se o login único de corretor já tem senha (sem devolver o hash).
      const temGeral = !!c.corretorGeralHash;
      if (usr && usr.papel === 'admin') {
        const usuarios = ((await getUsuarios(stores.cfg)) || []).map(({ hash, hashCorretores, ...pub }) => ({ ...pub, temSenhaEquipe: !!hashCorretores }));
        const { corretorGeralHash, ...cAdmin } = c; // nunca devolve o hash da senha única, nem ao admin
        return json(200, { cfg: cAdmin, usuarios, temSenhaCorretorGeral: temGeral }); // admin vê tudo, inclusive a margem (corretagem/quemPaga)
      }
      // corretor/anônimo/domo: esconde a margem do vendedor (corretagem/quemPaga) e o hash da senha única.
      // Os parâmetros do PLANO (INCC, balões, entrega, dia) são termos do cliente — o corretor precisa deles.
      const { corretagem, quemPaga, corretorGeralHash, ...cPub } = c;
      // O domo (super) recebe a lista de contas para gerenciar corretores; corretor comum e anônimo, não.
      const usuarios = (usr && ehSuper(usr))
        ? ((await getUsuarios(stores.cfg)) || []).map(({ hash, hashCorretores, ...pub }) => ({ ...pub, temSenhaEquipe: !!hashCorretores }))
        : [];
      // meuLogoId: deixa a sessão do corretor receber a logo que o ADM subiu sem re-logar.
      return json(200, { cfg: cPub, usuarios, meuLogoId: (usr && usr.logoId) || '', temSenhaCorretorGeral: (usr && ehSuper(usr)) ? temGeral : undefined });
    }
    if (action === 'setCfg') {
      const adm = await validarUsuario(stores.cfg, body.auth, true);
      if (!adm) return json(403, { erro: 'apenas administrador' });
      // MESCLA com a cfg existente (nunca apaga campos não enviados — evita clobber por save parcial)
      const atual = (await stores.cfg.get('cfg', { type: 'json' })) || { ...DEFAULT_CFG };
      const c = { ...atual, ...(body.cfg || {}), atualizadoEm: now() };
      await stores.cfg.setJSON('cfg', c);
      return json(200, { ok: true, cfg: c });
    }

    // ---------- usuários (corretores) ----------
    if (action === 'upsertUsuario') {
      // Admin faz tudo. O DOMO (super) também gerencia corretores — mas NUNCA
      // toca em conta de administrador nem cria uma (senão o super viraria um
      // atalho para virar admin). Preços e config seguem só do admin, em outras ações.
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr || !ehSuper(usr)) return json(403, { erro: 'sem permissão para gerenciar corretores' });
      const soDomo = usr.papel !== 'admin'; // ehSuper + não-admin ⇒ é o domo
      const dados = body.usuarioDados || {};
      const login = String(dados.usuario || '').toLowerCase().trim();
      if (!login) return json(400, { erro: 'usuário obrigatório' });
      if (login === 'corretor') return json(400, { erro: '"corretor" é o login único da equipe — escolha outro nome para a imobiliária' });
      const usuarios = (await getUsuarios(stores.cfg)) || [];
      const i = usuarios.findIndex((x) => x.usuario === login);
      if (soDomo) {
        const papelAlvo = dados.papel || (i >= 0 ? usuarios[i].papel : 'corretor');
        if (papelAlvo !== 'corretor') return json(403, { erro: 'você pode criar e editar apenas contas de corretor' });
        if (i >= 0 && usuarios[i].papel === 'admin') return json(403, { erro: 'você não pode alterar uma conta de administrador' });
        if (login === 'domo') return json(403, { erro: 'a conta domo é gerenciada pelo administrador' });
      }
      if (i < 0 && loginTomado(usuarios, login)) return json(409, { erro: 'login "' + login + '" já está em uso (inclusive como login antigo de outra empresa)' });
      const base = i >= 0 ? usuarios[i] : { usuario: login, criadoEm: now(), hash: null };
      const novo = {
        ...base,
        nome: dados.nome != null ? dados.nome : base.nome,
        telefone: dados.telefone != null ? dados.telefone : base.telefone,
        empresa: dados.empresa != null ? dados.empresa : (base.empresa || ''),
        papel: dados.papel || base.papel || 'corretor',
        ativo: dados.ativo != null ? !!dados.ativo : base.ativo !== false,
      };
      if (Array.isArray(dados.corretores)) { // sub-corretores da empresa (só nome/telefone)
        novo.corretores = dados.corretores;
        const al = aplicaAliasCorretor(base, body.renomeados, dados.corretores); // admin renomeando também não orfana leads
        if (al) novo.corretorAliases = al;
      }
      if (dados.senha != null && String(dados.senha).trim() && String(dados.senha).trim().length < 6) return json(400, { erro: 'senha muito curta (mínimo 6 caracteres)' });
      if (dados.senhaEquipe != null && String(dados.senhaEquipe).trim() && String(dados.senhaEquipe).trim().length < 6) return json(400, { erro: 'senha da equipe muito curta (mínimo 6 caracteres)' });
      const chMaster = dados.senha ? sha(String(dados.senha).trim()) : null;   // clientHash da nova senha do master
      const chEquipe = dados.senhaEquipe ? sha(String(dados.senhaEquipe).trim()) : null; // clientHash da nova senha da equipe
      if (chMaster) novo.hash = guardaSenha(chMaster); // guarda SALGADO (senha do MASTER / admin)
      if (chEquipe) novo.hashCorretores = guardaSenha(chEquipe); // guarda SALGADO (senha COMPARTILHADA da equipe)
      if (!novo.hash) return json(400, { erro: 'defina uma senha para o usuário novo' });
      // master ≠ equipe (compara a senha nova contra o outro hash, aceitando formato antigo/novo)
      if (chMaster && novo.hashCorretores && confereSenha(chMaster, novo.hashCorretores).ok) return json(400, { erro: 'a senha da equipe não pode ser igual à do master' });
      if (chEquipe && novo.hash && confereSenha(chEquipe, novo.hash).ok) return json(400, { erro: 'a senha da equipe não pode ser igual à do master' });
      if (i >= 0) usuarios[i] = novo; else usuarios.push(novo);
      if (!usuarios.some((x) => x.papel === 'admin' && x.ativo)) {
        return json(400, { erro: 'não é possível deixar o sistema sem administrador ativo' });
      }
      await stores.cfg.setJSON('usuarios', usuarios);
      return json(200, { ok: true, usuarios: usuarios.map(({ hash, hashCorretores, ...p }) => ({ ...p, temSenhaEquipe: !!hashCorretores })) });
    }
    if (action === 'delUsuario') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr || !ehSuper(usr)) return json(403, { erro: 'sem permissão' });
      const alvoLogin = String(body.usuario).toLowerCase().trim();
      let usuarios = (await getUsuarios(stores.cfg)) || [];
      if (usr.papel !== 'admin') { // domo: não apaga admin nem a própria conta domo
        const alvo = usuarios.find((x) => x.usuario === alvoLogin);
        if (alvo && alvo.papel === 'admin') return json(403, { erro: 'você não pode excluir uma conta de administrador' });
        if (alvoLogin === 'domo') return json(403, { erro: 'a conta domo é gerenciada pelo administrador' });
      }
      usuarios = usuarios.filter((x) => x.usuario !== alvoLogin);
      if (!usuarios.some((x) => x.papel === 'admin' && x.ativo)) {
        return json(400, { erro: 'não é possível remover o último administrador' });
      }
      await stores.cfg.setJSON('usuarios', usuarios);
      return json(200, { ok: true, usuarios: usuarios.map(({ hash, hashCorretores, ...p }) => ({ ...p, temSenhaEquipe: !!hashCorretores })) });
    }
    if (action === 'renomearUsuario') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr || !ehSuper(usr)) return json(403, { erro: 'sem permissão' });
      const de = String(body.de || '').toLowerCase().trim();
      const para = String(body.para || '').toLowerCase().trim();
      if (!de || !para) return json(400, { erro: 'login de/para obrigatório' });
      if (!/^[a-z0-9._-]+$/.test(para)) return json(400, { erro: 'login só pode ter letras, números, ponto, hífen ou _' });
      if (para === 'corretor') return json(400, { erro: '"corretor" é o login único da equipe — escolha outro nome' });
      const usuarios = (await getUsuarios(stores.cfg)) || [];
      const i = usuarios.findIndex((x) => x.usuario === de);
      if (i < 0) return json(404, { erro: 'login de origem não existe' });
      if (usr.papel !== 'admin') { // domo: só renomeia corretor, nunca admin nem a conta domo
        if (usuarios[i].papel === 'admin') return json(403, { erro: 'você não pode alterar uma conta de administrador' });
        if (de === 'domo' || para === 'domo') return json(403, { erro: 'a conta domo é gerenciada pelo administrador' });
      }
      if (de !== para && loginTomado(usuarios, para, de)) return json(409, { erro: 'o login "' + para + '" já está em uso (inclusive como login antigo de outra empresa)' });
      // aplica edições de campos JUNTO (atômico: rename + dados numa só escrita)
      const dados = body.usuarioDados || null;
      const aplica = (u) => {
        if (!dados) return u;
        const n = { ...u };
        if (dados.nome != null) n.nome = dados.nome;
        if (dados.telefone != null) n.telefone = dados.telefone;
        if (dados.ativo != null) n.ativo = !!dados.ativo;
        if (Array.isArray(dados.corretores)) {
          n.corretores = dados.corretores;
          const al = aplicaAliasCorretor(u, body.renomeados, dados.corretores); // corretor renomeado junto do login: leads não orfanam
          if (al) n.corretorAliases = al;
        }
        if (dados.senha) n.hash = guardaSenha(sha(String(dados.senha).trim())); // guarda SALGADO
        return n;
      };
      if (de === para) { // só aplica dados (login inalterado)
        usuarios[i] = aplica(usuarios[i]);
        if (!usuarios.some((x) => x.papel === 'admin' && x.ativo)) return json(400, { erro: 'não é possível deixar o sistema sem administrador ativo' });
        await stores.cfg.setJSON('usuarios', usuarios);
        return json(200, { ok: true, semMudanca: true, usuarios: usuarios.map(({ hash, hashCorretores, ...p }) => ({ ...p, temSenhaEquipe: !!hashCorretores })) });
      }
      // registra o login antigo como ALIAS (safety net: propostas não reatribuídas continuam visíveis/editáveis)
      const alias = [...new Set([...(usuarios[i].loginsAntigos || []), de])].filter((x) => x !== para);
      usuarios[i] = aplica({ ...usuarios[i], usuario: para, loginsAntigos: alias });
      if (!usuarios.some((x) => x.papel === 'admin' && x.ativo)) return json(400, { erro: 'não é possível deixar o sistema sem administrador ativo' });
      await stores.cfg.setJSON('usuarios', usuarios);
      // reatribui as propostas do login antigo (best-effort, POR ITEM — o alias garante visibilidade se algo falhar)
      let movidas = 0, falhas = 0;
      try {
        const { blobs } = await stores.propostas.list();
        for (const b of blobs) {
          try {
            const p = await stores.propostas.get(b.key, { type: 'json' });
            if (p && p.corretorUsuario === de) { await stores.propostas.setJSON(b.key, { ...p, corretorUsuario: para }); movidas++; }
          } catch (e) { falhas++; } // uma proposta falhar não aborta as demais
        }
      } catch (e) { /* list() indisponível; o alias cobre a visibilidade */ }
      return json(200, { ok: true, movidas, falhas, usuarios: usuarios.map(({ hash, hashCorretores, ...p }) => ({ ...p, temSenhaEquipe: !!hashCorretores })) });
    }
    // migração ÚNICA e SEGURA dos hashes legados (sha256 puro) -> salgado. Admin-only, single-writer.
    // Seguro porque: (1) o login é read-only, então nenhum login colide com esta escrita; (2) o valor legado guardado
    // JÁ É o clientHash, então guardaSenha(legado) = scrypt(clientHash, sal) — dá pra migrar SEM a senha. Idempotente:
    // só escreve se houver algo legado. Sessões existentes continuam válidas (o cliente segue mandando o clientHash).
    if (action === 'migrarSenhasLegado') {
      const adm = await validarUsuario(stores.cfg, body.auth, true);
      if (!adm) return json(403, { erro: 'apenas administrador' });
      const usuarios = (await getUsuarios(stores.cfg)) || [];
      let migrados = 0;
      for (const u of usuarios) {
        if (u.hash && !ehHashNovo(u.hash)) { u.hash = guardaSenha(u.hash); migrados++; }
        if (u.hashCorretores && !ehHashNovo(u.hashCorretores)) { u.hashCorretores = guardaSenha(u.hashCorretores); migrados++; }
      }
      if (migrados) await stores.cfg.setJSON('usuarios', usuarios);
      return json(200, { ok: true, migrados });
    }
    // troca a PRÓPRIA senha (admin: a dele; empresa: a do MASTER) — corretor comum não pode
    if (action === 'setSenha') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      if (usr.papel !== 'admin' && !usr._ehMaster) return json(403, { erro: 'só o master pode trocar a senha do master' });
      if (!body.senhaNova || String(body.senhaNova).trim().length < 6) return json(400, { erro: 'senha muito curta' });
      const usuarios = (await getUsuarios(stores.cfg)) || [];
      const i = usuarios.findIndex((x) => x.usuario === usr.usuario);
      if (i < 0) return json(404, { erro: 'usuário não encontrado' }); // TOCTOU: delUsuario concorrente pode ter removido entre o validarUsuario e agora
      const ch = sha(String(body.senhaNova).trim()); // clientHash da senha nova
      if (usuarios[i].hashCorretores && confereSenha(ch, usuarios[i].hashCorretores).ok) return json(400, { erro: 'a senha do master não pode ser igual à senha da equipe' });
      usuarios[i].hash = guardaSenha(ch); // guarda SALGADO
      await stores.cfg.setJSON('usuarios', usuarios);
      return json(200, { ok: true, senhaHash: ch }); // devolve o clientHash (não o valor guardado!) p/ a sessão continuar válida
    }

    // define/troca a senha COMPARTILHADA da equipe (todos os corretores entram com ela). Master ou admin.
    // Senha ÚNICA do login de corretor (cfg.corretorGeralHash). Admin e domo (super).
    // Enviar senha vazia REMOVE a senha única (desliga o login "corretor").
    if (action === 'setSenhaCorretorGeral') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr || !ehSuper(usr)) return json(403, { erro: 'sem permissão' });
      const cfg = (await stores.cfg.get('cfg', { type: 'json' })) || { ...DEFAULT_CFG };
      const ch = String(body.senhaHash || '').trim();
      if (!ch) { delete cfg.corretorGeralHash; }
      else {
        if (!/^[a-f0-9]{64}$/.test(ch)) return json(400, { erro: 'senha inválida' });
        cfg.corretorGeralHash = guardaSenha(ch);
      }
      cfg.atualizadoEm = now();
      await stores.cfg.setJSON('cfg', cfg);
      return json(200, { ok: true, temSenhaCorretorGeral: !!cfg.corretorGeralHash });
    }
    if (action === 'setSenhaEquipe') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const alvoLogin = ehSuper(usr) && body.usuario ? String(body.usuario).toLowerCase().trim() : usr.usuario;
      if (!ehSuper(usr) && !usr._ehMaster) return json(403, { erro: 'só o master pode definir a senha da equipe' });
      if (!body.senhaNova || String(body.senhaNova).trim().length < 6) return json(400, { erro: 'senha muito curta' });
      const usuarios = (await getUsuarios(stores.cfg)) || [];
      const i = usuarios.findIndex((x) => x.usuario === alvoLogin);
      if (i < 0) return json(404, { erro: 'empresa não encontrada' });
      if (usuarios[i].papel === 'admin') return json(400, { erro: 'admin não tem senha de equipe' });
      const ch = sha(String(body.senhaNova).trim()); // clientHash da senha nova da equipe
      if (usuarios[i].hash && confereSenha(ch, usuarios[i].hash).ok) return json(400, { erro: 'a senha da equipe não pode ser igual à senha do master' });
      usuarios[i].hashCorretores = guardaSenha(ch); // guarda SALGADO
      await stores.cfg.setJSON('usuarios', usuarios);
      return json(200, { ok: true });
    }
    if (action === 'setMeusCorretores') {
      // a EMPRESA (não-admin) edita SÓ a própria lista de corretores — nada mais (papel/ativo/senha/outros usuários intactos)
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      if (usr.papel === 'admin') return json(400, { erro: 'admin gerencia corretores em ADM → Corretores' });
      if (!usr._ehMaster) return json(403, { erro: 'só o master pode gerenciar a equipe' }); // corretor comum não mexe na equipe
      const corretores = (Array.isArray(body.corretores) ? body.corretores : [])
        .map((c) => ({ nome: String((c && c.nome) || '').trim().slice(0, 60), telefone: String((c && c.telefone) || '').trim().slice(0, 30) }))
        .filter((c) => c.nome).slice(0, 50);
      const usuarios = (await getUsuarios(stores.cfg)) || [];
      const i = usuarios.findIndex((x) => x.usuario === usr.usuario);
      if (i < 0) return json(404, { erro: 'usuário não encontrado' });
      // MASTER = 1º corretor cadastrado; a auto-gestão NÃO pode removê-lo (âncora de responsabilidade) — sempre fica em 1º
      const master = (usuarios[i].corretores || [])[0];
      const lista = master ? [master, ...corretores.filter((c) => !(c.nome === master.nome && c.telefone === master.telefone))] : corretores;
      const aliases = aplicaAliasCorretor(usuarios[i], body.renomeados, lista); // rename não pode orfanar os leads
      usuarios[i] = { ...usuarios[i], corretores: lista, ...(aliases ? { corretorAliases: aliases } : {}) }; // troca APENAS corretores/aliases do próprio usuário
      await stores.cfg.setJSON('usuarios', usuarios);
      return json(200, { ok: true, corretores: lista });
    }

    // ---------- propostas ----------
    if (action === 'listPropostas') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const { blobs } = await stores.propostas.list();
      const { fatia, nextAfter, total } = keyset(blobs.map((b) => b.key), body.after);
      let propostas = (await Promise.all(fatia.map((k) => stores.propostas.get(k, { type: 'json' })))).filter(Boolean);
      // admin e domo veem TODAS; a EMPRESA vê as dela; dentro dela o MASTER vê todos os corretores e o corretor comum só as suas
      if (!ehSuper(usr)) {
        const meus = new Set([usr.usuario, ...(usr.loginsAntigos || [])]); // inclui logins antigos (após rename)
        propostas = propostas.filter((p) => meus.has(p.corretorUsuario));
        if (!ehMasterDe(usr)) {
          const como = String(body.comoCorretor || '').trim();
          const meusNomes = nomesDoCorretor(usr, como);
          propostas = propostas.filter((p) => meusNomes.has(p.corretor || ''));
        }
      }
      return json(200, { propostas, total, nextAfter });
    }
    if (action === 'upsertProposta') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const p = body.proposta || {};
      if (!p.id || !/^p-[\w.-]+$/.test(String(p.id))) return json(400, { erro: 'proposta sem id válido' });
      // unidadeId é refletido no HTML do admin (Histórico) — restringe ao formato esperado (anti-XSS/injeção)
      if (p.unidadeId != null) p.unidadeId = String(p.unidadeId).replace(/[^\w -]/g, '').slice(0, 40);
      const existente = await stores.propostas.get(p.id, { type: 'json' });
      // dono: não-admin não mexe em proposta de OUTRO (checa login atual + aliases)
      if (usr.papel !== 'admin' && existente && existente.corretorUsuario) {
        const meus = new Set([usr.usuario, ...(usr.loginsAntigos || [])]);
        if (!meus.has(existente.corretorUsuario)) return json(403, { erro: 'proposta pertence a outro usuário' });
        // corretor comum (login compartilhado) só edita as PRÓPRIAS — o master edita todas da empresa (mesmo padrão dos leads)
        if (!ehMasterDe(usr)) {
          const meusNomes = nomesDoCorretor(usr, String(p.corretor || body.comoCorretor || '').trim());
          if (!meusNomes.has(existente.corretor || '')) return json(403, { erro: 'proposta de outro corretor' });
        }
      }
      // AUTORIA IMUTÁVEL: proposta que já existe mantém quem a criou (nem admin nem outro corretor rouba)
      if (existente && existente.corretorUsuario) {
        p.corretor = existente.corretor; p.corretorUsuario = existente.corretorUsuario; p.corretorTel = existente.corretorTel;
        p.corretorPapel = existente.corretorPapel; p.corretorEmpresa = existente.corretorEmpresa;
      } else if (usr.papel !== 'admin') {
        p.corretorUsuario = usr.usuario; // nova proposta de corretor: dono = sessão (anti-forja)
      }

      if (existente && p.atualizadoEm && existente.atualizadoEm > p.atualizadoEm) {
        return json(200, { conflito: true, servidor: existente });
      }
      const grava = { ...existente, ...p };
      if (!grava.atualizadoEm) grava.atualizadoEm = now();
      await stores.propostas.setJSON(p.id, grava);
      return json(200, { ok: true, proposta: grava });
    }
    // REATRIBUIR CORRETOR — caminho EXPLÍCITO e autorizado p/ trocar o dono de um lead E das propostas
    // do mesmo cliente. É o único jeito de contornar a "autoria imutável" do upsert, e só master/super podem.
    if (action === 'reatribuirCorretor') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const podeGeral = ehSuper(usr);                 // admin/domo: reatribui p/ qualquer corretor
      if (!podeGeral && !ehMasterDe(usr)) return json(403, { erro: 'sem permissão para reatribuir corretor' });
      const leadId = String(body.leadId || '');
      if (!/^lead-[a-z0-9-]+$/i.test(leadId)) return json(400, { erro: 'lead inválido' });
      const lead = await stores.leads.get(leadId, { type: 'json' });
      if (!lead) return json(404, { erro: 'lead não encontrado' });
      const meus = new Set([usr.usuario, ...(usr.loginsAntigos || [])]);
      const podeSobre = (empUsuario) => podeGeral || meus.has(empUsuario); // master: só a própria empresa
      if (!podeSobre(lead.empresaUsuario)) return json(403, { erro: 'lead de outra empresa' });
      // valida o corretor de DESTINO contra o cadastro real (não confia no cliente)
      const alvo = body.alvo || {};
      const alvoUsuario = String(alvo.usuario || '').toLowerCase().trim();
      const alvoNome = String(alvo.nome || '').trim();
      if (!alvoUsuario || !alvoNome) return json(400, { erro: 'corretor de destino inválido' });
      if (!podeGeral && alvoUsuario !== usr.usuario) return json(403, { erro: 'o master só reatribui dentro da própria empresa' });
      const usuarios = (await getUsuarios(stores.cfg)) || [];
      const empAlvo = usuarios.find((x) => x.usuario === alvoUsuario);
      if (!empAlvo) return json(400, { erro: 'empresa de destino não existe' });
      const corAlvo = (empAlvo.corretores || []).find((c) => (c.nome || '').trim() === alvoNome);
      if (!corAlvo && !(empAlvo.papel === 'admin' && (empAlvo.nome || '') === alvoNome)) return json(400, { erro: 'corretor de destino não pertence à empresa' });
      const donoNovo = { empresaUsuario: alvoUsuario, empresaNome: empAlvo.papel === 'admin' ? '' : (empAlvo.nome || ''), corretorNome: alvoNome, corretorTel: (corAlvo && corAlvo.telefone) || '' };
      const propNovo = { corretor: alvoNome, corretorUsuario: alvoUsuario, corretorEmpresa: donoNovo.empresaNome, corretorTel: donoNovo.corretorTel, corretorPapel: empAlvo.papel || 'corretor' };
      const nrm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
      const cliNrm = nrm(lead.cliente);
      const origUsuario = lead.empresaUsuario;        // origem (antes de sobrescrever) p/ casar as propostas
      const origNome = nrm(lead.corretorNome);
      // 1) o LEAD
      const leadNovo = { ...lead, ...donoNovo, atualizadoEm: now() };
      await stores.leads.setJSON(leadId, leadNovo);
      // 2) as PROPOSTAS do MESMO cliente E do MESMO corretor de origem (e dentro do escopo do reatribuidor)
      const reprops = [];
      if (cliNrm) {
        const { blobs } = await stores.propostas.list();
        for (const b of blobs) {
          const p = await stores.propostas.get(b.key, { type: 'json' });
          if (!p) continue;
          if (nrm(p.cliente) !== cliNrm) continue;
          if (!podeSobre(p.corretorUsuario)) continue;
          if (p.corretorUsuario !== origUsuario || nrm(p.corretor) !== origNome) continue;
          const pn = { ...p, ...propNovo, atualizadoEm: now() };
          await stores.propostas.setJSON(b.key, pn);
          reprops.push(pn);
        }
      }
      return json(200, { ok: true, lead: leadNovo, propostas: reprops });
    }
    if (action === 'delProposta') {
      const adm = await validarUsuario(stores.cfg, body.auth, true);
      if (!adm) return json(403, { erro: 'apenas administrador' });
      await stores.propostas.delete(body.id);
      return json(200, { ok: true });
    }

    // ---------- pedidos de reserva ----------
    // Sem isso, dois corretores pedem o MESMO apto e nenhum dos dois sabe (o espelho não muda).
    // Qualquer sessão vê os pendentes (é o alerta do espelho); quem pede é corretor/admin; só o admin resolve.
    if (action === 'listReservas') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const { blobs } = await stores.reservas.list();
      let reservas = (await Promise.all(blobs.map((b) => stores.reservas.get(b.key, { type: 'json' }).catch(() => null)))).filter(Boolean);
      // O espelho é COMPARTILHADO entre imobiliárias concorrentes: todas precisam saber que a unidade tem pedido,
      // mas NENHUMA pode ver o cliente/corretor da outra. Fora da própria empresa, só o fato + a data.
      // O DOMO é exceção junto com o admin: é a construtora que confirma ou recusa
      // o pedido — sem ver de quem é, não tem como decidir.
      if (!ehSuper(usr)) {
        const meus = new Set([usr.usuario, ...(usr.loginsAntigos || [])]);
        reservas = reservas.map((r) => (meus.has(r.empresaUsuario)
          ? r
          : { unidadeId: r.unidadeId, unidade: r.unidade, em: r.em, deOutraEmpresa: true }));
      }
      return json(200, { reservas });
    }
    if (action === 'pedirReserva') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const unidadeId = String(body.unidadeId || '').replace(/[^\w -]/g, '').slice(0, 40);
      if (!unidadeId) return json(400, { erro: 'unidade inválida' });
      const existente = await stores.reservas.get(unidadeId, { type: 'json' });
      // redige o pedido de OUTRA empresa: o concorrente sabe que existe, mas não vê cliente/corretor
      const paraOlhosDe = (r) => {
        if (!r) return r;
        if (usr.papel === 'admin') return r;
        const meus = new Set([usr.usuario, ...(usr.loginsAntigos || [])]);
        return meus.has(r.empresaUsuario) ? r : { unidadeId: r.unidadeId, unidade: r.unidade, em: r.em, deOutraEmpresa: true };
      };
      // já existe pedido → devolve p/ o app avisar (não sobrescreve: quem pediu primeiro fica)
      if (existente && !body.mesmoAssim) return json(200, { jaPedida: true, reserva: paraOlhosDe(existente) });
      const nova = {
        unidadeId, unidade: String(body.unidade || '').slice(0, 20),
        cliente: String(body.cliente || '').slice(0, 80),
        corretor: String(body.corretor || '').slice(0, 60),
        empresa: usr.papel === 'admin' ? 'Domo' : (usr.nome || ''),
        empresaUsuario: usr.usuario, em: now(),
      };
      if (existente) return json(200, { jaPedida: true, reserva: paraOlhosDe(existente), avisado: true }); // mantém o 1º pedido
      await stores.reservas.setJSON(unidadeId, nova);
      return json(200, { ok: true, reserva: nova });
    }
    if (action === 'delReserva') { // a construtora resolveu (reservou de fato ou recusou)
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr || !ehSuper(usr)) return json(403, { erro: 'sem permissão para resolver pedidos de reserva' });
      await stores.reservas.delete(String(body.unidadeId || ''));
      return json(200, { ok: true });
    }

    // ---------- CRM / leads ----------
    // Visibilidade: admin vê tudo; o MASTER da empresa vê tudo dela; corretor comum só os seus.
    // (ehMasterDe/nomesDoCorretor estão no topo do arquivo — usados também pelo listEnvios)
    // registro COMPLETO (o cliente sempre manda o lead inteiro — resiliente ao lag do get() do Blobs no create)
    const leadClean = (l) => ({
      cliente: String(l.cliente || '').trim().slice(0, 80),
      clienteTel: String(l.clienteTel || '').trim().slice(0, 30),
      unidade: String(l.unidade || '').trim().slice(0, 20),
      temp: ['quente', 'morno', 'frio'].includes(l.temp) ? l.temp : 'morno',
      estagio: ['novo', 'contato', 'proposta', 'negociando', 'fechado', 'perdido'].includes(l.estagio) ? l.estagio : 'novo',
      primeiroContato: String(l.primeiroContato || '').slice(0, 10),
      proximoContato: String(l.proximoContato || '').slice(0, 10),
      obs: String(l.obs || '').slice(0, 2000),
    });

    if (action === 'listLeads') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const { blobs } = await stores.leads.list();
      let leads = (await Promise.all(blobs.map((b) => stores.leads.get(b.key, { type: 'json' })))).filter(Boolean);
      if (!ehSuper(usr)) { // admin e domo veem TODOS os clientes; demais, só a própria empresa
        const meus = new Set([usr.usuario, ...(usr.loginsAntigos || [])]);
        leads = leads.filter((l) => meus.has(l.empresaUsuario));
        const como = String(body.comoCorretor || '').trim();
        if (!ehMasterDe(usr)) { const meusNomes = nomesDoCorretor(usr, como); leads = leads.filter((l) => meusNomes.has(l.corretorNome || '')); } // corretor comum: só os seus (inclui nomes antigos)
      }
      return json(200, { leads });
    }

    if (action === 'upsertLead') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const l = body.lead || {};
      if (!l.id || !/^lead-[a-z0-9-]+$/i.test(String(l.id))) return json(400, { erro: 'lead sem id válido' });
      const existente = await stores.leads.get(l.id, { type: 'json' });
      const como = String(body.comoCorretor || '').trim();
      // senha da equipe não pode agir (nem criar) em nome do master
      const _mn = (((usr.corretores || [])[0] || {}).nome || '');
      if (usr.papel !== 'admin' && !usr._ehMaster && _mn && como === _mn) return json(403, { erro: 'a senha da equipe não permite agir como master' });
      if (usr.papel !== 'admin' && existente) {
        const meus = new Set([usr.usuario, ...(usr.loginsAntigos || [])]);
        if (!meus.has(existente.empresaUsuario)) return json(403, { erro: 'lead de outra empresa' });
        if (!ehMasterDe(usr) && !nomesDoCorretor(usr, como).has(existente.corretorNome || '')) return json(403, { erro: 'lead de outro corretor' });
      }
      // conflito: servidor mais novo vence (mesmo padrão de unidade/proposta) — o cliente aplica a versão do servidor
      if (existente && l.atualizadoEm && (existente.atualizadoEm || '') > l.atualizadoEm) return json(200, { conflito: true, servidor: existente });
      let dono;
      if (existente) { // AUTORIA IMUTÁVEL: mantém a quem pertence (só canonicaliza nome antigo → atual após rename)
        const nomeDono = (usr.papel !== 'admin' && como && nomesDoCorretor(usr, como).has(existente.corretorNome || '')) ? como : existente.corretorNome;
        dono = { empresaUsuario: existente.empresaUsuario, empresaNome: existente.empresaNome, corretorNome: nomeDono, corretorTel: existente.corretorTel, criadoEm: existente.criadoEm };
      } else if (usr.papel === 'admin') {
        dono = { empresaUsuario: String(l.empresaUsuario || usr.usuario), empresaNome: String(l.empresaNome || '').slice(0, 60), corretorNome: String(l.corretorNome || '').trim().slice(0, 60), corretorTel: String(l.corretorTel || '').slice(0, 30), criadoEm: now() };
      } else {
        dono = { empresaUsuario: usr.usuario, empresaNome: usr.nome || '', corretorNome: (como || usr.nome || '').slice(0, 60), corretorTel: String(l.corretorTel || '').slice(0, 30), criadoEm: now() };
      }
      // NÃO reescreve atualizadoEm do cliente (regra 4 do blueprint) — mantém a comparação de conflito coerente
      const grava = { ...existente, id: l.id, ...dono, ...leadClean(l), atualizadoEm: l.atualizadoEm || now() };
      await stores.leads.setJSON(l.id, grava);
      return json(200, { ok: true, lead: grava });
    }

    if (action === 'delLead') {
      const usr = await validarUsuario(stores.cfg, body.auth, false);
      if (!usr) return json(403, { erro: 'sessão inválida' });
      const existente = await stores.leads.get(body.id, { type: 'json' });
      if (!existente) return json(200, { ok: true });
      if (usr.papel !== 'admin') {
        const meus = new Set([usr.usuario, ...(usr.loginsAntigos || [])]);
        if (!meus.has(existente.empresaUsuario)) return json(403, { erro: 'lead de outra empresa' });
        const como = String(body.comoCorretor || '').trim();
        if (!ehMasterDe(usr) && !nomesDoCorretor(usr, como).has(existente.corretorNome || '')) return json(403, { erro: 'lead de outro corretor' });
      }
      await stores.leads.delete(body.id);
      return json(200, { ok: true });
    }

    return json(400, { erro: 'action desconhecida: ' + action });
  } catch (e) {
    return json(500, { erro: String((e && e.message) || e) });
  }
};
