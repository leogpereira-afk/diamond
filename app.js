// app.js — UI do Diamond Vendas (corretor + admin)
/* global STORE, PLANO */
(() => {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const app = () => $('#app');
  // há edição NÃO salva na tela? (o pull de 30s não pode re-renderizar e apagar o que a pessoa digitou)
  let _sujo = false;
  const marcarSujo = (sel) => { const el = $(sel); if (!el || el.dataset.sujoOn) return; el.dataset.sujoOn = '1'; el.addEventListener('input', () => { _sujo = true; }); };

  // ---------- formatação ----------
  const fmt = (v, dec = 0) => (v == null || isNaN(v)) ? '—'
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: dec, maximumFractionDigits: dec });
  const fmtData = (d) => d instanceof Date ? d.toLocaleDateString('pt-BR') : (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
  const pct = (v) => ((v || 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
  const pctStr = (v) => (+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'; // v já em pontos percentuais (ex.: 20)
  const telDigits = (t) => String(t || '').replace(/\D/g, '');
  const telWa = (t) => { const d = telDigits(t); return d.length >= 12 ? d : d.length >= 10 ? '55' + d : d; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  const valorTabela = (u, cfg) => (u.precoBase || 0) * (1 + ((cfg && cfg.reajuste) || 0));
  const valorNegociadoTabela = (u, cfg) => valorTabela(u, cfg) * (1 - (u.desconto || 0));
  // ACESSO CLIENTE: só a tabela (unidade/andar/área/status) e a apresentação do prédio.
  // O que fica liberado é configurável em ADM → Config. Nada de CRM, proposta, simulador ou reserva.
  const ehCliente = () => (STORE.getUser() || {}).papel === 'cliente';
  const cliCfg = () => ({ precos: true, predio: true, baixarPdf: true, ...(((STORE.getCfg() || {}).cliente) || {}) });
  const tipoDe = (u) => String(u.unidade).toUpperCase() === 'LOJA' ? 'LOJA' : String(u.unidade).slice(-2);
  const fotoDe = (u, cfg) => ((cfg && cfg.fotosTipo) || {})[tipoDe(u)] || u.fotoId || '';

  function toast(msg, erro) {
    const t = document.createElement('div');
    t.className = 'toast' + (erro ? ' erro' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('on'));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400); }, 3200);
  }

  // ---------- fotos (carrega deduplicado por fileId; cache em IndexedDB) ----------
  function ativarFotos() {
    const els = $$('[data-fotoid]').filter((el) => el.dataset.fotoid);
    const porFid = {};
    els.forEach((el) => { (porFid[el.dataset.fotoid] = porFid[el.dataset.fotoid] || []).push(el); });
    Object.keys(porFid).forEach((fid) => {
      STORE.obterFoto(fid).then((f) => {
        if (!f) return;
        porFid[fid].forEach((el) => {
          el.style.backgroundImage = `url(data:${f.mime};base64,${f.base64})`;
          el.classList.add('tem-foto');
        });
      });
    });
  }

  // ---------- header ----------
  function renderTopo() {
    const u = STORE.getUser();
    const cfg = STORE.getCfg() || {};
    $('#topo').innerHTML = `
      <div class="topo-in">
        <img src="wordmark.png" alt="DIAMOND" class="wordmark" onclick="location.hash='#/home'">
        ${u && u.logoId && u.papel !== 'admin' ? `<img class="topo-logo" id="topo-logo" alt="${esc(u.empresa || 'imobiliária')}">` : ''}
        <div class="topo-info">tabela ${esc(cfg.dataTabela || '')} · ${esc(cfg.versao || '')}</div>
        <div class="topo-dir">
          <span id="sync-badge" class="badge-sync"></span>
          ${u ? `<span class="topo-user">${u.papel === 'admin'
              ? '<span class="topo-nome"><span class="topo-emp">' + esc(u.nome) + ' · </span></span><a href="#/admin/unidades" class="topo-acao">ADM</a>'
              : '<span class="topo-nome"><span class="topo-emp">' + esc(u.nome) + ' · </span>' + (u.corretorAtivo && u.corretorAtivo.nome ? '<b>' + esc(u.corretorAtivo.nome) + '</b>' : '') + '</span>'
                + (u.corretorAtivo && u.corretorAtivo.nome ? (u.ehMaster ? '<span class="tag-master" title="você entrou com a senha de master">🔑</span>' : ' <a href="#" id="topo-trocar" class="topo-acao">trocar</a>') : '') + (u.ehMaster ? ' <a href="#" id="topo-equipe" class="topo-acao">equipe</a>' : '')}</span>
                 <button class="btn-mini" id="btn-sair">sair</button>` : ''}
        </div>
      </div>`;
    const tl = $('#topo-logo'); if (tl && u && u.logoId) { STORE.obterFoto(u.logoId).then((f) => { const el = $('#topo-logo'); if (f && el) el.src = `data:${f.mime};base64,${f.base64}`; }); }
    const b = $('#btn-sair'); if (b) b.onclick = () => { STORE.logout(); location.hash = '#/login'; location.reload(); }; // reload zera PII em memória
    const tr = $('#topo-trocar'); if (tr) tr.onclick = (e) => { e.preventDefault(); STORE.setCorretorAtivo('', ''); _uniDraft = {}; sim = null; location.hash = '#/home'; render(); }; // zera rascunho/PII (o espelho de leads é limpo pelo setCorretorAtivo)
    const eq = $('#topo-equipe'); if (eq) eq.onclick = (e) => { e.preventDefault(); vGerenciarCorretores(); }; // empresa gerencia a própria equipe
    atualizaSync(STORE.status());
  }
  // botão flutuante "Falar com a Domo" — WhatsApp direto com a construtora, com mensagem pronta. Some no login/admin/prédio.
  function montarFabDomo() {
    const antigo = $('#fab-domo'); if (antigo) antigo.remove();
    const cfg = STORE.getCfg() || {};
    const num = telWa(cfg.contatoWhats || '11972746113');
    const a = document.createElement('a');
    a.id = 'fab-domo'; a.className = 'fab-domo';
    a.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent('Olá! Vim pelo site do Edifício Diamond e gostaria de falar com a Domo. 😊');
    a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = '<span class="fab-ic">💬</span><span class="fab-tx">Falar com a Domo</span>';
    document.body.appendChild(a);
  }
  function atualizaSync(st) {
    // avisos pontuais (chegam só no evento específico, não no poll de 8s → não spammam)
    if (st.conflito) toast('Outro acesso salvou antes. Atualizei para a versão da nuvem — confira o preço.', true);
    if (st.descartado) toast('⚠ Uma alteração não foi aceita pela nuvem. Abra a unidade e salve de novo.', true);
    const el = $('#sync-badge'); if (!el) return;
    const erroTxt = st.motivo === 'auth' ? 'sessão expirou' : 'não salvou';
    const map = {
      ok: ['●', 'nuvem ok', 'ok'], pending: ['↻', st.pendentes + ' pendente(s)', 'pend'],
      offline: ['✕', 'offline', 'off'], erro: ['⚠', erroTxt, 'erro'],
    };
    const [ico, txt, cls] = map[st.estado] || map.ok;
    el.className = 'badge-sync ' + cls;
    el.innerHTML = ico + ' <span class="sync-txt">' + txt + '</span>';
    el.title = st.estado === 'erro'
      ? (st.motivo === 'auth'
          ? 'Sua sessão expirou. Toque aqui para tentar reenviar; se não resolver, saia e entre de novo.'
          : 'Uma alteração não subiu para a nuvem. Toque para tentar de novo.')
      : '';
    el.style.cursor = st.estado === 'erro' ? 'pointer' : '';
    el.onclick = st.estado === 'erro'
      ? async () => { toast('Reenviando alterações…'); await STORE.retentarTudo(); await STORE.pull(render); }
      : null;
  }

  // ---------- LOGIN ----------
  function vLogin() {
    app().innerHTML = `
      <div class="login-wrap"><form class="login-card" id="lg-form" autocomplete="on">
        <img src="wordmark.png" class="login-logo" alt="DIAMOND">
        <div class="login-sub">Edifício Diamond · Domo Construtora</div>
        <input id="lg-user" name="username" placeholder="usuário" autocomplete="username" autocapitalize="none" autocorrect="off">
        <input id="lg-pass" name="password" type="password" placeholder="senha" autocomplete="current-password">
        <label class="lg-lembrar"><input type="checkbox" id="lg-lembrar" checked> Manter conectado neste aparelho</label>
        <button id="lg-btn" type="submit" class="btn-lime">Entrar</button>
        <button type="button" class="lg-ajuda" id="lg-ajuda">esqueci minha senha</button>
        <div id="lg-erro" class="lg-erro"></div>
      </form></div>`;
    $('#lg-ajuda').onclick = () => {
      const cfg = STORE.getCfg() || {};
      const num = telWa(cfg.contatoWhats || '11972746113');
      const msg = 'Olá! Esqueci minha senha do sistema do Edifício Diamond. Meu login é: ' + (($('#lg-user').value || '').trim() || '(informe aqui)');
      window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank');
    };
    const entrar = async (e) => {
      if (e) e.preventDefault();
      $('#lg-erro').textContent = '';
      $('#lg-btn').disabled = true;
      try {
        await STORE.login($('#lg-user').value, $('#lg-pass').value, $('#lg-lembrar').checked);
        _uniDraft = {}; sim = null; // descarta rascunhos/PII de sessão anterior
        await STORE.pull();
        location.hash = '#/home';
      } catch (err) { $('#lg-erro').textContent = err.message; $('#lg-btn').disabled = false; }
    };
    $('#lg-form').onsubmit = entrar;
  }

  // ---------- PRIMEIRO ACESSO DO MASTER: explica as 2 senhas e cria a da equipe ----------
  function vPrimeiroAcessoMaster() {
    _painelEquipe = true; // fora de rota: o pull de 30s não pode destruir
    $('#topo').innerHTML = '';
    const u = STORE.getUser() || {};
    const nCor = Math.max(0, (u.corretores || []).length - 1);
    app().innerHTML = `
      <div class="login-wrap"><div class="login-card pam-card">
        <img src="wordmark.png" class="login-logo" alt="DIAMOND">
        <div class="pam-tit">🔑 Você é o master da ${esc(u.nome || 'empresa')}</div>
        <div class="pam-txt">A partir de agora existem <b>duas senhas</b> — é o que garante que só você veja os clientes de toda a equipe:</div>
        <div class="pam-box">
          <div class="pam-item"><span class="pam-ic">🔑</span><div><b>Sua senha de master</b><small>É esta que você acabou de usar. Só sua. Dá acesso aos clientes de <b>toda a equipe</b> e à gestão dos corretores.</small></div></div>
          <div class="pam-item"><span class="pam-ic">🔓</span><div><b>Senha da equipe</b><small>${nCor ? 'Os <b>' + nCor + ' corretores</b> entram com ela' : 'Seus corretores entram com ela'} — cada um vê <b>só os próprios clientes</b>. Crie agora:</small></div></div>
        </div>
        <input id="pam-equipe" type="password" placeholder="senha da equipe (mín. 4)" autocomplete="new-password">
        <div class="pam-alerta">⚠️ Seus corretores <b>conhecem a senha que você acabou de usar</b> (era a senha de todos). Se não trocar a sua, eles ainda conseguem entrar como master. Recomendo trocar agora:</div>
        <input id="pam-master" type="password" placeholder="nova senha de master (opcional, recomendado)" autocomplete="new-password">
        <button class="btn-lime" id="pam-ok" style="margin-top:6px">Salvar e continuar</button>
        <div class="pam-rodape">Sem a senha da equipe seus corretores não conseguem entrar — por isso esta tela fica aqui. Depois de criar, ela não aparece mais.</div>
        <div id="pam-erro" class="lg-erro"></div>
      </div></div>`;
    $('#pam-ok').onclick = async () => {
      const eq = ($('#pam-equipe').value || '').trim();
      const mst = ($('#pam-master').value || '').trim();
      const err = $('#pam-erro'); err.textContent = '';
      if (eq.length < 4) { err.textContent = 'A senha da equipe precisa de pelo menos 4 caracteres.'; return; }
      if (mst && mst.length < 4) { err.textContent = 'A nova senha de master precisa de pelo menos 4 caracteres.'; return; }
      if (mst && mst === eq) { err.textContent = 'A senha da equipe e a do master precisam ser diferentes.'; return; }
      const btn = $('#pam-ok'); btn.disabled = true; btn.textContent = 'salvando…';
      try {
        await STORE.setSenhaEquipe(eq);
        if (mst) await STORE.trocarMinhaSenha(mst); // troca a do master (a sessão segue com o hash novo)
        _painelEquipe = false;
        toast('Pronto! Senha da equipe criada ✓');
        location.hash = '#/home'; render();
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Salvar e continuar'; }
    };
  }

  // ---------- QUEM ESTÁ ACESSANDO (empresa com login compartilhado) ----------
  function vEscolherCorretor() {
    _painelEquipe = false;
    $('#topo').innerHTML = '';
    const u = STORE.getUser() || {};
    // quem entrou com a senha da EQUIPE não pode se passar pelo master → o 1º (master) fica fora do seletor
    const cors = (u.corretores || []).filter((c) => (c.nome || '').trim()).slice(u.ehMaster ? 0 : 1);
    app().innerHTML = `
      <div class="login-wrap"><div class="login-card quem-card">
        <img src="wordmark.png" class="login-logo" alt="DIAMOND">
        <div class="login-sub">${esc(u.nome || 'Empresa')} · quem está acessando?</div>
        <div class="quem-lista">
          ${cors.length ? cors.map((c, i) => `<button class="quem-btn" data-i="${i}"><span class="quem-ava">${esc((c.nome || '?').trim().charAt(0).toUpperCase())}</span>${esc(c.nome)}${u.ehMaster && i === 0 ? '<span class="quem-master">master</span>' : ''}${c.telefone ? '<span class="quem-tel">' + esc(c.telefone) + '</span>' : ''}</button>`).join('')
            : '<div class="nota" style="text-align:center">Nenhum corretor cadastrado ainda — peça ao responsável (master) para cadastrar você na equipe.</div>'}
        </div>
        <div class="quem-rodape">
          ${u.ehMaster ? '<button class="btn-mini quem-link" id="quem-gerenciar">＋ gerenciar equipe</button>' : ''}
          <button class="btn-mini quem-link" id="quem-sair">sair</button>
        </div>
      </div></div>`;
    $$('.quem-btn').forEach((b) => {
      b.onclick = () => { const c = cors[+b.dataset.i]; STORE.setCorretorAtivo(c.nome, c.telefone); _uniDraft = {}; sim = null; location.hash = '#/home'; render(); }; // rascunho limpo (o espelho de leads é re-escopado pelo setCorretorAtivo)
    });
    const gq = $('#quem-gerenciar'); if (gq) gq.onclick = () => vGerenciarCorretores();
    $('#quem-sair').onclick = () => { STORE.logout(); location.hash = '#/login'; location.reload(); };
  }

  // painel de autoatendimento: a EMPRESA gerencia a própria equipe (add/remover corretores + trocar senha).
  // O 1º corretor é o MASTER (responsável): não pode ser removido pela empresa (só pelo admin).
  function vGerenciarCorretores() {
    if (STORE.isAdmin()) { location.hash = '#/admin/corretores'; render(); return; } // admin usa o painel completo
    if (!(STORE.getUser() || {}).ehMaster) { toast('Só o master gerencia a equipe.', true); return; } // servidor também barra
    _painelEquipe = true;
    $('#topo').innerHTML = '';
    const u = STORE.getUser() || {};
    const cors = u.corretores || [];
    const linha = (c, i) => `
      <div class="cor-row" data-master="${i === 0 ? '1' : '0'}" data-nome0="${esc(c.nome || '')}">
        ${i === 0 ? '<span class="master-tag">master</span>' : `<span class="cor-num">${i + 1}</span>`}
        <input class="ce-nome" value="${esc(c.nome || '')}" placeholder="nome" ${i === 0 ? 'disabled title="o master é fixo — só o admin pode alterar"' : ''}>
        <input class="ce-tel" type="tel" inputmode="tel" value="${esc(c.telefone || '')}" placeholder="telefone" ${i === 0 ? 'disabled' : ''}>
        ${i === 0 ? '<span class="cor-fix" title="responsável — não pode ser removido">🔒</span>' : '<button class="cor-del" title="remover corretor">✕</button>'}
      </div>`;
    app().innerHTML = `
      <div class="login-wrap"><div class="login-card quem-card gc-card">
        <img src="wordmark.png" class="login-logo" alt="DIAMOND">
        <div class="login-sub">${esc(u.nome || 'Empresa')} · equipe</div>
        <div class="gc-nota">Edite o <b>nome</b> e o <b>telefone</b> dos corretores, ou remova com ✕. O 1º é o <b>master</b> (responsável) e fica fixo. Toque em <b>salvar equipe</b> ao terminar.</div>
        <div class="cor-rows gc-rows" id="gc-rows">
          ${cors.length ? cors.map(linha).join('') : ''}
          <div class="cor-row cor-novo"><span class="cor-num">+</span><input class="ce-nome" id="gc-nome" placeholder="${cors.length ? 'novo corretor: nome' : 'nome do master (1º corretor)'}"><input class="ce-tel" type="tel" inputmode="tel" id="gc-tel" placeholder="telefone"></div>
        </div>
        ${cors.length ? '' : '<div class="nota" style="text-align:center">nenhum corretor ainda — o 1º que você adicionar será o master</div>'}
        <div class="gc-botoes">
          <button class="btn-mini gc-mais" id="gc-mais">＋ outra linha</button>
          <button class="btn-lime gc-salvar" id="gc-salvar">salvar equipe</button>
        </div>
        <div class="gc-senhas">
          <div class="gc-senha-lin">
            <span class="gc-senha-tag">🔓 senha da equipe</span>
            <input id="gc-eq" type="password" placeholder="nova senha (mín. 4)" autocomplete="new-password">
            <button class="btn-mini" id="gc-eqbtn">trocar</button>
          </div>
          <div class="nota gc-senha-exp">Todos os <b>${Math.max(0, cors.length - 1)} corretores</b> entram com esta. Cada um vê só os próprios clientes.</div>
          <div class="gc-senha-lin">
            <span class="gc-senha-tag master">🔑 sua senha de master</span>
            <input id="gc-senha" type="password" placeholder="nova senha (mín. 4)" autocomplete="new-password">
            <button class="btn-mini" id="gc-senhabtn">trocar</button>
          </div>
          <div class="nota gc-senha-exp">Só sua. Dá acesso aos clientes de <b>toda a equipe</b> e a esta tela.</div>
        </div>
        <div class="gc-logo">
          <div class="gc-logo-tag">🖼️ Logo da sua imobiliária <span class="opcional">(opcional)</span></div>
          <div class="gc-logo-row">
            <div class="gc-logo-preview ${u.logoId ? '' : 'vazia'}" id="gc-logo-preview" data-logoid="${esc(u.logoId || '')}">${u.logoId ? '' : 'sem logo'}</div>
            <div class="gc-logo-acoes">
              <input type="file" id="gc-logo-file" accept="image/png,image/jpeg,image/*" style="display:none">
              <button class="btn-mini" id="gc-logo-btn">${u.logoId ? 'trocar logo' : 'adicionar logo'}</button>
              ${u.logoId ? '<button class="btn-mini gc-logo-del" id="gc-logo-del">remover</button>' : ''}
            </div>
          </div>
          <div class="nota gc-senha-exp">Aparece no rodapé das propostas (PDF), na página que o cliente abre e no topo do sistema. Se não colocar, tudo funciona igual.</div>
        </div>
        <button class="btn gc-concluir" id="gc-voltar">concluir</button>
      </div></div>`;
    const rowsData = () => $$('#gc-rows .cor-row').map((r) => ({ nome: (($('.ce-nome', r) || {}).value || '').trim(), telefone: (($('.ce-tel', r) || {}).value || '').trim() })).filter((c) => c.nome);
    const ligarDel = () => $$('#gc-rows .cor-del').forEach((b) => { b.onclick = () => b.closest('.cor-row').remove(); });
    ligarDel();
    $('#gc-mais').onclick = () => {
      const nova = document.createElement('div'); nova.className = 'cor-row';
      nova.innerHTML = '<span class="cor-num">•</span><input class="ce-nome" placeholder="nome"><input class="ce-tel" type="tel" inputmode="tel" placeholder="telefone"><button class="cor-del" title="remover corretor">✕</button>';
      $('#gc-rows').insertBefore(nova, $('#gc-rows .cor-novo')); ligarDel(); $('.ce-nome', nova).focus();
    };
    // renomeados = linhas cujo nome mudou → o servidor guarda alias p/ os leads antigos não ficarem órfãos
    const renomeadosDoForm = () => $$('#gc-rows .cor-row').map((r) => ({ de: r.dataset.nome0 || '', para: (($('.ce-nome', r) || {}).value || '').trim() }))
      .filter((x) => x.de && x.para && x.de !== x.para);
    const salvar = async () => {
      const btn = $('#gc-salvar'); btn.disabled = true; const txt = btn.textContent; btn.textContent = 'salvando…';
      const dados = rowsData(); const renom = renomeadosDoForm();
      // quem foi removido? (compara os corretores atuais, exceto master, com a lista salva — desconta os renomeados)
      const mapaRenome = {}; renom.forEach((x) => { mapaRenome[x.de] = x.para; });
      const depois = new Set(dados.map((c) => c.nome));
      const removidos = (u.corretores || []).slice(1).map((c) => (c.nome || '').trim()).filter(Boolean)
        .filter((nome) => !depois.has(mapaRenome[nome] || nome));
      try {
        await STORE.setMeusCorretores(dados, renom); toast('Equipe salva ✓');
        if (removidos.length && confirm('Você removeu ' + (removidos.length > 1 ? removidos.length + ' corretores' : '"' + removidos[0] + '"') + '.\n\nEssa pessoa ainda SABE a senha da equipe e pode continuar entrando. Quer trocar a senha da equipe agora para revogar o acesso?')) {
          vGerenciarCorretores();
          setTimeout(() => { const eq = $('#gc-eq'); if (eq) { eq.focus(); eq.scrollIntoView({ block: 'center' }); } }, 60);
          return;
        }
        vGerenciarCorretores();
      }
      catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = txt; }
    };
    $('#gc-salvar').onclick = salvar;
    $('#gc-senhabtn').onclick = async () => {
      const nova = ($('#gc-senha').value || '').trim();
      if (nova.length < 6) { toast('Senha muito curta (mínimo 6).', true); return; }
      const el = $('#gc-senhabtn'); el.disabled = true;
      try { await STORE.trocarMinhaSenha(nova); toast('Sua senha de master foi trocada ✓'); const s = $('#gc-senha'); if (s) s.value = ''; }
      catch (e) { toast(e.message, true); }
      el.disabled = false;
    };
    $('#gc-eqbtn').onclick = async () => {
      const nova = ($('#gc-eq').value || '').trim();
      if (nova.length < 6) { toast('Senha muito curta (mínimo 6).', true); return; }
      const el = $('#gc-eqbtn'); el.disabled = true;
      try { await STORE.setSenhaEquipe(nova); toast('Senha da equipe trocada ✓ — avise os corretores'); const s = $('#gc-eq'); if (s) s.value = ''; }
      catch (e) { toast(e.message, true); }
      el.disabled = false;
    };
    // logo da imobiliária: preview + upload + remover
    (async () => { const pv = $('#gc-logo-preview'); const fid = pv && pv.dataset.logoid;
      if (pv && fid) { const f = await STORE.obterFoto(fid); if (f) pv.style.backgroundImage = `url(data:${f.mime};base64,${f.base64})`; } })();
    const lf = $('#gc-logo-file');
    $('#gc-logo-btn').onclick = () => lf.click();
    lf.onchange = async () => {
      const file = lf.files && lf.files[0]; if (!file) return;
      const btn = $('#gc-logo-btn'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'enviando…';
      try { await STORE.anexarLogo(file); toast('Logo salva ✓'); vGerenciarCorretores(); }
      catch (e) { toast('Erro ao enviar a logo: ' + e.message, true); btn.disabled = false; btn.textContent = t; }
    };
    const ld = $('#gc-logo-del'); if (ld) ld.onclick = async () => {
      if (!confirm('Remover a logo da imobiliária?')) return;
      ld.disabled = true;
      try { await STORE.removerLogo(); toast('Logo removida'); vGerenciarCorretores(); }
      catch (e) { toast(e.message, true); ld.disabled = false; }
    };
    $('#gc-voltar').onclick = () => { _painelEquipe = false; location.hash = '#/home'; render(); };
  }

  // identidade que assina a proposta (admin = ele mesmo; empresa = corretor ativo)
  function ator() {
    const u = STORE.getUser() || {};
    if (u.papel === 'admin') return { nome: u.nome, telefone: u.telefone || '', empresa: u.empresa || '', usuario: u.usuario, papel: 'admin' };
    const a = u.corretorAtivo || {};
    return { nome: a.nome || u.nome, telefone: a.telefone || u.telefone || '', empresa: u.nome || '', usuario: u.usuario, papel: 'corretor' };
  }
  // lista de possíveis autores de uma proposta (p/ o admin escolher no simulador em NOME de qual corretor):
  // o próprio usuário logado + todos os corretores cadastrados das imobiliárias.
  function corretoresParaProposta() {
    const u = STORE.getUser() || {};
    const out = [{ nome: u.nome, usuario: u.usuario, empresa: u.empresa || '', telefone: u.telefone || '', papel: u.papel || 'corretor' }];
    const seen = new Set([(u.usuario || '') + '|' + (u.nome || '')]);
    (STORE.getUsuarios() || []).forEach((e) => {
      if (e.papel === 'admin' || e.papel === 'cliente') return;
      (e.corretores || []).forEach((c) => {
        const nome = (c.nome || '').trim(); if (!nome) return;
        const k = e.usuario + '|' + nome; if (seen.has(k)) return; seen.add(k);
        out.push({ nome, usuario: e.usuario, empresa: e.nome || '', telefone: c.telefone || '', papel: 'corretor' });
      });
    });
    return out;
  }
  const corrLabel = (r) => r.nome + (r.empresa ? ' · ' + r.empresa : (r.papel === 'admin' ? ' · Domo' : ''));

  // ---------- HOME (espelho) ----------
  const filtros = { busca: '', andar: '', status: '' };
  function vHome() {
    const cfg = STORE.getCfg() || {};
    const cli = ehCliente(); const cc = cliCfg(); // acesso cliente: espelho só-leitura
    if (cli) filtros.verVendidas = true; // cliente vê o quadro completo: disponíveis, reservadas E vendidas
    const uns = STORE.getUnidades().slice().sort((a, b) => String(a.unidade).padStart(5, '0') < String(b.unidade).padStart(5, '0') ? -1 : 1);
    const disp = uns.filter((u) => u.status === 'Disponível');
    const res = uns.filter((u) => u.status === 'Reservado');
    const somaDisp = disp.reduce((s, u) => s + valorNegociadoTabela(u, cfg), 0);
    const resPend = Object.fromEntries(STORE.getReservas().map((r) => [r.unidadeId, r])); // pedidos de reserva pendentes
    const andares = [...new Set(uns.map((u) => u.andar))].sort((a, b) => a - b);

    const vend = uns.filter((u) => u.status === 'Vendido');
    const lista = uns.filter((u) =>
      (!filtros.busca || String(u.unidade).includes(filtros.busca))
      && (filtros.andar === '' || String(u.andar) === filtros.andar)
      && (!filtros.status || u.status === filtros.status)
      // vendidas ficam fora por padrão: são 1/4 da lista e não há o que fazer com elas
      && (filtros.verVendidas || filtros.status === 'Vendido' || u.status !== 'Vendido'));

    const somaRes = res.reduce((s, u) => s + valorNegociadoTabela(u, cfg), 0);
    const somaVend = vend.reduce((s, u) => s + valorNegociadoTabela(u, cfg), 0);
    const chip = (label, arr, soma, status, cls) =>
      `<button class="chip ${cls} ${filtros.status === status ? 'on' : ''}" data-status="${status}">
        ${label}: <b>${arr.length}</b>${STORE.isAdmin() && soma > 0 ? ' · ' + fmt(soma) : ''}</button>`;
    app().innerHTML = `
      <div class="espelho-top">
        ${cli ? '' : `${(STORE.getUser() || {}).usuario === 'domo' ? '<a class="btn-crm" href="#/scp">💠 SCP</a> <a class="btn-crm" href="#/admin/clientes">📊 Painel</a>' : ''}
        ${(STORE.isAdmin() || (STORE.getUser() || {}).usuario === 'domo') ? '<a class="btn-crm" href="#/retorno">📈 Retorno</a>' : ''}
        ${STORE.isAdmin() ? '' : '<a class="btn-crm" href="#/clientes">👥 CRM</a>'}`}
        ${!cli || cc.baixarPdf ? '<button class="btn-baixar" id="baixar-tabela">⬇ Baixar tabela (PDF)</button>' : ''}
      </div>
      <div class="chips">
        ${chip('Disponíveis', disp, somaDisp, 'Disponível', 'ok')}
        ${chip('Reservadas', res, somaRes, 'Reservado', 'warn')}
        ${chip('Vendidas', vend, somaVend, 'Vendido', 'red')}
        ${!cli || cc.predio ? '<button class="chip chip-predio" id="chip-predio">◆ Apresentação Diamond</button>' : ''}
      </div>
      <div class="filtros">
        <input id="f-busca" placeholder="buscar unidade…" value="${esc(filtros.busca)}">
        <select id="f-andar"><option value="">Todos os andares</option>
          ${andares.map((a) => `<option value="${a}" ${String(a) === filtros.andar ? 'selected' : ''}>${a === 0 ? 'Térreo' : a + 'º andar'}</option>`).join('')}</select>
        <select id="f-status"><option value="">Todos os status</option>
          ${[['Disponível', 'Disponíveis'], ['Reservado', 'Reservadas'], ['Vendido', 'Vendidas']].map(([v, lab]) => `<option value="${v}" ${filtros.status === v ? 'selected' : ''}>${lab}</option>`).join('')}</select>
      </div>
      <div class="lista">
        ${lista.map((u) => {
          const vt = valorNegociadoTabela(u, cfg); // preço EFETIVO (aplica desconto da unidade)
          const temDesc = (u.desconto || 0) > 0;
          const pedida = resPend[u.id]; // pedido de reserva pendente → todos veem (evita 2 corretores no mesmo apto)
          const clicavel = !cli && (u.status === 'Disponível' || STORE.isAdmin()); // corretor não abre vendido/reservado; cliente não abre nada
          return `<div class="lin ${u.status === 'Vendido' ? 'vendido' : u.status === 'Reservado' ? 'reservado' : ''} ${clicavel ? '' : 'lin-travada'}" data-un="${esc(String(u.unidade))}" ${clicavel ? `onclick="location.hash='#/sim/${u.id}'"` : ''}>
            <span class="lin-foto" data-fotoid="${fotoDe(u, cfg)}"></span>
            <span class="lin-un">${esc(u.unidade)}</span>
            <span class="lin-info">${u.andar === 0 ? 'Térreo' : u.andar + 'º andar'} · ${u.area ? u.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m²' : '—'}</span>
            <span class="lin-preco">${cli
              ? (u.status !== 'Disponível' ? '' /* cliente: sem valor em vendido/reservado */
                  : (cc.precos && u.precoBase ? fmt(vt) + (u.area ? '<small>' + fmt(vt / u.area) + '/m²</small>' : '') : '<span class="sem-preco">consultar</span>'))
              : (u.precoBase ? (temDesc ? '<s class="preco-de">' + fmt(valorTabela(u, cfg)) + '</s> ' : '') + fmt(vt) + (temDesc ? ' <span class="preco-desc">−' + pct(u.desconto) + '</span>' : '') : (u.status === 'Disponível' ? '<span class="sem-preco">consultar</span>' : '')) + (u.precoBase && u.area ? '<small>' + fmt(vt / u.area) + '/m²</small>' : '')}</span>
            ${pedida && u.status === 'Disponível' ? `<span class="badge b-pedida" title="${esc(cli ? 'Reserva solicitada — aguardando confirmação' : pedida.deOutraEmpresa ? 'Outra imobiliária pediu a reserva desta unidade — aguardando a Domo confirmar' : 'Reserva solicitada por ' + (pedida.corretor || '') + ' — aguardando a Domo confirmar')}">⏳ reserva pedida</span>` : `<span class="badge ${u.status === 'Disponível' ? 'b-ok' : u.status === 'Vendido' ? 'b-red' : 'b-warn'}">${u.status}</span>`}
          </div>`;
        }).join('')}
        ${vend.length && !filtros.status ? `<button class="ver-vendidas" id="ver-vend">${filtros.verVendidas ? '− ocultar as ' + vend.length + ' vendidas' : '+ ver as ' + vend.length + ' vendidas'}</button>` : ''}
      </div>`;
    const vv = $('#ver-vend'); if (vv) vv.onclick = () => { filtros.verVendidas = !filtros.verVendidas; vHome(); };
    $$('.chip').forEach((c) => {
      if (c.id === 'chip-predio') { c.onclick = () => { location.hash = '#/predio'; }; return; }
      c.onclick = () => { filtros.status = filtros.status === c.dataset.status ? '' : c.dataset.status; vHome(); };
    });
    // estado-vazio ÚNICO (evita empilhar 2 mensagens): considera nº de cards, quantos estão visíveis e os filtros ativos
    const atualizaVazio = () => {
      const cards = $$('.lista .lin');
      const visiveis = cards.filter((el) => el.style.display !== 'none').length;
      const q = (filtros.busca || '').trim();
      let msg = '';
      if (!cards.length) msg = (filtros.andar || filtros.status || q) ? 'Nenhuma unidade com esse filtro.' : (uns.length ? 'Nenhuma unidade para mostrar.' : 'Carregando as unidades…');
      else if (!visiveis) msg = q ? 'Nenhuma unidade com "' + q + '".' : 'Nenhuma unidade com esse filtro.';
      let vaz = $('#lista-vazia');
      if (msg) { if (!vaz) { vaz = document.createElement('div'); vaz.id = 'lista-vazia'; vaz.className = 'vazio'; $('.lista').appendChild(vaz); } vaz.textContent = msg; }
      else if (vaz) vaz.remove();
    };
    // busca por unidade: filtra os cards no cliente (sem vHome → sem reconstruir o DOM, recarregar fotos nem chamar pullReservas a cada tecla)
    $('#f-busca').oninput = (e) => {
      filtros.busca = e.target.value; // guarda o estado p/ sobreviver a um vHome posterior (troca de andar/status)
      const q = e.target.value.trim();
      $$('.lista .lin').forEach((el) => { el.style.display = (!q || (el.dataset.un || '').includes(q)) ? '' : 'none'; });
      atualizaVazio();
    };
    atualizaVazio(); // estado inicial (lista vazia por filtro de andar/status, inventário ainda carregando, etc.)
    $('#f-andar').onchange = (e) => { filtros.andar = e.target.value; vHome(); };
    $('#f-status').onchange = (e) => { filtros.status = e.target.value; vHome(); };
    { const bt = $('#baixar-tabela'); if (bt) bt.onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'gerando…';
      try { const { doc, nome } = await gerarTabelaPDF(cfg, uns); doc.save(nome); } catch (err) { toast('Erro ao gerar: ' + err.message, true); }
      b.disabled = false; b.textContent = '⬇ Baixar tabela (PDF)';
    }; }
    ativarFotos();
    montarFabDomo();
    // reservas pendentes vêm do servidor: se mudou, repinta o espelho (sem isso o 2º corretor não vê o pedido do 1º)
    // compara por CONTEÚDO (unidade+data+de-outra-empresa), não só quantidade — troca de reserva com mesma contagem também repinta
    const sigRes = (arr) => arr.map((r) => (r.unidadeId || '') + ':' + (r.em || '') + ':' + (r.deOutraEmpresa ? 1 : 0)).sort().join('|');
    const resAntes = sigRes(Object.values(resPend));
    STORE.pullReservas().then((rs) => { if (sigRes(rs) !== resAntes && location.hash.replace(/^#/, '').replace(/^\//, '') === 'home') vHome(); });
  }

  // ---------- UNIDADE (corretor: estática, sem cálculo de venda) ----------
  let _uniDraft = {};
  let _painelEquipe = false; // true enquanto o painel de equipe (fora de rota) está aberto — evita o pull de 30s destruí-lo
  function vUnidade(id) {
    const cfg = STORE.getCfg() || {};
    const u = STORE.unidadePorId(id);
    if (!u) { app().innerHTML = '<div class="vazio">Unidade não encontrada. <a href="#/home">voltar ao espelho</a></div>'; return; }
    if (!STORE.isAdmin() && u.status !== 'Disponível') { app().innerHTML = '<div class="vazio">Unidade indisponível. <a href="#/home">voltar ao espelho</a></div>'; return; }
    const user = ator(); // quem assina a proposta (corretor ativo da empresa, ou o próprio admin)
    const vt = valorNegociadoTabela(u, cfg); // preço EFETIVO (aplica desconto da unidade) — vale p/ VALOR, plano e proposta
    const temDesc = (u.desconto || 0) > 0;
    // plano do corretor — o corretor MONTA escolhendo entrada/parcelas/final entre as opções configuradas em ADM → Config
    const entDefault = Math.round((cfg.planoEntradaPct ?? 0.20) * 100);
    const finDefault = Math.round((cfg.planoFinalPct ?? 0.30) * 100);
    const entradaOpts = [...new Set([entDefault, ...(Array.isArray(cfg.planoEntradaOpcoes) ? cfg.planoEntradaOpcoes : [10, 20, 30])])].filter((n) => n > 0 && n < 100).sort((a, b) => a - b);
    const finalOpts = [...new Set([finDefault, ...(Array.isArray(cfg.planoFinalOpcoes) ? cfg.planoFinalOpcoes : [30, 40, 50])])].filter((n) => n > 0 && n < 100).sort((a, b) => a - b);
    const parcelasOpts = (Array.isArray(cfg.planoParcelas) && cfg.planoParcelas.length ? cfg.planoParcelas : [12, 24, 36]).slice().sort((a, b) => a - b);
    const parcelaDefault = parcelasOpts[Math.min(1, parcelasOpts.length - 1)]; // 2ª opção (ex.: 24x) ou a 1ª
    const d = _uniDraft[id] || (_uniDraft[id] = { cliente: '', clienteTel: '', planoOn: false, parcelas: parcelaDefault, entradaPct: entDefault, finalPct: finDefault });
    if (!parcelasOpts.includes(d.parcelas)) d.parcelas = parcelaDefault; // sanitiza se a opção mudou
    if (!entradaOpts.includes(d.entradaPct)) d.entradaPct = entradaOpts.includes(entDefault) ? entDefault : entradaOpts[0];
    if (!finalOpts.includes(d.finalPct)) d.finalPct = finalOpts.includes(finDefault) ? finDefault : finalOpts[0];
    const buildPlano = (n) => PLANO.calc({
      neg: vt, forma: 'perso', entradaPct: d.entradaPct / 100, finalPct: d.finalPct / 100, nParcelas: n,
      balQtde: cfg.balQtde ?? 0, balValor: cfg.balValor ?? 0,
      balPrimeiro: cfg.balPrimeiro ?? 6, balIntervalo: cfg.balIntervalo ?? 6,
      chavesMes: cfg.chavesMes ?? 36, correcaoMensal: cfg.correcaoMensal || 0,
      correcaoDesde: cfg.correcaoDesde || 1, dataProposta: new Date(), diaVenc: cfg.diaVenc || 10,
    });
    const plano = d.planoOn && u.precoBase ? buildPlano(d.parcelas) : null;

    app().innerHTML = `
      <div class="sim">
        <a class="volta" href="#/home">← espelho</a>
        <div class="painel uni-painel">
          <div class="sim-foto${fotoDe(u, cfg) ? ' zoomavel' : ''}" data-fotoid="${fotoDe(u, cfg)}">${fotoDe(u, cfg) ? '<span class="foto-zoom">🔍</span>' : ''}</div>
          <h2>Unidade ${esc(u.unidade)} ${u.status !== 'Disponível' ? `<span class="badge ${u.status === 'Vendido' ? 'b-red' : 'b-warn'}">${u.status}</span>` : ''}</h2>
          <div class="linhas">
            <div><span>Andar</span><b>${u.andar === 0 ? 'Térreo' : u.andar + 'º'}</b></div>
            <div><span>Área</span><b>${u.area ? u.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m²' : '—'}</b></div>
            <div><span>R$/m²</span><b>${u.precoBase && u.area ? fmt(vt / u.area) : '—'}</b></div>
            ${temDesc && u.precoBase ? `<div><span>Valor de tabela</span><b><s>${fmt(valorTabela(u, cfg))}</s></b></div>
            <div><span>Desconto</span><b class="txt-desc">−${pct(u.desconto)}</b></div>` : ''}
            <div class="destaque"><span>VALOR</span><b>${u.precoBase ? fmt(vt) : 'consultar'}</b></div>
          </div>

          ${u.precoBase ? `
          <h3>Plano de pagamento</h3>
          <label class="uni-toggle"><input type="checkbox" id="u-plano" ${d.planoOn ? 'checked' : ''}> Incluir plano de pagamento na proposta</label>
          ${d.planoOn && plano ? `
            <div class="uni-escolha">
              <div class="uni-campo"><label>Entrada</label><div class="uni-parc">${entradaOpts.map((n) => `<button class="parc-btn ${d.entradaPct === n ? 'on' : ''}" data-ent="${n}">${n}%</button>`).join('')}</div></div>
              <div class="uni-campo"><label>Parcelas mensais</label><div class="uni-parc">${parcelasOpts.map((n) => `<button class="parc-btn ${d.parcelas === n ? 'on' : ''}" data-n="${n}">${n}x</button>`).join('')}</div></div>
              <div class="uni-campo"><label>Parcela final (chaves)</label><div class="uni-parc">${finalOpts.map((n) => `<button class="parc-btn ${d.finalPct === n ? 'on' : ''}" data-fin="${n}">${n}%</button>`).join('')}</div></div>
            </div>
            <div class="linhas uni-plano">
              <div><span>Entrada (${d.entradaPct}%)</span><b>${fmt(plano.ent)}</b></div>
              <div><span>Parcelas mensais (${plano.nParc}x)</span><b>${fmt(plano.vParc, 2)}</b></div>
              ${plano.balQtde ? `<div><span>Balões (${plano.balQtde}x)</span><b>${fmt(plano.balValor)}</b></div>` : ''}
              <div><span>Parcela final (${d.finalPct}%) · mês ${plano.chavesMes}</span><b>${fmt(plano.fin)}</b></div>
            </div>
            <div class="nota">Correção ${esc(cfg.indice || 'INCC')} nas parcelas e balões. Escolha a entrada, as parcelas e a parcela final acima.</div>
          ` : '<div class="nota">Sem plano, a proposta sai só com o valor da unidade.</div>'}
          ` : ''}

          ${(() => { const p = STORE.getReservas().find((r) => r.unidadeId === u.id); // já pedida? avisa ANTES de trabalhar à toa
            if (!p || u.status !== 'Disponível') return '';
            // fora da própria empresa NÃO se revela cliente nem corretor (o espelho é compartilhado com concorrentes)
            return p.deOutraEmpresa
              ? `<div class="aviso-pedida">⏳ <b>Já existe pedido de reserva</b> para esta unidade, feito por <b>outra imobiliária</b> em ${fmtData(p.em)}. A Domo ainda não confirmou.</div>`
              : `<div class="aviso-pedida">⏳ <b>Já existe pedido de reserva</b> para esta unidade — ${esc(p.cliente || '')} (por ${esc(p.corretor || '')}, ${fmtData(p.em)}). A Domo ainda não confirmou.</div>`; })()}
          <h3>Proposta</h3>
          <div class="form">
            <label>Cliente<input id="u-cliente" value="${esc(d.cliente)}" placeholder="nome do cliente"></label>
            <label>Telefone do cliente<input id="u-tel" type="tel" inputmode="tel" value="${esc(d.clienteTel)}" placeholder="(34) 9 9999-9999"></label>
            <label>Corretor<input value="${esc(user.nome)}${user.empresa ? ' · ' + esc(user.empresa) : ''}" disabled></label>
          </div>
          <div class="acoes">
            <button class="btn btn-whats" id="u-whats">Enviar proposta no WhatsApp</button>
            <button class="btn btn-sec" id="u-pdf">📄 Baixar PDF</button>
            <button class="btn btn-reserva" id="u-reserva">🔖 Solicitar reserva à Domo</button>
          </div>
        </div>
      </div>`;
    ativarFotos();
    // planta clicável → abre o visor com zoom (o mesmo da galeria do prédio)
    const fotoUn = fotoDe(u, cfg);
    if (fotoUn) { const sf = $('.sim-foto'); if (sf) { sf.style.cursor = 'zoom-in'; sf.onclick = () => abrirVisor([fotoUn], 0); } }
    // trocar de cliente = proposta NOVA (não sobrescreve a anterior no Histórico)
    $('#u-cliente').oninput = (e) => { d.cliente = e.target.value; d.propostaId = null; d.criadoEm = null; };
    $('#u-tel').oninput = (e) => { d.clienteTel = e.target.value; d.propostaId = null; d.criadoEm = null; };
    const pl = $('#u-plano'); if (pl) pl.onchange = () => { d.planoOn = pl.checked; vUnidade(id); };
    $$('.parc-btn').forEach((b) => { b.onclick = () => { if (b.dataset.ent) d.entradaPct = +b.dataset.ent; else if (b.dataset.fin) d.finalPct = +b.dataset.fin; else d.parcelas = +b.dataset.n; vUnidade(id); }; });

    const montaP = (comPlano) => {
      const criadoEm = d.criadoEm || (d.criadoEm = new Date().toISOString());
      const dataProposta = criadoEm.slice(0, 10); // YYYY-MM-DD — base do cronograma ao reabrir no simulador
      return {
        id: d.propostaId || (d.propostaId = 'p-' + Date.now() + '-' + u.unidade),
        unidadeId: u.id, unidade: u.unidade, area: u.area,
        cliente: d.cliente.trim(), clienteTel: d.clienteTel.trim(),
        corretor: user.nome, corretorUsuario: user.usuario, corretorTel: user.telefone || '', corretorPapel: user.papel, corretorEmpresa: user.empresa || '',
        neg: vt, forma: comPlano ? 'perso' : 'avista', formaLabel: comPlano ? 'Personalizado' : 'À vista',
        inp: comPlano
          ? { forma: 'perso', entradaPct: d.entradaPct, finalPct: d.finalPct, nParcelas: d.parcelas, balQtde: cfg.balQtde ?? 0, balValor: cfg.balValor ?? 0, balPrimeiro: cfg.balPrimeiro ?? 6, balIntervalo: cfg.balIntervalo ?? 6, chavesMes: cfg.chavesMes ?? 36, diaVenc: cfg.diaVenc || 10, indice: cfg.indice || 'INCC', dataProposta }
          : { forma: 'avista', diaVenc: cfg.diaVenc || 10, indice: cfg.indice || 'INCC', dataProposta },
        criadoEm,
      };
    };
    const saud = () => `Olá ${d.cliente}! 😊 Aqui é ${user.nome}${user.empresa ? ' (' + user.empresa + ')' : ''}.\n\n`;
    const assina = () => `\n\nQualquer dúvida, estou à disposição!\n${user.nome}${user.telefone ? ' — ' + user.telefone : ''}`;
    const msgSimples = () => saud() + `Segue a proposta da unidade ${u.unidade} do Edifício Diamond — Domo Construtora:\n\n`
      + `• Unidade ${u.unidade} · ${u.andar === 0 ? 'Térreo' : u.andar + 'º andar'} · ${u.area ? u.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m²' : ''}\n`
      + `• Valor: ${u.precoBase ? fmt(vt) + (temDesc ? ' (de ' + fmt(valorTabela(u, cfg)) + ' · −' + pct(u.desconto) + ')' : '') : 'sob consulta'}` + assina();
    const msgComPlano = (p, pln) => saud() + `Proposta da unidade ${u.unidade} — Edifício Diamond:\n\n${resumoTexto(pln, p)}` + assina();

    const preparar = async () => {
      if (!d.cliente.trim()) { toast('Preencha o nome do cliente.', true); return null; }
      const comPlano = d.planoOn && !!u.precoBase;
      const pln = comPlano ? buildPlano(d.parcelas) : null;
      if (comPlano && (pln.parcelaNegativa || !pln.fecha)) { toast('Plano indisponível para esta unidade — fale com a administração.', true); return null; }
      const p = montaP(comPlano);
      STORE.salvarProposta(p); // rastreio: fica no Histórico com corretor + empresa
      if (comPlano) { const g = await gerarPDF(p, pln, cfg); return { ...g, msg: msgComPlano(p, pln) }; }
      const g = await gerarPropostaSimples(u, cfg, d.cliente, d.clienteTel, user); return { ...g, msg: msgSimples() };
    };

    $('#u-pdf').onclick = async () => { const r = await preparar(); if (r) { r.doc.save(r.nome); toast('Proposta gerada ✓'); } };
    // WhatsApp por LINK: gera o PDF → hospeda na plataforma → manda saudação + link (o cliente clica e abre o PDF)
    $('#u-whats').onclick = async () => {
      if (!d.cliente.trim()) { toast('Preencha o nome do cliente.', true); return; }
      if (!d.clienteTel.trim()) { toast('Preencha o telefone do cliente para enviar no WhatsApp.', true); return; }
      const win = window.open('about:blank', '_blank'); // pré-abre no clique (evita bloqueio de popup depois do await)
      const btn = $('#u-whats'); btn.disabled = true; btn.textContent = 'gerando…';
      try {
        const r = await preparar(); if (!r) { if (win) win.close(); return; }
        // CRM primeiro: o link nasce amarrado ao cliente → as aberturas/interesse voltam pro corretor certo
        const cr = await crmRegistrar({ cliente: d.cliente, clienteTel: d.clienteTel, unidade: u.unidade, estagio: 'proposta' });
        const base64 = r.doc.output('datauristring').split(',')[1];
        const link = await STORE.enviarPropostaPdf(base64, { unidade: u.unidade, valor: u.precoBase ? vt : 0, area: u.area || 0, andar: u.andar, cliente: d.cliente, corretor: user.nome, corretorTel: user.telefone, empresa: user.empresa, propostaId: d.propostaId, leadId: (cr && cr.id) || '' });
        const msg = r.msg + `\n\n📄 Abra sua proposta aqui: ${link}`;
        const url = 'https://wa.me/' + telWa(d.clienteTel) + '?text=' + encodeURIComponent(msg);
        if (win) win.location.href = url; else window.open(url, '_blank');
        toast('WhatsApp aberto' + (cr && cr.acao === 'novo' ? ' · cliente salvo no CRM 👥' : cr && cr.acao === 'atualizado' ? ' · CRM atualizado 👥' : '') + ' ✓');
      } catch (e) { if (win) win.close(); toast('Erro ao preparar o link: ' + e.message, true); }
      finally { btn.disabled = false; btn.textContent = 'Enviar proposta no WhatsApp'; }
    };
    // Solicitar reserva → WhatsApp da Domo (dono) com unidade + cliente + corretor. Não muda o status (a Domo confirma e reserva).
    $('#u-reserva').onclick = async (ev) => {
      if (!d.cliente.trim()) { toast('Preencha o nome do cliente para solicitar a reserva.', true); return; }
      const rb = ev.currentTarget; if (rb.disabled) return; rb.disabled = true; // trava contra duplo-toque (evita lead/mensagem duplicados)
      // registra o pedido: se JÁ existe um de outro corretor, avisa antes de mandar (dois no mesmo apto = briga)
      try {
        const pr = await STORE.pedirReserva({ unidadeId: u.id, unidade: u.unidade, cliente: d.cliente.trim(), corretor: user.nome });
        if (pr && pr.jaPedida) {
          const r0 = pr.reserva || {};
          const meu = !r0.deOutraEmpresa && r0.corretor === user.nome;
          const txt = meu
            ? `Você já pediu a reserva desta unidade para "${r0.cliente}" em ${fmtData(r0.em)}.\n\nMandar a mensagem de novo?`
            : r0.deOutraEmpresa
              ? `⚠️ ATENÇÃO: a unidade ${u.unidade} já tem um pedido de reserva de OUTRA imobiliária, feito em ${fmtData(r0.em)}.\n\nA Domo ainda não confirmou. Quer pedir mesmo assim?`
              : `⚠️ ATENÇÃO: já existe um pedido de reserva para a unidade ${u.unidade}, da sua equipe:\n\n• Cliente: ${r0.cliente}\n• Corretor: ${r0.corretor}\n• Em: ${fmtData(r0.em)}\n\nA Domo ainda não confirmou. Quer pedir mesmo assim?`;
          if (!confirm(txt)) { rb.disabled = false; return; }
          await STORE.pedirReserva({ unidadeId: u.id, unidade: u.unidade, cliente: d.cliente.trim(), corretor: user.nome }, true);
        }
      } catch (e) { /* offline: segue e manda o WhatsApp mesmo assim */ }
      const num = telWa(cfg.contatoWhats || '11972746113');
      const msg = [
        '🔖 *Solicitação de reserva* — Edifício Diamond',
        '',
        `*Unidade:* ${u.unidade}${u.andar != null ? ' · ' + (u.andar === 0 ? 'Térreo' : u.andar + 'º andar') : ''}${u.area ? ' · ' + u.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m²' : ''}`,
        `*Valor:* ${u.precoBase ? fmt(vt) : 'a combinar'}`,
        `*Cliente:* ${d.cliente.trim()}${d.clienteTel.trim() ? ' · ' + d.clienteTel.trim() : ''}`,
        `*Corretor:* ${user.nome}${user.empresa ? ' · ' + user.empresa : ''}`,
        '',
        'Por favor, confirmar a reserva desta unidade. 🙏',
      ].join('\n');
      window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank');
      try {
        const cr = await crmRegistrar({ cliente: d.cliente, clienteTel: d.clienteTel, unidade: u.unidade, estagio: 'negociando', temp: 'quente', forceTemp: true });
        toast('Reserva solicitada' + (cr && cr.acao === 'novo' ? ' · cliente salvo no CRM 👥' : cr && cr.acao === 'atualizado' ? ' · CRM atualizado 👥' : '') + ' ✓');
      } finally { rb.disabled = false; }
    };
    montarFabDomo();
  }

  // ---------- SIMULADOR ----------
  function inputsPadrao(u, cfg) {
    return {
      cliente: '', clienteTel: '',
      forma: 'perso',
      entradaPct: (cfg.entradaPct ?? 0.2) * 100,
      finalPct: (cfg.finalPct ?? 0.4) * 100,
      nParcelas: cfg.nParcelas ?? 30,
      balQtde: cfg.balQtde ?? 5, balValor: cfg.balValor ?? 10000,
      balPrimeiro: cfg.balPrimeiro ?? 6, balIntervalo: cfg.balIntervalo ?? 6,
      chavesMes: cfg.chavesMes ?? 36,
      dataProposta: hoje(), diaVenc: cfg.diaVenc ?? 10,
      indice: cfg.indice || 'INCC',
    };
  }
  let sim = null; // estado do simulador corrente
  let _simCorretorKey = ''; // último corretor escolhido no simulador (persiste entre unidades p/ lançamento em série)

  function vSim(unidadeId, propostaId) {
    const cfg = STORE.getCfg() || {};
    const u = STORE.unidadePorId(unidadeId);
    if (!u) { app().innerHTML = '<div class="vazio">Unidade não encontrada. <a href="#/home">voltar</a></div>'; return; }
    if (!sim || sim.unidadeId !== unidadeId || sim.propostaId !== propostaId) {
      sim = { unidadeId, propostaId, inp: inputsPadrao(u, cfg) };
      if (propostaId) {
        const p = STORE.getPropostas().find((x) => x.id === propostaId);
        if (p) {
          sim.inp = { ...sim.inp, ...p.inp, cliente: p.cliente, clienteTel: p.clienteTel };
          sim.criadoEm = p.criadoEm; // preserva a data original da proposta ao re-salvar
          sim.negSalvo = p.neg > 0 ? p.neg : 0; // reabre com o valor exato que a proposta guardou
          if (p.corretor) sim.corretorKey = (p.corretorUsuario || '') + '|' + p.corretor; // reabre já no corretor da proposta
        }
      }
    }
    const inp = sim.inp;
    // valor: em proposta reaberta usa o valor salvo (fiel ao que o cliente recebeu); senão, o da Tabela
    const neg = sim.negSalvo || valorNegociadoTabela(u, cfg);
    const plano = PLANO.calc({
      neg, forma: inp.forma,
      entradaPct: inp.entradaPct / 100, finalPct: inp.finalPct / 100,
      nParcelas: inp.nParcelas, balQtde: inp.balQtde, balValor: inp.balValor,
      balPrimeiro: inp.balPrimeiro, balIntervalo: inp.balIntervalo,
      chavesMes: inp.chavesMes, correcaoMensal: cfg.correcaoMensal || 0,
      correcaoDesde: cfg.correcaoDesde || 1,
      dataProposta: new Date(inp.dataProposta + 'T12:00:00'), diaVenc: inp.diaVenc,
    });
    const user = STORE.getUser();
    // AUTORIA DA PROPOSTA — o admin escolhe em nome de qual corretor a proposta sai (padrão: ele mesmo).
    // Propostas NOVAS gravam o corretor escolhido; propostas já existentes mantêm o autor original (regra do servidor).
    const rosterCorr = corretoresParaProposta();
    if (!sim.corretorKey) sim.corretorKey = _simCorretorKey || ((user.usuario || '') + '|' + (user.nome || ''));
    const resolveCorr = () => {
      const achou = corretoresParaProposta().find((r) => (r.usuario + '|' + r.nome) === sim.corretorKey);
      if (achou) return achou;
      const p = sim.propostaId ? STORE.getPropostas().find((x) => x.id === sim.propostaId) : null;
      if (p && p.corretor) return { nome: p.corretor, usuario: p.corretorUsuario || '', empresa: p.corretorEmpresa || '', telefone: p.corretorTel || '', papel: p.corretorPapel || 'corretor' };
      return { nome: user.nome, usuario: user.usuario, empresa: user.empresa || '', telefone: user.telefone || '', papel: user.papel };
    };
    // se o corretor da proposta reaberta não está na lista (ex.: renomeado), inclui como 1ª opção p/ não sumir
    if (!rosterCorr.some((r) => (r.usuario + '|' + r.nome) === sim.corretorKey)) rosterCorr.unshift(resolveCorr());
    const corretagem = neg * (cfg.corretagem || 0);
    // líquido bate com o que aparece na tela: Total nominal (= valor negociado) − corretagem
    const liquido = plano.totalNominal - (cfg.quemPaga === 'Construtora' ? corretagem : 0);
    const perso = inp.forma === 'perso';

    app().innerHTML = `
      <div class="sim">
        <a class="volta" href="#/home">← espelho</a>
        <div class="sim-grid">
          <div class="painel">
            <div class="sim-foto${fotoDe(u, cfg) ? ' zoomavel' : ''}" data-fotoid="${fotoDe(u, cfg)}">${fotoDe(u, cfg) ? '<span class="foto-zoom">🔍</span>' : ''}</div>
            ${STORE.isAdmin() ? `<div class="foto-acao">
              <input type="file" id="s-foto" accept="image/jpeg,image/png,image/*" style="display:none">
              <button class="btn-mini" id="s-fotobtn">📷 Foto do tipo ${tipoDe(u)}${tipoDe(u) === 'LOJA' ? '' : ' — vale para todas as unidades final ' + tipoDe(u)}</button>
              <button class="btn-mini" id="s-girar" title="girar 90°">↻ girar imagem</button>
            </div>` : ''}
            <h2>Unidade ${esc(u.unidade)} ${u.status !== 'Disponível' ? `<span class="badge ${u.status === 'Vendido' ? 'b-red' : 'b-warn'}">${u.status}</span>` : ''}</h2>
            <div class="linhas">
              <div><span>Andar</span><b>${u.andar === 0 ? 'Térreo' : u.andar + 'º'}</b></div>
              <div><span>Área</span><b>${u.area ? u.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m²' : '—'}</b></div>
              <div><span>Valor de tabela</span><b>${fmt(valorTabela(u, cfg))}</b></div>
              ${u.desconto ? `<div><span>Desconto da unidade</span><b>${pct(u.desconto)}</b></div>` : ''}
              <div class="destaque"><span>VALOR NEGOCIADO</span><b>${fmt(neg)}</b></div>
            </div>

            <h3>Negociação</h3>
            <div class="form">
              <label>Cliente<input id="s-cliente" value="${esc(inp.cliente)}" placeholder="nome do cliente"></label>
              <label>Telefone do cliente<input id="s-clientetel" type="tel" inputmode="tel" value="${esc(inp.clienteTel)}" placeholder="(34) 9 9999-9999"></label>
              <label>Corretor <span class="nota" style="font-weight:400">— em nome de quem sai a proposta</span>
                <select id="s-corretor">${rosterCorr.map((r) => { const k = r.usuario + '|' + r.nome; return `<option value="${esc(k)}" ${k === sim.corretorKey ? 'selected' : ''}>${esc(corrLabel(r))}</option>`; }).join('')}</select></label>
              <label>Data da proposta<input id="s-data" type="date" value="${inp.dataProposta}"></label>
              <label>Dia de vencimento<input id="s-dia" type="number" min="1" max="28" value="${inp.diaVenc}"></label>
            </div>

            <h3>Pagamento</h3>
            <div class="form">
              <label>Forma<select id="s-forma">${PLANO.FORMAS.map((f) => `<option value="${f.id}" ${inp.forma === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label>
              ${perso ? `
              <label>Entrada (%)<input id="s-entpct" type="number" step="0.5" value="${inp.entradaPct}"><span class="hint">${fmt(plano.ent)}</span></label>
              <label>Parcela final — chaves (%)<input id="s-finpct" type="number" step="0.5" value="${inp.finalPct}"><span class="hint">${fmt(plano.fin)}</span></label>
              <label>Parcelas mensais (nº)<input id="s-nparc" type="number" value="${inp.nParcelas}"><span class="hint">${fmt(plano.vParc, 2)}/mês</span></label>
              <label>Balões (qtde)<input id="s-balq" type="number" value="${inp.balQtde}"></label>
              <label>Valor do balão<input id="s-balv" type="number" value="${inp.balValor}"></label>
              <label>1º balão no mês<input id="s-balp" type="number" value="${inp.balPrimeiro}"></label>
              <label>Repete a cada (meses)<input id="s-bali" type="number" value="${inp.balIntervalo}"></label>
              <label>Entrega (chaves) — mês<input id="s-chaves" type="number" value="${inp.chavesMes}"></label>` : ''}
              <label>Índice de correção<select id="s-indice">${['INCC', 'IPCA'].map((x) => `<option ${inp.indice === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
            </div>
            ${plano.parcelaNegativa ? '<div class="aviso">⚠ Entrada + parcela final + balões passam de 100% — a parcela mensal ficou negativa.</div>' : ''}
            ${!plano.fecha && !plano.parcelaNegativa ? '<div class="aviso">⚠ O plano não fecha com o valor negociado — confira parcelas e balões.</div>' : ''}
            ${u.status === 'Vendido' ? '<div class="aviso">⚠ Esta unidade está VENDIDA.</div>' : ''}
          </div>

          <div class="painel">
            <h3>Resumo</h3>
            <div class="linhas">
              <div><span>Entrada${perso ? ' (' + pctStr(inp.entradaPct) + ')' : ''} · ${fmtData(plano.cronograma[0] && plano.cronograma[0].data)}</span><b>${fmt(plano.ent)}</b></div>
              ${plano.nParc ? `<div><span>Parcelas mensais (${plano.nParc}x)</span><b>${fmt(plano.vParc, 2)}</b></div>` : ''}
              ${plano.balQtde ? `<div><span>Balões (${plano.balQtde}x)</span><b>${fmt(plano.balValor)}</b></div>` : ''}
              ${plano.fin ? `<div><span>Parcela final${perso ? ' (' + pctStr(inp.finalPct) + ')' : ''} · mês ${plano.chavesMes}</span><b>${fmt(plano.fin)}</b></div>` : ''}
              <div><span>Total nominal</span><b>${fmt(plano.totalNominal)}</b></div>
              ${STORE.isAdmin() ? `
              <div><span>(−) Corretagem ${pct(cfg.corretagem || 0)} (${esc(cfg.quemPaga || '')})</span><b class="neg">${fmt(corretagem)}</b></div>
              <div class="destaque"><span>LÍQUIDO DA VENDA</span><b>${fmt(liquido)}</b></div>` : ''}
            </div>
            <div class="acoes">
              <button class="btn" id="s-salvar">💾 Salvar proposta</button>
              <button class="btn" id="s-pdf">📄 PDF</button>
            </div>
            <h3>Cronograma</h3>
            <div class="tabela-wrap"><table class="tabela">
              <thead><tr><th>Mês</th><th>Vencimento</th><th>Descrição</th><th>Valor</th></tr></thead>
              <tbody>${plano.cronograma.filter((l) => l.total > 0).map((l) => {
                const de = [];
                if (l.entrada) de.push(perso ? 'Entrada (' + pctStr(inp.entradaPct) + ')' : 'Entrada / sinal');
                if (l.parcela) de.push('Parcela mensal');
                if (l.balao) de.push('Balão');
                if (l.chaves) de.push('Parcela final' + (perso ? ' (' + pctStr(inp.finalPct) + ')' : ''));
                return `<tr><td>${l.m}</td><td>${fmtData(l.data)}</td><td>${de.join(' + ')}</td><td>${fmt(l.total, 2)}</td></tr>`;
              }).join('')}</tbody>
              <tfoot><tr><td colspan="3">TOTAL</td><td>${fmt(plano.totalNominal)}</td></tr></tfoot>
            </table></div>
          </div>
        </div>
      </div>`;
    ativarFotos();
    { const fz = fotoDe(u, cfg); const sf = $('.sim-foto'); if (fz && sf) { sf.style.cursor = 'zoom-in'; sf.onclick = () => abrirVisor([fz], 0); } }

    const fbtn = $('#s-fotobtn');
    if (fbtn) {
      fbtn.onclick = () => $('#s-foto').click();
      $('#s-foto').onchange = async (e) => {
        const tipoAntes = tipoDe(u); // revalida contexto pós-await (blueprint)
        const file = e.target.files[0]; if (!file) return;
        toast('Enviando foto…');
        await STORE.anexarFotoTipo(tipoAntes, file);
        toast('Foto do tipo ' + tipoAntes + ' salva ✓ (vale para todas)');
        vSim(unidadeId, propostaId);
      };
      $('#s-girar').onclick = async () => {
        const tipoAntes = tipoDe(u);
        toast('Girando imagem…');
        const ok = await STORE.girarFotoTipo(tipoAntes);
        toast(ok ? 'Imagem girada ✓' : 'Sem imagem para girar', !ok);
        vSim(unidadeId, propostaId);
      };
    }

    const liga = (id, campo, num) => { const el = $(id); if (!el) return; el.onchange = () => { sim.inp[campo] = num ? parseFloat(el.value) || 0 : el.value; vSim(unidadeId, propostaId); }; };
    { const sc = $('#s-corretor'); if (sc) sc.onchange = (e) => { sim.corretorKey = e.target.value; _simCorretorKey = e.target.value; }; } // troca o autor (e lembra p/ as próximas)
    liga('#s-cliente', 'cliente'); liga('#s-clientetel', 'clienteTel');
    liga('#s-data', 'dataProposta'); liga('#s-dia', 'diaVenc', 1);
    liga('#s-forma', 'forma'); liga('#s-indice', 'indice');
    liga('#s-entpct', 'entradaPct', 1); liga('#s-finpct', 'finalPct', 1); liga('#s-nparc', 'nParcelas', 1);
    liga('#s-balq', 'balQtde', 1); liga('#s-balv', 'balValor', 1); liga('#s-balp', 'balPrimeiro', 1);
    liga('#s-bali', 'balIntervalo', 1); liga('#s-chaves', 'chavesMes', 1);

    const montaProposta = () => {
      const c = resolveCorr(); // corretor escolhido no seletor (resolvido na hora de salvar/gerar)
      return {
        id: sim.propostaId || ('p-' + Date.now() + '-' + u.unidade),
        unidadeId: u.id, unidade: u.unidade, area: u.area,
        cliente: inp.cliente.trim(), clienteTel: inp.clienteTel.trim(),
        corretor: c.nome, corretorUsuario: c.usuario, corretorTel: c.telefone || '', corretorPapel: c.papel, corretorEmpresa: c.empresa || '',
        neg, forma: inp.forma, formaLabel: plano.formaLabel,
        inp: { ...inp }, criadoEm: sim.criadoEm || new Date().toISOString(),
      };
    };
    const valida = () => {
      if (!inp.cliente.trim()) { toast('Preencha o nome do cliente.', true); return false; }
      if (u.status === 'Vendido' && !STORE.isAdmin()) { toast('Unidade vendida — fale com o administrador.', true); return false; }
      if (plano.parcelaNegativa) { toast('Ajuste o plano: entrada + parcela final + balões passam de 100%.', true); return false; }
      if (!plano.fecha) { toast('O plano não fecha com o valor negociado — confira parcelas e balões.', true); return false; }
      return true;
    };
    $('#s-salvar').onclick = () => {
      if (!valida()) return;
      const p = montaProposta();
      STORE.salvarProposta(p);
      sim.propostaId = p.id;
      toast('Proposta salva ✓');
    };
    $('#s-pdf').onclick = async () => {
      if (!valida()) return;
      const { doc, nome } = await gerarPDF(montaProposta(), plano, cfg);
      doc.save(nome);
    };
    // (botão WhatsApp removido — voltará quando integrar a API oficial do WhatsApp)
  }

  // ---------- PDF ----------
  const _imgCache = {};
  async function imgData(url) {
    if (url in _imgCache) return _imgCache[url];
    try {
      const blob = await (await fetch(url)).blob();
      _imgCache[url] = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    } catch (e) { _imgCache[url] = null; }
    return _imgCache[url];
  }
  // logo da imobiliária p/ o rodapé do PDF (co-marca). null se a empresa não tem logo (ou é o admin/Domo).
  async function carregarLogoImob(corretorUsuario) {
    // Com corretorUsuario (proposta reaberta do Histórico), usa a logo da
    // empresa DONA da proposta — senão o admin regenerava o PDF sem marca.
    let logoId = null;
    if (corretorUsuario) {
      const dono = (STORE.getUsuarios() || []).find((x) => x.usuario === corretorUsuario);
      if (dono && dono.logoId) logoId = dono.logoId;
    }
    if (!logoId) {
      const s = STORE.getUser() || {};
      if (!s.logoId || s.papel === 'admin') return null;
      logoId = s.logoId;
    }
    const f = await STORE.obterFoto(logoId);
    if (!f) return null;
    const dataUrl = `data:${f.mime};base64,${f.base64}`;
    const dim = await new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.width, h: i.height }); i.onerror = () => res(null); i.src = dataUrl; });
    if (!dim || !dim.w || !dim.h) return null;
    return { dataUrl, fmt: f.mime.includes('png') ? 'PNG' : 'JPEG', w: dim.w, h: dim.h };
  }
  // desenha "apresentado por [logo]" centralizado, com a base em baseY
  function desenhaLogoRodape(doc, logo, CX, baseY) {
    if (!logo) return;
    const lh = 20, lw = Math.min(150, lh * (logo.w / logo.h));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(150, 150, 154);
    doc.text('apresentado por', CX, baseY - lh - 3, { align: 'center' });
    doc.addImage(logo.dataUrl, logo.fmt, CX - lw / 2, baseY - lh, lw, lh);
  }
  async function gerarPDF(p, plano, cfg) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = 595, H = 842, M = 40;
    const perso = plano.forma === 'perso';
    const LIME = [228, 247, 43];
    const [logoD, logoM, logoImob] = await Promise.all([imgData('pdf-diamond.jpg'), imgData('pdf-domo.jpg'), carregarLogoImob(p.corretorUsuario)]);
    const BAND = 74, CTOP = 90, CX = W / 2;
    const cab = (pag) => {
      doc.setFillColor(0, 0, 0); doc.rect(0, 0, W, BAND, 'F');
      if (logoD) { const h = 20, w = h * 640 / 86; doc.addImage(logoD, 'JPEG', M, (BAND - h) / 2, w, h); }        // Diamond amarela (esq.)
      if (logoM) { const h = 26, w = h * 520 / 167; doc.addImage(logoM, 'JPEG', W - M - w, (BAND - h) / 2, w, h); } // Domo branca (dir.)
      doc.setTextColor(LIME[0], LIME[1], LIME[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('PLANO DE PAGAMENTO', CX, 34, { align: 'center' });
      doc.setTextColor(190, 190, 190); doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5);
      doc.text(`Edifício Diamond · Domo Construtora · tabela ${cfg.dataTabela || ''} · ${cfg.versao || ''}${pag > 1 ? ' · pág. ' + pag : ''}`, CX, 48, { align: 'center' });
    };
    cab(1);
    let y = CTOP;

    // logomarca da imobiliária cadastrada — centralizada, abaixo da barra (só pág. 1)
    if (logoImob) {
      const lh = 34, lw = Math.min(220, lh * (logoImob.w / logoImob.h));
      doc.addImage(logoImob.dataUrl, logoImob.fmt, CX - lw / 2, y - 6, lw, lh);
      y += 40;
    }

    // ---- ficha compacta com linhas zebradas (rótulo + valor na mesma linha, 2 colunas)
    const propData = plano.cronograma[0] && plano.cronograma[0].data ? new Date(plano.cronograma[0].data) : new Date();
    const validade = new Date(propData.getTime()); validade.setDate(validade.getDate() + 7);
    const area = p.area ? ' · ' + p.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m²' : '';
    const fichas = [
      [['Cliente', p.cliente || '—'], ['Telefone', p.clienteTel || '—']],
      [['Corretor', p.corretor || '—'], ['Telefone', p.corretorTel || '—']],
      [['Unidade', p.unidade + area], ['Forma', plano.formaLabel]],
      [['Valor negociado', fmt(plano.neg)], ['Proposta em', fmtData(propData)]],
      [['Vencimentos', 'todo dia ' + (p.inp.diaVenc || 10)], ['Correção', (p.inp && p.inp.indice) || 'INCC']],
    ];
    const RH = 20, COLW = (W - 2 * M) / 2, colX = [M, M + COLW];
    fichas.forEach((row, i) => {
      if (i % 2 === 0) { doc.setFillColor(244, 244, 246); doc.rect(M, y, W - 2 * M, RH, 'F'); }
      row.forEach((f, c) => {
        const x = colX[c] + 8;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(122, 122, 128);
        const lab = String(f[0]) + ':';
        doc.text(lab, x, y + 13);
        const lw = doc.getTextWidth(lab);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(26, 26, 26);
        doc.text(String(f[1] || '—'), x + lw + 5, y + 13, { maxWidth: COLW - lw - 24 });
      });
      y += RH;
    });

    // ---- faixa de validade (7 dias)
    y += 6;
    doc.setFillColor(245, 249, 218); doc.rect(M, y, W - 2 * M, 18, 'F');
    doc.setFillColor(LIME[0], LIME[1], LIME[2]); doc.rect(M, y, 3, 18, 'F'); // filete lima à esquerda
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(60, 66, 0);
    doc.text(`PROPOSTA VÁLIDA POR 7 DIAS — até ${fmtData(validade)}`, M + 12, y + 12);
    y += 28;

    const linhas = plano.cronograma.filter((l) => l.total > 0);
    const col = [M, M + 40, M + 120, W - M];
    const cabecalhoTab = () => {
      doc.setFillColor(26, 26, 26); doc.rect(M, y, W - 2 * M, 20, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text('Mês', col[0] + 6, y + 14); doc.text('Vencimento', col[1] + 6, y + 14);
      doc.text('Descrição', col[2] + 6, y + 14); doc.text('Valor', col[3] - 6, y + 14, { align: 'right' });
      y += 20;
    };
    cabecalhoTab();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    let pag = 1, nBal = 0;
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      if (y > H - 62) { doc.addPage(); pag++; cab(pag); y = CTOP; cabecalhoTab(); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); }
      if (i % 2) { doc.setFillColor(247, 247, 247); doc.rect(M, y, W - 2 * M, 16, 'F'); }
      const de = [];
      if (l.entrada) de.push(perso ? `Entrada (${pctStr(p.inp.entradaPct)})` : 'Entrada / sinal');
      if (l.parcela) de.push(`Parcela ${l.m}/${plano.nParc}`);
      if (l.balao) { nBal++; de.push(plano.balQtde > 1 ? `Balão ${nBal} de ${plano.balQtde}` : 'Balão'); }
      if (l.chaves) de.push(perso ? `Parcela final (${pctStr(p.inp.finalPct)})` : 'Parcela final');
      doc.setTextColor(26, 26, 26);
      doc.text(String(l.m), col[0] + 6, y + 12);
      doc.text(fmtData(l.data), col[1] + 6, y + 12);
      doc.text(de.join(' + '), col[2] + 6, y + 12);
      doc.text(fmt(l.total, 2), col[3] - 6, y + 12, { align: 'right' });
      y += 16;
    }
    doc.setFillColor(LIME[0], LIME[1], LIME[2]); doc.rect(M, y, W - 2 * M, 20, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 26, 26);
    doc.text('TOTAL', col[0] + 6, y + 14);
    doc.text(fmt(plano.totalNominal, 2), col[3] - 6, y + 14, { align: 'right' });
    y += 34;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(115, 115, 115);
    doc.text(`Valores nominais na data da proposta. Parcelas e balões corrigidos por ${(p.inp && p.inp.indice) || 'INCC'} conforme contrato.`, M, y);
    doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} por ${p.corretor}${p.corretorTel ? ' · ' + p.corretorTel : ''}.`, M, y + 12);
    y += 30;

    try {
      const un = STORE.unidadePorId(p.unidadeId);
      const foto = un ? await STORE.obterFoto(fotoDe(un, cfg)) : null;
      if (foto) {
        const durl = `data:${foto.mime};base64,${foto.base64}`;
        const dim = await new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.width, h: i.height }); i.onerror = () => res(null); i.src = durl; });
        if (dim) {
          const maxW = W - 2 * M, maxH = 320;
          const escl = Math.min(maxW / dim.w, maxH / dim.h);
          const dw = dim.w * escl, dh = dim.h * escl;
          if (y + dh + 26 > H - 30) { doc.addPage(); pag++; cab(pag); y = CTOP; }
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(26, 26, 26);
          doc.text(`Unidade ${p.unidade} · planta ilustrada`, M, y);
          y += 8;
          doc.addImage(durl, foto.mime.includes('png') ? 'PNG' : 'JPEG', M + (maxW - dw) / 2, y, dw, dh);
          y += dh;
        }
      }
    } catch (e) { /* sem imagem, segue sem ela */ }

    // (a logomarca da imobiliária agora sai centralizada abaixo da barra do
    // topo, na 1ª página — não mais no fim do documento)

    const nome = `Proposta-Diamond-${p.unidade}-${(p.cliente || 'cliente').replace(/\s+/g, '_')}.pdf`;
    return { doc, nome };
  }

  // ---------- banda preta compartilhada (logos + título centralizado) ----------
  async function carregarLogos() {
    const [dd, mm] = await Promise.all([imgData('pdf-diamond.jpg'), imgData('pdf-domo.jpg')]);
    return { d: dd, m: mm };
  }
  function drawBanda(doc, cfg, titulo, pag, logos) {
    const W = 595, M = 40, CX = W / 2, BAND = 74, LIME = [228, 247, 43];
    doc.setFillColor(0, 0, 0); doc.rect(0, 0, W, BAND, 'F');
    if (logos.d) { const h = 20, w = h * 640 / 86; doc.addImage(logos.d, 'JPEG', M, (BAND - h) / 2, w, h); }
    if (logos.m) { const h = 26, w = h * 520 / 167; doc.addImage(logos.m, 'JPEG', W - M - w, (BAND - h) / 2, w, h); }
    doc.setTextColor(LIME[0], LIME[1], LIME[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(titulo, CX, 34, { align: 'center' });
    doc.setTextColor(190, 190, 190); doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5);
    doc.text(`Edifício Diamond · Domo Construtora · tabela ${cfg.dataTabela || ''} · ${cfg.versao || ''}${pag > 1 ? ' · pág. ' + pag : ''}`, CX, 48, { align: 'center' });
  }

  // ---------- proposta simples (só o valor da unidade — usada pelo corretor) ----------
  async function gerarPropostaSimples(u, cfg, cliente, clienteTel, user) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = 595, H = 842, M = 40, CX = W / 2, LIME = [228, 247, 43];
    const logos = await carregarLogos();
    const logoImob = await carregarLogoImob();
    drawBanda(doc, cfg, 'PROPOSTA', 1, logos);
    let y = 92;
    // logomarca da imobiliária — centralizada abaixo da banda (igual ao plano)
    if (logoImob) {
      const lh = 34, lw = Math.min(220, lh * (logoImob.w / logoImob.h));
      doc.addImage(logoImob.dataUrl, logoImob.fmt, CX - lw / 2, y - 6, lw, lh);
      y += 40;
    }
    const vt = valorNegociadoTabela(u, cfg); // preço EFETIVO (aplica desconto da unidade)
    const temDesc = (u.desconto || 0) > 0;
    const areaS = u.area ? u.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m²' : '—';
    const prop = new Date();
    const validade = new Date(prop.getTime()); validade.setDate(validade.getDate() + 7);
    const fichas = [
      [['Cliente', cliente || '—'], ['Telefone', clienteTel || '—']],
      [['Corretor', (user && user.nome) || '—'], ['Telefone', (user && user.telefone) || '—']],
      [['Unidade', String(u.unidade)], ['Andar', u.andar === 0 ? 'Térreo' : u.andar + 'º']],
      [['Área', areaS], ['Proposta em', fmtData(prop)]],
      ...(temDesc ? [[['Valor de tabela', fmt(valorTabela(u, cfg))], ['Desconto', '− ' + pct(u.desconto)]]] : []),
    ];
    const RH = 20, COLW = (W - 2 * M) / 2, colX = [M, M + COLW];
    fichas.forEach((row, i) => {
      if (i % 2 === 0) { doc.setFillColor(244, 244, 246); doc.rect(M, y, W - 2 * M, RH, 'F'); }
      row.forEach((f, c) => {
        const x = colX[c] + 8;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(122, 122, 128);
        const lab = String(f[0]) + ':'; doc.text(lab, x, y + 13);
        const lw = doc.getTextWidth(lab);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(26, 26, 26);
        doc.text(String(f[1] || '—'), x + lw + 5, y + 13, { maxWidth: COLW - lw - 24 });
      });
      y += RH;
    });
    y += 14;
    // caixa de valor em destaque
    doc.setFillColor(245, 249, 218); doc.rect(M, y, W - 2 * M, 52, 'F');
    doc.setFillColor(LIME[0], LIME[1], LIME[2]); doc.rect(M, y, 4, 52, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 96, 20);
    doc.text('VALOR DA UNIDADE', M + 18, y + 19);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(23); doc.setTextColor(26, 26, 26);
    doc.text(u.precoBase ? fmt(vt) : 'Sob consulta', M + 18, y + 43);
    y += 52 + 10;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(115, 115, 115);
    doc.text(`Proposta válida por 7 dias — até ${fmtData(validade)}.`, M, y); y += 18;
    // planta ilustrada
    try {
      const foto = await STORE.obterFoto(fotoDe(u, cfg));
      if (foto) {
        const durl = `data:${foto.mime};base64,${foto.base64}`;
        const dim = await new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.width, h: i.height }); i.onerror = () => res(null); i.src = durl; });
        if (dim) {
          const maxW = W - 2 * M, maxH = H - y - 82; // reserva o rodapé p/ a logo da imobiliária + texto
          const escl = Math.min(maxW / dim.w, maxH / dim.h);
          const dw = dim.w * escl, dh = dim.h * escl;
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(26, 26, 26);
          doc.text(`Unidade ${u.unidade} · planta ilustrada`, M, y); y += 8;
          doc.addImage(durl, foto.mime.includes('png') ? 'PNG' : 'JPEG', M + (maxW - dw) / 2, y, dw, dh); y += dh;
        }
      }
    } catch (e) { /* sem imagem */ }
    // (logo da imobiliária agora sai grande, centralizada abaixo da banda)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(174, 174, 178);
    // o corretor é da IMOBILIÁRIA dele — o prédio é que é da Domo (o cabeçalho já diz isso)
    doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')}${user && user.nome ? ' · ' + user.nome : ''}${user && user.empresa ? ' · ' + user.empresa : ''}`, CX, H - 30, { align: 'center' });
    const nome = `Proposta-Diamond-${u.unidade}-${(cliente || 'cliente').replace(/\s+/g, '_')}.pdf`;
    return { doc, nome };
  }

  // ---------- PDF da SCP (co-marca Diamond/Domo) ----------
  async function gerarPdfScp(u, base, opts, cfg, user, cliente, tel) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = 595, H = 842, M = 40, CX = W / 2, LIME = [228, 247, 43];
    const logos = await carregarLogos();
    const logoImob = await carregarLogoImob();
    drawBanda(doc, cfg, 'PROPOSTA SCP', 1, logos);
    let y = 92;
    if (logoImob) {
      const lh = 34, lw = Math.min(220, lh * (logoImob.w / logoImob.h));
      doc.addImage(logoImob.dataUrl, logoImob.fmt, CX - lw / 2, y - 6, lw, lh);
      y += 40;
    }
    const s = scpCalcular(base, opts, cfg);
    const areaS = u.area ? u.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m²' : '—';
    const fichas = [
      [['Cliente', cliente || '—'], ['Telefone', tel || '—']],
      [['Corretor', (user && user.nome) || '—'], ['Telefone', (user && user.telefone) || '—']],
      [['Unidade', String(u.unidade)], ['Andar', u.andar === 0 ? 'Térreo' : u.andar + 'º']],
      [['Área', areaS], ['Proposta em', fmtData(new Date())]],
    ];
    const RH = 20, COLW = (W - 2 * M) / 2, colX = [M, M + COLW];
    fichas.forEach((row, i) => {
      if (i % 2 === 0) { doc.setFillColor(244, 244, 246); doc.rect(M, y, W - 2 * M, RH, 'F'); }
      row.forEach((f, c) => {
        const x = colX[c] + 8;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(122, 122, 128);
        const lab = String(f[0]) + ':'; doc.text(lab, x, y + 13); const lw = doc.getTextWidth(lab);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(26, 26, 26);
        doc.text(String(f[1] || '—'), x + lw + 5, y + 13, { maxWidth: COLW - lw - 24 });
      });
      y += RH;
    });
    y += 14;
    // VALOR em destaque — com desconto mostra o valor NEGOCIADO (grande) e o de tabela riscado ao lado
    doc.setFillColor(245, 249, 218); doc.rect(M, y, W - 2 * M, 52, 'F');
    doc.setFillColor(LIME[0], LIME[1], LIME[2]); doc.rect(M, y, 4, 52, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 96, 20);
    doc.text(opts.desc10 ? 'VALOR (10% DE DESCONTO)' : 'VALOR DE TABELA', M + 18, y + 19);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(23); doc.setTextColor(26, 26, 26);
    doc.text(fmt(opts.desc10 ? s.valor : s.base), M + 18, y + 43);
    if (opts.desc10) { // valor de tabela "de R$ X" riscado, no canto direito
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(120, 120, 120);
      const deTxt = 'de ' + fmt(s.base); const tw = doc.getTextWidth(deTxt); const rx = W - M - 18;
      doc.text(deTxt, rx, y + 32, { align: 'right' });
      doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.8); doc.line(rx - tw, y + 29, rx, y + 29);
    }
    y += 52 + 18;
    // condições SCP
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(26, 26, 26);
    doc.text('Condições SCP', M, y); y += 7;
    doc.setDrawColor(LIME[0], LIME[1], LIME[2]); doc.setLineWidth(1.5); doc.line(M, y, W - M, y); y += 18;
    const linhaC = (lab, val, forte) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90, 90, 90); doc.text(lab, M, y);
      doc.setFont('helvetica', forte ? 'bold' : 'normal'); doc.setTextColor(26, 26, 26); doc.text(val, W - M, y, { align: 'right' }); y += 21;
    };
    const idx = cfg.indice || 'INCC';
    if (opts.desc10) { linhaC('Desconto 10% (sobre o valor de tabela)', '- ' + fmt(s.desc)); linhaC('Valor negociado', fmt(s.valor), true); }
    if (opts.p12) linhaC('12x sem juros', fmt(s.p12, 2) + '/mês', true);
    if (opts.p2412) { linhaC('12 + 12 · parcelas 1ª a 12ª (fixas)', fmt(s.pNom, 2) + '/mês', true); linhaC('12 + 12 · parcelas 13ª a 24ª (' + idx + ')', fmt(s.p13, 2) + ' a ' + fmt(s.p24, 2) + '/mês', true); }
    if (s.corrPct > 0) { linhaC('Corretagem ' + String(s.corrPct).replace('.', ',') + '%', '- ' + fmt(s.corrValor)); linhaC('Valor líquido (Domo recebe)', fmt(s.liquido), true); }
    y += 6;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(115, 115, 115);
    const notas = [];
    if (opts.p2412) notas.push('As 12 últimas parcelas são corrigidas por ' + idx + ' (estimativa pela taxa mensal vigente).');
    if (s.corrPct > 0) notas.push('A corretagem é deduzida do valor que a Domo recebe.');
    notas.push('SCP — Sociedade em Conta de Participação. Valores nominais, sujeitos a análise e formalização em contrato.');
    const wrap = doc.splitTextToSize(notas.join(' '), W - 2 * M);
    doc.text(wrap, M, y); y += wrap.length * 11 + 10;
    // planta ilustrada (se couber)
    try {
      const foto = await STORE.obterFoto(fotoDe(u, cfg));
      if (foto) {
        const durl = `data:${foto.mime};base64,${foto.base64}`;
        const dim = await new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.width, h: i.height }); i.onerror = () => res(null); i.src = durl; });
        if (dim) {
          const maxW = W - 2 * M, maxH = H - y - 82;
          if (maxH > 60) { const escl = Math.min(maxW / dim.w, maxH / dim.h); const dw = dim.w * escl, dh = dim.h * escl;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(26, 26, 26); doc.text(`Unidade ${u.unidade} · planta ilustrada`, M, y); y += 8;
            doc.addImage(durl, foto.mime.includes('png') ? 'PNG' : 'JPEG', M + (maxW - dw) / 2, y, dw, dh); }
        }
      }
    } catch (e) { /* sem planta */ }
    // (logo da imobiliária agora sai grande, centralizada abaixo da banda)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(174, 174, 178);
    doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')}${user && user.nome ? ' · ' + user.nome : ''} · Domo Construtora`, CX, H - 30, { align: 'center' });
    return { doc, nome: `SCP-Diamond-${u.unidade}-${(cliente || 'cliente').replace(/\s+/g, '_')}.pdf` };
  }

  // ---------- tabela em GRADE por andar (estilo espelho) — A4 inteiro, uma página ----------
  async function gerarTabelaPDF(cfg, unidades) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = 595, H = 842, M = 22;
    const logos = await carregarLogos();
    drawBanda(doc, cfg, 'ESPELHO DE VENDAS', 1, logos);

    const disp = unidades.filter((u) => u.status === 'Disponível');
    const res = unidades.filter((u) => u.status === 'Reservado');
    const vend = unidades.filter((u) => u.status === 'Vendido');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 65);
    doc.text(`Total ${unidades.length}`, M, 92);
    const leg = [['Disponível', disp.length, [46, 125, 50]], ['Reservado', res.length, [94, 53, 177]], ['Vendido', vend.length, [198, 40, 40]]];
    let lx = M + 70;
    leg.forEach(([nome, n, c]) => {
      doc.setFillColor(c[0], c[1], c[2]); doc.circle(lx + 3, 89, 3.2, 'F');
      doc.setTextColor(60, 60, 65); doc.text(`${nome} ${n}`, lx + 10, 92);
      lx += doc.getTextWidth(`${nome} ${n}`) + 34;
    });

    // andares presentes (des.) + LOJA (térreo)
    const aptos = unidades.filter((u) => String(u.unidade).toUpperCase() !== 'LOJA');
    const loja = unidades.find((u) => String(u.unidade).toUpperCase() === 'LOJA');
    const andares = [...new Set(aptos.map((u) => u.andar))].sort((a, b) => b - a);
    const porAndar = {};
    aptos.forEach((u) => { const col = parseInt(String(u.unidade).slice(-2), 10) - 1; (porAndar[u.andar] = porAndar[u.andar] || {})[col] = u; });

    const top = 104, bottom = H - 22;
    const nRows = andares.length + (loja ? 1 : 0);
    const rh = Math.min(64, (bottom - top) / nRows);
    const labW = 34, gap = 3;
    const cellW = (W - 2 * M - labW - gap) / 8;
    const cor = {
      'Disponível': { bg: [233, 246, 234], bd: [165, 214, 167], tx: [46, 125, 50] },
      'Reservado': { bg: [237, 231, 246], bd: [179, 157, 219], tx: [94, 53, 177] },
      'Vendido': { bg: [255, 235, 238], bd: [239, 154, 154], tx: [198, 40, 40] },
    };
    const corDe = (s) => cor[s] || { bg: [245, 245, 245], bd: [220, 220, 220], tx: [110, 110, 110] };

    let y = top;
    andares.forEach((andar) => {
      // rótulo do andar (caixa preta)
      doc.setFillColor(17, 17, 17); doc.roundedRect(M, y, labW, rh - gap, 4, 4, 'F');
      doc.setTextColor(228, 247, 43); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(andar + 'º', M + labW / 2, y + (rh - gap) / 2 + 3, { align: 'center' });
      for (let c = 0; c < 8; c++) {
        const u = (porAndar[andar] || {})[c];
        const x = M + labW + gap + c * cellW;
        const cw = cellW - gap, ch = rh - gap;
        if (!u) { doc.setDrawColor(230, 230, 230); doc.setLineWidth(0.5); doc.roundedRect(x, y, cw, ch, 4, 4, 'S'); continue; }
        const k = corDe(u.status);
        doc.setFillColor(k.bg[0], k.bg[1], k.bg[2]); doc.setDrawColor(k.bd[0], k.bd[1], k.bd[2]); doc.setLineWidth(0.7);
        doc.roundedRect(x, y, cw, ch, 4, 4, 'FD');
        doc.setTextColor(k.tx[0], k.tx[1], k.tx[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
        doc.text(String(u.unidade), x + 6, y + 14);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.setTextColor(90, 90, 95);
        doc.text(u.area ? u.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m²' : '', x + 6, y + 24);
        if (u.status === 'Disponível' && u.precoBase) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(26, 26, 26);
          doc.text(fmt(valorNegociadoTabela(u, cfg)), x + 6, y + 36);
          if ((u.desconto || 0) > 0) { doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6); doc.setTextColor(198, 40, 40); doc.text('−' + pct(u.desconto) + ' desc.', x + 6, y + 44); }
        }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6); doc.setTextColor(k.tx[0], k.tx[1], k.tx[2]);
        doc.text(String(u.status).toUpperCase(), x + 6, y + ch - 5);
      }
      y += rh;
    });
    // Loja (linha inteira)
    if (loja) {
      doc.setFillColor(17, 17, 17); doc.roundedRect(M, y, labW, rh - gap, 4, 4, 'F');
      doc.setTextColor(228, 247, 43); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text('Loja', M + labW / 2, y + (rh - gap) / 2 + 3, { align: 'center' });
      const k = corDe(loja.status);
      const x = M + labW + gap, cw = W - M - x, ch = rh - gap;
      doc.setFillColor(k.bg[0], k.bg[1], k.bg[2]); doc.setDrawColor(k.bd[0], k.bd[1], k.bd[2]); doc.setLineWidth(0.7);
      doc.roundedRect(x, y, cw, ch, 4, 4, 'FD');
      doc.setTextColor(26, 26, 26); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text('Térreo · ' + (loja.area ? loja.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m²' : ''), x + 8, y + ch / 2 + 3);
      if (loja.precoBase && loja.status === 'Disponível') doc.text(fmt(valorNegociadoTabela(loja, cfg)) + ((loja.desconto || 0) > 0 ? '  (−' + pct(loja.desconto) + ')' : ''), x + cw / 2, y + ch / 2 + 3, { align: 'center' });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(k.tx[0], k.tx[1], k.tx[2]);
      doc.text(String(loja.status).toUpperCase(), x + cw - 8, y + ch / 2 + 3, { align: 'right' });
    }

    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(174, 174, 178);
    doc.text(`Tabela ${cfg.dataTabela || ''} · ${cfg.versao || ''} · gerada em ${new Date().toLocaleDateString('pt-BR')} · preços sujeitos a alteração · Domo Construtora`, W / 2, H - 12, { align: 'center' });
    return { doc, nome: `Espelho-Diamond-${(cfg.dataTabela || '').replace(/\//g, '-')}.pdf` };
  }

  function resumoTexto(plano, p) {
    const perso = plano.forma === 'perso';
    const li = [];
    li.push(`• Valor: ${fmt(plano.neg)}`);
    li.push(`• Entrada${perso ? ' (' + pctStr(p.inp.entradaPct) + ')' : ''}: ${fmt(plano.ent)} (${fmtData(plano.cronograma[0] && plano.cronograma[0].data)})`);
    if (plano.nParc) li.push(`• ${plano.nParc} parcelas de ${fmt(plano.vParc, 2)} (todo dia ${p.inp.diaVenc})`);
    if (plano.balQtde) li.push(`• ${plano.balQtde} balões de ${fmt(plano.balValor)} a cada ${plano.balIntervalo} meses`);
    if (plano.fin) li.push(`• Parcela final${perso ? ' (' + pctStr(p.inp.finalPct) + ')' : ''}: ${fmt(plano.fin)} na entrega (mês ${plano.chavesMes})`);
    const prop = plano.cronograma[0] && plano.cronograma[0].data ? new Date(plano.cronograma[0].data) : new Date();
    const val = new Date(prop.getTime()); val.setDate(val.getDate() + 7);
    li.push(`\n_Proposta válida por 7 dias — até ${fmtData(val)}._`);
    return li.join('\n');
  }
  // ---------- O PRÉDIO (empreendimento) ----------
  function vPredio() {
    document.body.classList.add('tema-predio');
    const cfg = STORE.getCfg() || {};
    const fotos = cfg.empFotos || [];
    const paras = esc(cfg.empTexto || 'Texto do empreendimento — edite no ADM › Prédio.')
      .split('\n').map((p) => p.trim()).filter(Boolean);
    // APARTAMENTOS (tipos + planta humanizada): lista própria, cada foto navegável entre as do grupo
    const aparts = cfg.apartamentos || [];
    const apartFotos = aparts.filter((a) => a.fotoId).map((a) => a.fotoId);
    const apartLabels = aparts.filter((a) => a.fotoId).map((a) => a.nome);
    let _ka = -1;
    const apartChips = aparts.map((a) => a.fotoId
      ? `<button class="amen amen-link-chip" data-set="apart" data-idx="${++_ka}">${esc(a.nome || '')} <span class="amen-ico">◉</span></button>`
      : `<span class="amen">${esc(a.nome || '')}</span>`).join('');
    // AMENIDADES: navegação limitada às fotos das próprias amenidades (não a galeria inteira)
    const amenList = cfg.empAmenidades || [];
    const amenComFoto = amenList.filter((a) => (cfg.amenFotos || {})[a]); // rótulos, na ordem
    const amenFotosArr = amenComFoto.map((a) => (cfg.amenFotos || {})[a]);
    let _km = -1;
    const amenChips = amenList.map((a) => (cfg.amenFotos || {})[a]
      ? `<button class="amen amen-link-chip" data-set="amen" data-idx="${++_km}">${esc(a)} <span class="amen-ico">◉</span></button>`
      : `<span class="amen">${esc(a)}</span>`).join('');
    app().innerHTML = `
      <div class="predio-dark">
        <a class="volta volta-dark" href="#/home">← voltar ao espelho</a>
        ${fotos.length ? `<div class="carrossel">
          <div class="car-viewport" id="car-vp">
            <div class="car-track" id="car-track">
              ${fotos.map((f, i) => `<div class="car-slide" data-fotoid="${f}" data-idx="${i}"></div>`).join('')}
            </div>
          </div>
          ${fotos.length > 1 ? `<button class="car-nav car-prev" id="car-prev" aria-label="anterior">‹</button>
          <button class="car-nav car-next" id="car-next" aria-label="próxima">›</button>
          <div class="car-cont" id="car-cont">1 / ${fotos.length}</div>
          <div class="car-dots" id="car-dots">${fotos.map((_, i) => `<span class="car-dot ${i === 0 ? 'on' : ''}" data-idx="${i}"></span>`).join('')}</div>` : ''}
        </div>` : ''}
        <div class="emp-content">
          <h1 class="emp-titulo">${esc(cfg.empTitulo || 'Edifício Diamond')}</h1>
          <div class="emp-texto">${paras.map((p, i) => `<p class="${i === 0 ? 'emp-lead' : ''}">${p}</p>`).join('')}</div>
          ${aparts.length ? `<h3 class="emp-h3">Apartamentos</h3>
          <div class="amenidades apartamentos-chips">${apartChips}</div>` : ''}
          ${amenList.length ? `<h3 class="emp-h3">Amenidades</h3>
          <div class="amenidades">${amenChips}</div>` : ''}
        </div>
      </div>`;
    ativarFotos();
    const n = fotos.length;
    if (n) {
      let idx = 0;
      const track = $('#car-track');
      const dots = $$('.car-dot');
      const cont = $('#car-cont');
      const go = (i) => {
        idx = (i + n) % n;
        if (track) track.style.transform = `translateX(-${idx * 100}%)`;
        dots.forEach((d, k) => d.classList.toggle('on', k === idx));
        if (cont) cont.textContent = (idx + 1) + ' / ' + n;
      };
      const prev = $('#car-prev'); if (prev) prev.onclick = () => go(idx - 1);
      const next = $('#car-next'); if (next) next.onclick = () => go(idx + 1);
      dots.forEach((d) => { d.onclick = () => go(+d.dataset.idx); });
      const vp = $('#car-vp');
      let x0 = null;
      vp.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
      vp.addEventListener('touchend', (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1));
        x0 = null;
      });
      $$('.car-slide').forEach((s) => { s.onclick = () => abrirVisor(fotos, +s.dataset.idx); });
      if (window._predioKey) document.removeEventListener('keydown', window._predioKey); // não acumular
      const onKey = (e) => {
        if (location.hash !== '#/predio') { document.removeEventListener('keydown', onKey); window._predioKey = null; return; }
        if (e.key === 'ArrowLeft') go(idx - 1);
        if (e.key === 'ArrowRight') go(idx + 1);
      };
      window._predioKey = onKey;
      document.addEventListener('keydown', onKey);
    }
    // chips de apartamento / amenidade → abrem a foto e navegam DENTRO do próprio grupo
    $$('.amen-link-chip').forEach((c) => {
      c.onclick = () => c.dataset.set === 'apart'
        ? abrirVisor(apartFotos, +c.dataset.idx, apartLabels)
        : abrirVisor(amenFotosArr, +c.dataset.idx, amenComFoto);
    });
  }

  function abrirVisor(fotos, start, labels) {
    const n = fotos.length;
    let i = start;
    const ov = document.createElement('div');
    ov.className = 'visor';
    ov.innerHTML = `
      <button class="visor-x">✕</button>
      ${n > 1 ? '<button class="visor-nav vn-prev">‹</button><button class="visor-nav vn-next">›</button>' : ''}
      <div class="visor-img"></div>
      <div class="visor-cont"></div>`;
    document.body.appendChild(ov);
    const img = ov.querySelector('.visor-img');
    const cont = ov.querySelector('.visor-cont');
    const mostra = async () => {
      const f = await STORE.obterFoto(fotos[i]);
      if (f) img.style.backgroundImage = `url(data:${f.mime};base64,${f.base64})`;
      const lab = labels && labels[i] ? labels[i] + '  ·  ' : '';
      cont.textContent = lab + (i + 1) + ' / ' + n;
    };
    const move = (d) => { i = (i + d + n) % n; mostra(); };
    const key = (e) => { if (e.key === 'Escape') fechar(); if (e.key === 'ArrowLeft') move(-1); if (e.key === 'ArrowRight') move(1); };
    const onHash = () => fechar(); // fecha o visor se o usuário navegar
    const fechar = () => { ov.remove(); document.removeEventListener('keydown', key); window.removeEventListener('hashchange', onHash); };
    window.addEventListener('hashchange', onHash);
    ov.querySelector('.visor-x').onclick = fechar;
    ov.onclick = (e) => { if (e.target === ov) fechar(); };
    const p = ov.querySelector('.vn-prev'); if (p) p.onclick = (e) => { e.stopPropagation(); move(-1); };
    const nx = ov.querySelector('.vn-next'); if (nx) nx.onclick = (e) => { e.stopPropagation(); move(1); };
    let x0 = null;
    ov.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    ov.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) move(dx < 0 ? 1 : -1); x0 = null; });
    document.addEventListener('keydown', key);
    mostra();
  }

  // ================= CRM / CLIENTES =================
  const CRM_TEMPS = [['quente', '🔥', 'Quente'], ['morno', '🌤', 'Morno'], ['frio', '❄️', 'Frio']];
  const CRM_ESTAGIOS = [['novo', 'Novo'], ['contato', 'Contato'], ['proposta', 'Proposta'], ['negociando', 'Negociando'], ['fechado', 'Fechado'], ['perdido', 'Perdido']];
  const tempIc = (t) => (CRM_TEMPS.find((x) => x[0] === t) || CRM_TEMPS[1])[1];
  const estLab = (e) => (CRM_ESTAGIOS.find((x) => x[0] === e) || ['', '—'])[1];
  const leadAtivo = (l) => l.estagio !== 'fechado' && l.estagio !== 'perdido';
  const leadVenc = (l) => leadAtivo(l) && l.proximoContato && l.proximoContato < hoje();
  const desdeTxt = (iso) => {
    if (!iso) return '';
    const d = Math.round((Date.parse(hoje()) - Date.parse(iso)) / 86400000);
    if (isNaN(d)) return '';
    if (d <= 0) return 'hoje'; if (d === 1) return 'ontem'; if (d < 30) return 'há ' + d + ' dias';
    return fmtData(iso);
  };
  const leadInteresse = (l) => !!(_sinais[l.id] && _sinais[l.id].interesse) && leadAtivo(l); // cliente levantou a mão
  function ordenaLeads(leads) {
    return leads.slice().sort((a, b) => {
      if (leadAtivo(a) !== leadAtivo(b)) return leadAtivo(a) ? -1 : 1; // fechados/perdidos ao fim
      const ia = leadInteresse(a), ib = leadInteresse(b);
      if (ia !== ib) return ia ? -1 : 1; // quem demonstrou interesse vem PRIMEIRO (sinal mais quente que existe)
      const va = leadVenc(a), vb = leadVenc(b);
      if (va !== vb) return va ? -1 : 1; // retornos vencidos primeiro
      const pa = a.proximoContato || '9999-99-99', pb = b.proximoContato || '9999-99-99';
      if (pa !== pb) return pa < pb ? -1 : 1; // follow-up mais próximo primeiro
      return (b.atualizadoEm || '').localeCompare(a.atualizadoEm || '');
    });
  }
  function leadCard(l, admin) {
    const venc = leadVenc(l), fim = !leadAtivo(l);
    const sg = _sinais[l.id] || null;
    const temInteresse = leadInteresse(l);
    // faixa com o que o CLIENTE fez (o corretor precisa ver isso — antes só o admin via)
    const faixa = sg && (sg.aberturas || sg.interesse || sg.duvida) ? `
      <div class="lead-sinal${sg.interesse ? ' sinal-quente' : ''}">
        ${sg.interesse ? `<b>🙋 O cliente disse que TEM INTERESSE</b> <span>${desdeTxt(STORE.diaLocalISO(sg.interesse))}</span>` : ''}
        ${!sg.interesse && sg.duvida ? `<b>💬 O cliente pediu para tirar uma dúvida</b> <span>${desdeTxt(STORE.diaLocalISO(sg.duvida))}</span>` : ''}
        ${sg.aberturas ? `<span class="sinal-abre">👀 abriu a proposta ${sg.aberturas}×</span>` : ''}
      </div>` : '';
    const quando = l.proximoContato
      ? `<span class="lead-quando ${venc ? 'venc' : ''}">${venc ? '⚠ ' : '↻ '}${fmtData(l.proximoContato)}</span>`
      : (l.primeiroContato ? `<span class="lead-quando suave">${desdeTxt(l.primeiroContato)}</span>` : '');
    return `
      <div class="lead-card temp-${l.temp || 'morno'} ${fim ? 'lead-fim' : ''} ${venc ? 'lead-venc' : ''} ${temInteresse ? 'lead-interesse' : ''} recolhido" data-id="${esc(l.id)}" data-temp="${esc(l.temp || 'morno')}" data-est="${esc(l.estagio || 'novo')}">
        <div class="lead-cab">
          <span class="lead-temp">${tempIc(l.temp)}</span>
          <span class="lead-nome">${esc(l.cliente || '(sem nome)')}</span>
          ${temInteresse ? '<span class="selo-interesse" title="o cliente clicou em “Tenho interesse”">🙋 interesse</span>' : ''}
          ${(() => { // mostra TODOS os aptos do cliente (não só o 1º) — 1 cliente pode ter levado vários
            const aps = _aptosPorCliente.get(_nrmNome(l.cliente)) || [];
            if (aps.length > 1) return `<span class="lead-un" title="${aps.length} apartamentos">Aptos ${esc(aps.join(' · '))}</span>`;
            return l.unidade ? `<span class="lead-un">Apto ${esc(l.unidade)}</span>` : '';
          })()}
          <span class="lead-badge est-${esc(l.estagio || 'novo')}">${estLab(l.estagio)}</span>
          ${isScpLead(l) ? '<span class="selo-scp" title="Proposta de SCP — Sociedade em Conta de Participação">💠 SCP</span>' : ''}
          ${admin && l.corretorNome ? `<span class="lead-cor">${esc(l.corretorNome)}${l.empresaNome ? ' · ' + esc(l.empresaNome) : ''}</span>` : ''}
          ${quando}
          <span class="lead-chevron">▾</span>
        </div>
        <div class="lead-corpo">
          ${faixa}
          <div class="lead-form">
            <label>Cliente<input class="l-cliente" value="${esc(l.cliente || '')}" placeholder="nome do cliente"></label>
            <label>Telefone<input class="l-tel" type="tel" inputmode="tel" value="${esc(l.clienteTel || '')}" placeholder="(34) 9 9999-9999"></label>
            <label>Apto de interesse<input class="l-un" value="${esc(l.unidade || '')}" placeholder="ex.: 404"></label>
          </div>
          <div class="lead-campo"><span class="lead-lbl">Temperatura</span><div class="seg-btns l-temp">${CRM_TEMPS.map(([k, ic, lab]) => `<button type="button" class="segb ${(l.temp || 'morno') === k ? 'on' : ''}" data-temp="${k}">${ic} ${lab}</button>`).join('')}</div></div>
          <div class="lead-campo"><span class="lead-lbl">Estágio</span><div class="seg-btns l-estagio">${CRM_ESTAGIOS.map(([k, lab]) => `<button type="button" class="segb ${(l.estagio || 'novo') === k ? 'on' : ''}" data-est="${k}">${lab}</button>`).join('')}</div></div>
          ${admin && l.corretorNome && _roster.length ? (() => {
            const cur = (l.empresaUsuario || '') + '|' + (l.corretorNome || '');
            const conhecido = _roster.some((r) => (r.usuario + '|' + r.nome) === cur);
            const opts = (conhecido ? '' : `<option value="${esc(cur)}" selected>${esc(l.corretorNome)}${l.empresaNome ? ' · ' + esc(l.empresaNome) : ''} (atual)</option>`)
              + _roster.map((r) => { const k = r.usuario + '|' + r.nome; return `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(r.nome)}${r.empresa ? ' · ' + esc(r.empresa) : ' · Domo'}</option>`; }).join('');
            return `<div class="lead-campo"><span class="lead-lbl">Corretor responsável <small class="lead-lbl-sub">reatribui o cliente e as propostas dele</small></span><select class="l-corretor" data-atual="${esc(cur)}">${opts}</select></div>`;
          })() : ''}
          <div class="lead-form">
            <label>1º contato<input type="date" class="l-prim" value="${esc(l.primeiroContato || '')}"></label>
            <label>Próximo contato (follow-up)<input type="date" class="l-prox" value="${esc(l.proximoContato || '')}"></label>
          </div>
          <label class="lead-obs">Observações / o que o cliente perguntou<textarea class="l-obs" rows="3" placeholder="dúvidas, preferências, o que falta para fechar…">${esc(l.obs || '')}</textarea></label>
          <div class="lead-acoes">
            ${l.clienteTel ? `<a class="btn-mini lead-wa" href="https://wa.me/${telWa(l.clienteTel)}" target="_blank" rel="noopener">📱 WhatsApp</a>` : ''}
            <button type="button" class="btn-lime lead-salvar">salvar</button>
            <button type="button" class="btn-mini lead-del">excluir</button>
          </div>
        </div>
      </div>`;
  }
  function lerLeadCard(card) {
    return {
      id: card.dataset.id,
      cliente: ($('.l-cliente', card).value || '').trim(),
      clienteTel: ($('.l-tel', card).value || '').trim(),
      unidade: ($('.l-un', card).value || '').trim(),
      temp: card.dataset.temp || 'morno',
      estagio: card.dataset.est || 'novo',
      primeiroContato: $('.l-prim', card).value || '',
      proximoContato: $('.l-prox', card).value || '',
      obs: $('.l-obs', card).value || '',
    };
  }
  function wireLeadCard(card) {
    $('.lead-cab', card).onclick = () => card.classList.toggle('recolhido'); // recolher/expandir
    $$('.l-temp .segb', card).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); _sujo = true; card.dataset.temp = b.dataset.temp; $$('.l-temp .segb', card).forEach((x) => x.classList.toggle('on', x === b)); $('.lead-temp', card).textContent = tempIc(b.dataset.temp); card.className = card.className.replace(/temp-\w+/, 'temp-' + b.dataset.temp); }; });
    $$('.l-estagio .segb', card).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); _sujo = true; card.dataset.est = b.dataset.est; $$('.l-estagio .segb', card).forEach((x) => x.classList.toggle('on', x === b)); const bd = $('.lead-badge', card); if (bd) { bd.textContent = estLab(b.dataset.est); bd.className = 'lead-badge est-' + b.dataset.est; } }; });
    const selCor = $('.l-corretor', card);
    if (selCor) selCor.onchange = async (e) => {
      e.stopPropagation();
      const atual = selCor.dataset.atual; const val = selCor.value;
      if (val === atual) return;
      const alvo = _roster.find((r) => (r.usuario + '|' + r.nome) === val);
      if (!alvo) { selCor.value = atual; return; }
      const lead = STORE.getLeads().find((x) => x.id === card.dataset.id);
      const nome = (lead && lead.cliente) || 'este cliente';
      if (!confirm('Reatribuir "' + nome + '" (e as propostas dele) para ' + alvo.nome + (alvo.empresa ? ' · ' + alvo.empresa : '') + '?\n\nO cliente sai da carteira do corretor atual.')) { selCor.value = atual; return; }
      selCor.disabled = true;
      try { const campos = lerLeadCard(card); if (campos.cliente) STORE.salvarLead(campos); } catch (_) { /* preserva edições de campo em andamento */ }
      try {
        const r = await STORE.reatribuirCorretor(card.dataset.id, alvo);
        const nP = (r && r.propostas && r.propostas.length) || 0;
        _sujo = false;
        toast('Reatribuído para ' + alvo.nome + (nP ? ' · ' + nP + ' proposta(s)' : '') + ' ✓');
        crmPinta();
      } catch (err) { toast(err.message || 'Erro ao reatribuir', true); selCor.value = atual; selCor.disabled = false; }
    };
    const salvar = $('.lead-salvar', card);
    salvar.onclick = (e) => {
      e.stopPropagation();
      const lead = lerLeadCard(card);
      if (!lead.cliente) { toast('Informe o nome do cliente.', true); return; }
      try {
        STORE.salvarLead(lead); // grava local + enfileira (funciona offline; sincroniza sozinho depois)
        if (card.dataset.novo === '1') card.remove(); // já está no espelho → tira o card "novo" p/ o crmPinta não duplicar
        _sujo = false;
        toast('Cliente salvo ✓'); crmPinta();
      } catch (err) { toast(err.message, true); }
    };
    const del = $('.lead-del', card);
    if (del) del.onclick = (e) => {
      e.stopPropagation();
      if (!confirm('Excluir este cliente do CRM?')) return;
      const id = card.dataset.id;
      try {
        if (card.dataset.novo === '1') card.remove(); else STORE.excluirLead(id);
        _sujo = false;
        toast('Cliente excluído ✓'); crmPinta();
      } catch (err) { toast(err.message, true); }
    };
  }
  // KPIs CLICÁVEIS: cada um filtra a lista (clica de novo p/ desligar) — mesmo comportamento dos chips do espelho
  const CRM_FOCOS = {
    interesse: { lab: '🙋 Interessados', fn: (l) => leadInteresse(l), cls: 'kpi-interesse' },
    aberto: { lab: 'Em aberto', fn: (l) => leadAtivo(l), cls: '' },
    vencido: { lab: 'Retornos vencidos', fn: (l) => leadVenc(l), cls: 'kpi-venc' },
    fechado: { lab: 'Propostas fechadas', fn: (l) => l.estagio === 'fechado', cls: 'kpi-venda',
      // 1 cliente pode ter levado vários aptos — mostra também quantas unidades saíram
      sub: (arr) => { const n = arr.reduce((s, l) => s + ((_aptosPorCliente.get(_nrmNome(l.cliente)) || []).length || (l.unidade ? 1 : 0)), 0); return n ? (n === 1 ? '1 unidade vendida' : n + ' unidades vendidas') : ''; } },
  };
  function crmResumo(leads) {
    const foco = (_crm.filtro || {}).foco || '';
    const kpi = (k) => {
      const d = CRM_FOCOS[k]; const arr = leads.filter(d.fn); const n = arr.length;
      const sub = d.sub ? d.sub(arr) : '';
      return `<button type="button" class="kpi kpi-btn ${n && d.cls ? d.cls : ''} ${foco === k ? 'kpi-on' : ''}" data-foco="${k}" title="clique para filtrar">
        <div class="kpi-v">${n}</div><div class="kpi-l">${d.lab}</div>${sub ? '<div class="kpi-sub">' + sub + '</div>' : ''}</button>`;
    };
    return `<div class="dash-kpis crm-kpis">${Object.keys(CRM_FOCOS).map(kpi).join('')}</div>`;
  }
  let _crm = { resumo: '', lista: '', admin: false, filtro: null };
  // sinais do cliente (abriu o PDF / tenho interesse / dúvida) por leadId — vêm dos envios
  let _sinais = {};
  // clientes que têm proposta de SCP (forma:'scp') → o card do CRM e a régua marcam "💠 SCP"
  const _nrmNome = (s) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  let _scpNomes = new Set();
  let _aptosPorCliente = new Map(); // cliente normalizado → TODOS os aptos dele (1 cliente pode levar vários)
  function crmScpKeys() {
    const set = new Set(); const mapa = new Map();
    (STORE.getPropostas() || []).forEach((p) => {
      if (!p.cliente) return;
      const k = _nrmNome(p.cliente);
      if (p.forma === 'scp') set.add(k);
      if (p.unidade) { const a = mapa.get(k) || []; const un = String(p.unidade); if (!a.includes(un)) a.push(un); mapa.set(k, a); }
    });
    mapa.forEach((a) => a.sort((x, y) => x.padStart(5, '0') < y.padStart(5, '0') ? -1 : 1));
    _scpNomes = set; _aptosPorCliente = mapa;
  }
  const isScpLead = (l) => !!(l && l.cliente && _scpNomes.size && _scpNomes.has(_nrmNome(l.cliente)));
  async function crmSinais() {
    try {
      const envios = await STORE.listEnvios();
      const m = {};
      for (const e of envios) {
        if (!e.leadId) continue;
        const s = m[e.leadId] = m[e.leadId] || { aberturas: 0, interesse: null, duvida: null };
        s.aberturas += (e.views || 0);
        for (const ev of (e.eventos || [])) {
          if (ev.tipo === 'interesse' && (!s.interesse || ev.em > s.interesse)) s.interesse = ev.em;
          if (ev.tipo === 'duvida' && (!s.duvida || ev.em > s.duvida)) s.duvida = ev.em;
        }
      }
      _sinais = m;
    } catch (e) { /* sem sinais é melhor que quebrar o CRM */ }
  }
  // o espelho local (STORE.getLeads) é a fonte da verdade: instantâneo, sem lag do Blobs e funciona offline.
  async function crmCarrega() {
    crmPinta();               // pinta já com o que tem local (offline inclusive)
    await STORE.pullLeads();  // e atualiza do servidor em seguida (silencioso se offline)
    crmPinta();
    try { await STORE.pull(); } catch (e) { /* offline */ } // refresca as propostas p/ o selo SCP (sem re-render da rota — só emite 'dados')
    crmPinta();
    await crmSinais();        // aberturas/interesse do cliente
    crmPinta();
  }
  // quem vê a carteira de MAIS DE UMA pessoa precisa saber de quem é cada card e poder filtrar por corretor
  const crmVeVariosCorretores = () => _crm.admin || !!(STORE.getUser() || {}).ehMaster;
  // corretores p/ quem dá p/ REATRIBUIR um lead. Admin recebe o cadastro (getUsuarios); o master só a própria
  // equipe; o domo (super sem cadastro) deriva do que já vê (propostas + leads). Cacheado por crmPinta.
  let _roster = [];
  function rosterReatribuir() {
    const u = STORE.getUser() || {};
    const seen = new Set(); const out = [];
    const add = (usuario, nome, empresa, tel) => {
      usuario = (usuario || '').trim(); nome = (nome || '').trim();
      if (!usuario || !nome) return;
      const k = usuario + '|' + nome; if (seen.has(k)) return; seen.add(k);
      out.push({ usuario, nome, empresa: (empresa || '').trim(), tel: tel || '' });
    };
    if (STORE.isAdmin()) {
      (STORE.getUsuarios() || []).forEach((e) => { if (e.papel === 'admin') return; (e.corretores || []).forEach((c) => add(e.usuario, c.nome, e.nome, c.telefone)); });
    } else if (u.ehMaster) {
      (u.corretores || []).forEach((c) => add(u.usuario, c.nome, u.nome, c.telefone));
    }
    if (ehLoginDomo()) { // super sem cadastro: usa o que já enxerga
      STORE.getPropostas().forEach((p) => add(p.corretorUsuario, p.corretor, p.corretorEmpresa, p.corretorTel));
      STORE.getLeads().forEach((l) => add(l.empresaUsuario, l.corretorNome, l.empresaNome, l.corretorTel));
    }
    out.sort((a, b) => (a.empresa || '').localeCompare(b.empresa || '') || a.nome.localeCompare(b.nome));
    return out;
  }
  function crmPinta() {
    crmScpKeys(); // recomputa quais clientes têm proposta SCP (p/ o selo no card e na régua)
    _roster = crmVeVariosCorretores() ? rosterReatribuir() : []; // quem pode receber um lead reatribuído
    const todos = STORE.getLeads().slice();
    let leads = todos;
    const f = _crm.filtro || {};
    if (f.empresa) leads = leads.filter((l) => (l.empresaNome || '') === f.empresa);
    if (f.estagio) leads = leads.filter((l) => l.estagio === f.estagio);
    if (f.corretor) leads = leads.filter((l) => (l.corretorNome || '') === f.corretor);
    if (f.foco && CRM_FOCOS[f.foco]) leads = leads.filter(CRM_FOCOS[f.foco].fn);
    if (f.busca) { const b = f.busca.trim().toLowerCase(); leads = leads.filter((l) => ((l.cliente || '') + ' ' + (l.clienteTel || '') + ' ' + (l.unidade || '')).toLowerCase().includes(b)); }
    const rs = $(_crm.resumo); if (rs && !_crm.admin) rs.innerHTML = crmResumo(todos); // contagens sempre do total (senão o KPI zera ao filtrar)
    // seletor de corretor (master/admin) — sem ele, ver a carteira da equipe sem saber de quem é não serve
    const sel = _crm.selCorretor ? $(_crm.selCorretor) : null; // seletor '' quebraria o querySelector e mataria a lista
    if (sel) {
      const base = f.empresa ? todos.filter((l) => (l.empresaNome || '') === f.empresa) : todos; // só os corretores da empresa filtrada
      const cont = {}; base.forEach((l) => { cont[l.corretorNome] = (cont[l.corretorNome] || 0) + 1; });
      const nomes = Object.keys(cont).filter(Boolean).sort((a, b) => a.localeCompare(b));
      sel.innerHTML = `<option value="">Todos os corretores (${base.length})</option>` +
        nomes.map((n) => `<option value="${esc(n)}" ${f.corretor === n ? 'selected' : ''}>${esc(n)} (${cont[n]})</option>`).join('');
    }
    const box = $(_crm.lista); if (!box) return;
    const novo = box.querySelector('.novo-lead'); if (novo) novo.remove(); // preserva o card "novo cliente" em digitação (re-render de outro save não pode apagá-lo)
    const ord = ordenaLeads(leads);
    const temFiltro = !!(f.empresa || f.estagio || f.corretor || f.foco);
    box.innerHTML = ord.length ? ord.map((l) => leadCard(l, crmVeVariosCorretores())).join('')
      : (novo ? '' : '<div class="vazio">nenhum cliente ' + (temFiltro ? 'com esse filtro' : (_crm.admin ? 'cadastrado ainda' : 'ainda — toque em ＋ novo cliente')) + '.</div>');
    $$('.lead-card', box).forEach((c) => wireLeadCard(c));
    $$('.kpi-btn', $(_crm.resumo) || document).forEach((b) => { b.onclick = () => { _crm.filtro = { ...(_crm.filtro || {}), foco: (_crm.filtro || {}).foco === b.dataset.foco ? '' : b.dataset.foco }; crmPinta(); }; });
    if (novo) box.insertBefore(novo, box.firstChild); // recoloca o card novo (já vinculado) no topo
    marcarSujo(_crm.lista); // digitar num card sem salvar bloqueia o re-render do pull
  }
  function crmNovo() {
    const box = $(_crm.lista); if (!box) return;
    let card = box.querySelector('.novo-lead');
    if (card) { $('.l-cliente', card).focus(); return; }
    const id = 'lead-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
    const wrap = document.createElement('div'); wrap.innerHTML = leadCard({ id, temp: 'morno', estagio: 'novo', primeiroContato: hoje() }, _crm.admin);
    card = wrap.firstElementChild; card.classList.remove('recolhido'); card.classList.add('novo-lead'); card.dataset.novo = '1';
    const vaz = box.querySelector('.vazio'); if (vaz) vaz.remove();
    box.insertBefore(card, box.firstChild);
    wireLeadCard(card);
    $('.l-cliente', card).focus();
  }
  // integra ações do corretor ao CRM: cria/atualiza o cliente automaticamente (sem digitar de novo).
  // dedupe por nome (+ telefone quando houver); só AVANÇA o estágio (nunca rebaixa fechado/perdido).
  async function crmRegistrar({ cliente, clienteTel, unidade, estagio, temp, forceTemp }) {
    if (STORE.isAdmin()) return null;
    const nome = (cliente || '').trim(); if (!nome) return null;
    const ordem = ['novo', 'contato', 'proposta', 'negociando', 'fechado', 'perdido'];
    const nrm = (s) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' '); // ignora acento/espaço
    const dig = (s) => (s || '').replace(/\D/g, '');
    const tel = dig(clienteTel);
    try {
      // espelho LOCAL: instantâneo, sem lag do Blobs, já escopado no corretor ativo e funciona offline
      const leads = STORE.getLeads();
      // candidatos = mesmo nome e ATIVOS; fechado/perdido nunca são mexidos (cliente que volta vira lead NOVO)
      const cand = leads.filter((l) => nrm(l.cliente) === nrm(nome) && !['fechado', 'perdido'].includes(l.estagio));
      // com telefone: só casa MESMO telefone (não colapsa homônimos distintos); sem telefone: casa por nome
      const m = tel ? cand.find((l) => dig(l.clienteTel) === tel) : cand[0];
      if (m) {
        const est = ordem.indexOf(estagio) > ordem.indexOf(m.estagio || 'novo') ? estagio : (m.estagio || 'novo'); // só avança
        STORE.salvarLead({ ...m, unidade: unidade || m.unidade || '', estagio: est, temp: forceTemp ? temp : (m.temp || 'morno'), clienteTel: dig(m.clienteTel) ? m.clienteTel : (clienteTel || m.clienteTel || '') });
        return { acao: 'atualizado', id: m.id };
      }
      const id = 'lead-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
      STORE.salvarLead({ id, cliente: nome, clienteTel: clienteTel || '', unidade: unidade || '', estagio, temp: temp || 'morno', primeiroContato: hoje() });
      return { acao: 'novo', id };
    } catch (e) { return null; }
  }
  function crmDashAdmin(leads) {
    crmScpKeys(); // garante o mapa cliente → aptos (o dash é montado antes do 1º crmPinta)
    const total = leads.length;
    const ativos = leads.filter(leadAtivo).length;
    const fechados = leads.filter((l) => l.estagio === 'fechado').length;
    // quantos APARTAMENTOS os clientes fechados levaram (1 cliente pode ter levado vários)
    const aptosFechados = leads.filter((l) => l.estagio === 'fechado')
      .reduce((s, l) => s + ((_aptosPorCliente.get(_nrmNome(l.cliente)) || []).length || (l.unidade ? 1 : 0)), 0);
    const taxa = total ? Math.round(fechados / total * 100) : 0;
    const porCor = {};
    leads.forEach((l) => { const k = (l.empresaNome || '') + '|' + (l.corretorNome || '—'); const o = porCor[k] = porCor[k] || { corretor: l.corretorNome || '—', empresa: l.empresaNome || '', total: 0, fechados: 0 }; o.total++; if (l.estagio === 'fechado') o.fechados++; });
    const rank = Object.values(porCor).sort((a, b) => b.fechados - a.fechados || (b.fechados / b.total) - (a.fechados / a.total)).slice(0, 8);
    const kpi = (v, l, cls, sub) => `<div class="kpi ${cls || ''}"><div class="kpi-v">${v}</div><div class="kpi-l">${l}</div>${sub ? '<div class="kpi-sub">' + sub + '</div>' : ''}</div>`;
    // UNIDADES vendidas por corretor — vem do "quem vendeu" da unidade (1 cliente pode levar vários aptos)
    const cfgU = STORE.getCfg() || {};
    const vmap = {};
    STORE.getUnidades().filter((u) => u.status === 'Vendido').forEach((u) => {
      const nome = (u.vendedorNome || '').trim(); if (!nome) return;
      const emp = (u.vendedorEmpresa || '').trim();
      const o = vmap[emp + '|' + nome] = vmap[emp + '|' + nome] || { nome, empresa: emp, n: 0, valor: 0, uns: [] };
      const vu = valorNegociadoTabela(u, cfgU);
      o.n++; o.valor += vu; o.uns.push({ unidade: u.unidade, valor: vu });
    });
    const rankUn = Object.values(vmap).sort((a, b) => b.n - a.n || b.valor - a.valor);
    const maxUn = Math.max(1, ...rankUn.map((v) => v.n));
    const totUn = rankUn.reduce((s, v) => s + v.n, 0);
    const totValorUn = rankUn.reduce((s, v) => s + v.valor, 0);
    return `<div class="dash">
      <div class="dash-kpis">
        ${kpi(total, 'Leads totais')}
        ${kpi(ativos, 'Em aberto')}
        ${kpi(fechados, 'Propostas fechadas', 'kpi-venda', aptosFechados ? (aptosFechados === 1 ? '1 unidade vendida' : aptosFechados + ' unidades vendidas') : '')}
        ${kpi(taxa + '%', 'Taxa de conversão', taxa ? 'kpi-lime' : '')}
      </div>
      <div class="dash-grid">
        <div class="dash-card">
          <div class="dash-tit">Conversão por corretor <span class="dash-sub">propostas fechadas ÷ leads</span></div>
          <div class="bars">${rank.length ? rank.map((r) => { const tx = r.total ? Math.round(r.fechados / r.total * 100) : 0; return `<div class="bar-row"><div class="bar-lbl" title="${esc(r.corretor + (r.empresa ? ' · ' + r.empresa : ''))}">${esc(r.corretor)}<span class="bar-emp">${r.empresa ? esc(r.empresa) : 'Domo'}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, tx)}%"></div></div><div class="bar-val">${r.fechados}/${r.total} <span class="bar-sub">${tx}%</span></div></div>`; }).join('') : '<div class="nota">sem dados ainda</div>'}</div>
        </div>
        <div class="dash-card">
          <div class="dash-tit">Unidades vendidas por corretor <span class="dash-sub">${totUn === 1 ? '1 unidade' : totUn + ' unidades'}${totValorUn ? ' · ' + fmt(totValorUn) : ''}</span></div>
          <div class="bars">${rankUn.length ? rankUn.slice(0, 8).map((v, i) => `
            <div class="bar-row bar-clic" data-cvi="${i}" title="clique para ver os apartamentos de ${esc(v.nome)}">
              <div class="bar-lbl">${esc(v.nome)}<span class="bar-emp">${v.empresa ? esc(v.empresa) : 'Domo'}</span></div>
              <div class="bar-track bar-track-v"><div class="bar-fill bar-fill-v" style="width:${Math.max(4, Math.round(v.n / maxUn * 100))}%"></div></div>
              <div class="bar-val">${v.n}<span class="bar-chev">▾</span></div></div>
            <div class="vend-det oculto" data-cvi="${i}">
              <div class="vend-det-cab">${v.n === 1 ? '1 unidade' : v.n + ' unidades'} · ${fmt(v.valor)}</div>
              ${v.uns.slice().sort((a, b) => String(a.unidade).padStart(5, '0') < String(b.unidade).padStart(5, '0') ? -1 : 1)
                .map((x) => `<span class="vend-un"><b>${esc(String(x.unidade))}</b><i>${fmt(x.valor)}</i></span>`).join('')}
            </div>`).join('')
            : '<div class="nota">Nenhuma unidade com <b>quem vendeu</b> marcado ainda.</div>'}</div>
        </div>
      </div></div>`;
  }
  // HISTÓRICO DA EQUIPE (master da empresa): as propostas dos corretores dele. O servidor já escopa por empresa+master.
  const histEq = { corretor: '' };
  async function vHistoricoEquipe() {
    if (STORE.isAdmin()) { location.hash = '#/admin/historico'; render(); return; }
    if (!(STORE.getUser() || {}).ehMaster) { toast('Só o master vê o histórico da equipe.', true); location.hash = '#/home'; return; }
    const pintar = () => {
      const todas = STORE.getPropostas().slice();
      const cont = {}; todas.forEach((p) => { cont[p.corretor || '—'] = (cont[p.corretor || '—'] || 0) + 1; });
      const nomes = Object.keys(cont).sort((a, b) => a.localeCompare(b));
      if (histEq.corretor && !cont[histEq.corretor]) histEq.corretor = '';
      const lista = (histEq.corretor ? todas.filter((p) => (p.corretor || '—') === histEq.corretor) : todas)
        .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || '')); // mais recentes primeiro
      const grupos = {}; lista.forEach((p) => { (grupos[String(p.unidade)] = grupos[String(p.unidade)] || []).push(p); });
      const chaves = Object.keys(grupos).sort((a, b) => String(a).padStart(5, '0') < String(b).padStart(5, '0') ? -1 : 1);
      $('#he-corpo').innerHTML = `
        <div class="dash-kpis crm-kpis">
          <div class="kpi"><div class="kpi-v">${lista.length}</div><div class="kpi-l">Propostas</div></div>
          <div class="kpi"><div class="kpi-v">${new Set(lista.map((p) => String(p.unidade))).size}</div><div class="kpi-l">Aptos</div></div>
          <div class="kpi"><div class="kpi-v">${new Set(lista.map((p) => p.corretor)).size}</div><div class="kpi-l">Corretores</div></div>
        </div>
        ${chaves.length ? chaves.map((un) => `
          <div class="hist-grupo">
            <div class="hist-grupo-cab">Apto ${esc(un)} <span class="hist-grupo-n">${grupos[un].length} proposta(s)</span><span class="grupo-chevron">▾</span></div>
            <div class="tabela-wrap"><table class="tabela">
              <thead><tr><th>Data</th><th>Cliente</th><th>Corretor</th><th>Valor</th><th>Forma</th></tr></thead>
              <tbody>${grupos[un].map((p) => `<tr>
                <td>${fmtData(p.criadoEm)}</td>
                <td>${esc(p.cliente)}${p.clienteTel ? '<br><span class="hist-tel">' + esc(p.clienteTel) + '</span>' : ''}</td>
                <td>${esc(p.corretor || '—')}</td>
                <td>${fmt(p.neg)}</td>
                <td>${esc(p.formaLabel || p.forma)}</td>
              </tr>`).join('')}</tbody>
            </table></div>
          </div>`).join('') : '<div class="vazio">nenhuma proposta ' + (histEq.corretor ? 'desse corretor' : 'ainda') + '.</div>'}`;
      const sel = $('#he-cor');
      sel.innerHTML = `<option value="">Todos os corretores (${todas.length})</option>` +
        nomes.map((n) => `<option value="${esc(n)}" ${histEq.corretor === n ? 'selected' : ''}>${esc(n)} (${cont[n]})</option>`).join('');
      $$('.hist-grupo-cab').forEach((cab) => { cab.onclick = () => cab.closest('.hist-grupo').classList.toggle('recolhido'); });
    };
    app().innerHTML = `
      <div class="crm">
        <a class="volta" href="#/clientes">← CRM</a>
        <div class="crm-top"><h2>Histórico da equipe</h2></div>
        <div class="crm-filtros"><select id="he-cor"></select></div>
        <div id="he-corpo"><div class="nota">carregando…</div></div>
      </div>`;
    pintar();
    $('#he-cor').onchange = (e) => { histEq.corretor = e.target.value; pintar(); };
    await STORE.pull(); // atualiza e repinta
    if (location.hash === '#/historico') pintar();
    montarFabDomo();
  }

  async function vClientes() {
    if (STORE.isAdmin()) { location.hash = '#/admin/clientes'; render(); return; }
    const ehMaster = !!(STORE.getUser() || {}).ehMaster;
    app().innerHTML = `
      <div class="crm">
        <a class="volta" href="#/home">← espelho</a>
        <div class="crm-top"><h2>CRM</h2><button class="btn-lime" id="crm-novo">＋ novo cliente</button></div>
        <div class="crm-filtros">
          <input id="crm-busca" placeholder="buscar cliente, telefone ou apto…" autocomplete="off">
          ${ehMaster ? '<select id="crm-cor" title="ver a carteira de um corretor"></select><a class="btn-mini crm-hist" href="#/historico">📄 histórico da equipe</a>' : ''}
        </div>
        <div id="crm-resumo"></div>
        <div id="crm-lista"><div class="nota">carregando…</div></div>
      </div>`;
    _crm = { resumo: '#crm-resumo', lista: '#crm-lista', selCorretor: ehMaster ? '#crm-cor' : '', admin: false, filtro: {} };
    $('#crm-novo').onclick = crmNovo;
    $('#crm-busca').oninput = (e) => { _crm.filtro.busca = e.target.value; crmPinta(); const b = $('#crm-busca'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); };
    if (ehMaster) $('#crm-cor').onchange = (e) => { _crm.filtro.corretor = e.target.value; crmPinta(); };
    await crmCarrega();
    montarFabDomo();
  }
  async function aClientes() {
    $('#aba-corpo').innerHTML = `
      <div class="crm-topbar"><span class="nota" style="margin:0">Todos os clientes de todos os corretores. Os vencidos aparecem no topo, em vermelho.</span></div>
      <div class="filtros" id="crm-filtros"></div>
      <div id="crm-resumo"></div>
      <div id="crm-lista"><div class="nota">carregando…</div></div>`;
    _crm = { resumo: '#crm-resumo', lista: '#crm-lista', selCorretor: '#cf-cor', admin: true, filtro: { empresa: '', estagio: '', corretor: '', foco: '' } };
    await STORE.pullLeads();
    const todosLeads = STORE.getLeads();
    $('#crm-resumo').innerHTML = crmDashAdmin(todosLeads); // dashboard de conversão (global, não filtrado)
    // "unidades vendidas por corretor": clicar abre os apartamentos daquele vendedor
    $$('#crm-resumo .bar-clic').forEach((r) => {
      r.onclick = () => {
        const d = $$('#crm-resumo .vend-det').find((x) => x.dataset.cvi === r.dataset.cvi);
        if (!d) return;
        const abrindo = d.classList.contains('oculto');
        $$('#crm-resumo .vend-det').forEach((x) => x.classList.add('oculto'));
        $$('#crm-resumo .bar-clic').forEach((x) => x.classList.remove('aberto'));
        if (abrindo) { d.classList.remove('oculto'); r.classList.add('aberto'); }
      };
    });
    const empresas = [...new Set(todosLeads.map((l) => l.empresaNome).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    $('#crm-filtros').innerHTML = `
      <input id="cf-busca" class="cf-busca" placeholder="🔎 buscar cliente, telefone ou apto…" autocomplete="off">
      <select id="cf-emp"><option value="">Todas as empresas</option>${empresas.map((e) => `<option>${esc(e)}</option>`).join('')}</select>
      <select id="cf-cor"></select>
      <select id="cf-est"><option value="">Todos os estágios</option>${CRM_ESTAGIOS.map(([k, lab]) => `<option value="${k}">${lab}</option>`).join('')}</select>`;
    $('#cf-busca').oninput = (e) => { _crm.filtro.busca = e.target.value; crmPinta(); const b = $('#cf-busca'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); };
    $('#cf-emp').onchange = (e) => { _crm.filtro.empresa = e.target.value; _crm.filtro.corretor = ''; crmPinta(); }; // trocar empresa zera o corretor (era de outra)
    $('#cf-cor').onchange = (e) => { _crm.filtro.corretor = e.target.value; crmPinta(); };
    $('#cf-est').onchange = (e) => { _crm.filtro.estagio = e.target.value; crmPinta(); };
    crmPinta();
  }

  // ---------- ADMIN ----------
  function vAdmin(tab) {
    if (!STORE.podeVerPainel()) { location.hash = '#/home'; return; }
    const soDomo = !STORE.isAdmin(); // domo: painel restrito (vê tudo + muda vendedor; SEM config/preços/imobiliárias)
    const tabs = soDomo
      ? [['vendas', 'Vendas'], ['clientes', 'CRM'], ['historico', 'Histórico'], ['envios', 'Envios']]
      : [['unidades', 'Unidades'], ['predio', 'Prédio'], ['config', 'Config'], ['corretores', 'Corretores'], ['clientes', 'CRM'], ['historico', 'Histórico'], ['envios', 'Envios'], ['saude', 'Saúde']];
    tab = tab && tabs.some(([id]) => id === tab) ? tab : tabs[0][0]; // aba não permitida p/ o papel → 1ª disponível
    app().innerHTML = `
      <div class="admin">
        <a class="volta" href="#/home">← espelho</a>
        <div class="abas">${tabs.map(([id, l]) => `<a class="aba ${tab === id ? 'on' : ''}" href="#/admin/${id}">${l}</a>`).join('')}</div>
        <div id="aba-corpo"></div>
      </div>`;
    ({ unidades: aUnidades, predio: aPredio, config: aConfig, corretores: aCorretores, clientes: aClientes, historico: aHistorico, envios: aEnvios, saude: aSaude, vendas: aVendas }[tab] || (soDomo ? aVendas : aUnidades))();
    // sair da aba (outra aba ou "← espelho") com edição pendente → confirma antes de perder
    $$('.admin .aba, .admin .volta').forEach((a) => a.addEventListener('click', (e) => {
      if (_sujo && !confirm('Você tem alterações não salvas nesta aba. Sair sem salvar?')) e.preventDefault();
    }));
  }

  function aUnidades() {
    const cfg = STORE.getCfg() || {};
    const uns = STORE.getUnidades().slice().sort((a, b) => String(a.unidade).padStart(5, '0') < String(b.unidade).padStart(5, '0') ? -1 : 1);
    // lista de possíveis vendedores (para marcar quem vendeu cada unidade → alimenta o ranking de vendas)
    // só corretores de empresa (quem de fato vende); admins ficam de fora p/ não duplicar (o time Domo já está na empresa Domo)
    const vseen = new Set(); const vendedores = [];
    STORE.getUsuarios().forEach((us) => {
      if (us.papel === 'admin') return;
      (us.corretores || []).forEach((c) => { const n = (c.nome || '').trim(); if (!n) return; const k = (us.nome || '') + '|' + n; if (vseen.has(k)) return; vseen.add(k); vendedores.push({ nome: n, empresa: us.nome || '' }); });
    });
    const vendSelect = (u) => {
      const cur = (u.vendedorEmpresa || '') + '|' + (u.vendedorNome || '');
      const conhecido = vendedores.some((v) => (v.empresa + '|' + v.nome) === cur);
      return `<select class="e-vendedor"><option value="|">— quem vendeu?</option>${vendedores.map((v) => { const k = v.empresa + '|' + v.nome; return `<option value="${esc(k)}" ${cur === k ? 'selected' : ''}>${esc(v.nome)}${v.empresa ? ' · ' + esc(v.empresa) : ' · Domo'}</option>`; }).join('')}${(u.vendedorNome && !conhecido) ? `<option value="${esc(cur)}" selected>${esc(u.vendedorNome)}${u.vendedorEmpresa ? ' · ' + esc(u.vendedorEmpresa) : ''} (antigo)</option>` : ''}</select>`;
    };
    $('#aba-corpo').innerHTML = `
      <div class="cfg-rapida">
        <label>Data da tabela<input id="c-data" value="${esc(cfg.dataTabela || '')}"></label>
        <label>Versão<input id="c-versao" value="${esc(cfg.versao || '')}"></label>
        <label>Reajuste geral (%)<input id="c-reaj" type="number" step="0.1" value="${((cfg.reajuste || 0) * 100).toFixed(1)}"></label>
        <button class="btn-lime" id="c-salvar">Aplicar</button>
        <span class="nota">o reajuste multiplica o preço base de TODAS as unidades</span>
      </div>
      <details class="bloco-fotos"><summary>Fotos por tipo de planta <span class="nota" style="font-weight:400">— configura uma vez; valem para todas as unidades do final</span></summary>
      <div class="tipos-strip">${['01', '02', '03', '04', '05', '06', '07', '08', 'LOJA'].map((t) => `
        <div class="tipo-slot">
          <span class="mini-foto grande" data-fotoid="${(cfg.fotosTipo || {})[t] || ''}"></span>
          <span class="tipo-lab">${t}</span>
          <span class="tipo-btns">
            <button class="btn-mini t-fotobtn" data-tipo="${t}">📷</button>
            <button class="btn-mini t-girar" data-tipo="${t}" title="girar 90°">↻</button>
          </span>
          <input type="file" accept="image/*" class="t-file" data-tipo="${t}" style="display:none">
        </div>`).join('')}
      </div></details>
      <div class="un-busca"><input id="un-q" placeholder="🔎 buscar unidade (nº ou andar)" autocomplete="off"><select id="un-status"><option value="">Todos os status</option><option value="Disponível">Disponíveis</option><option value="Reservado">Reservadas</option><option value="Vendido">Vendidas</option></select><span id="un-cont" class="nota"></span></div>
      <div class="tabela-wrap"><table class="tabela adm-un">
        <thead><tr><th>Un.</th><th>Andar</th><th>Área</th><th>Preço base</th><th>Valor tabela</th><th>Desc. %</th><th>Status</th><th>Vendedor</th><th></th></tr></thead>
        <tbody>${uns.map((u) => `
          <tr data-id="${u.id}" data-status="${esc(u.status || 'Disponível')}">
            <td data-lab="Unidade"><b>${esc(u.unidade)}</b></td><td data-lab="Andar">${u.andar === 0 ? 'T' : u.andar}</td>
            <td data-lab="Área">${u.area ? u.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
            <td data-lab="Preço base"><input class="e-preco" type="number" value="${u.precoBase || 0}"></td>
            <td data-lab="Valor tabela">${fmt(valorTabela(u, cfg))}</td>
            <td data-lab="Desc. %"><input class="e-desc" type="number" step="0.5" value="${((u.desconto || 0) * 100).toFixed(1)}"></td>
            <td data-lab="Status"><select class="e-status">${['Disponível', 'Reservado', 'Vendido'].map((s) => `<option ${u.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
            <td data-lab="Vendedor" class="td-vendedor">${vendSelect(u)}</td>
            <td class="td-salvar"><button class="btn-mini e-salvar">salvar</button></td>
          </tr>`).join('')}</tbody>
      </table></div>`;
    $('#c-salvar').onclick = () => {
      // aplicar re-renderiza a tabela inteira → avisa se há edições de linha pendentes que seriam perdidas
      if (_sujo && !confirm('Há edições de unidade não salvas nesta tabela que serão perdidas ao aplicar.\n\nAplicar o reajuste/versão mesmo assim?')) return;
      STORE.salvarCfg({ ...(STORE.getCfg() || {}), dataTabela: $('#c-data').value, versao: $('#c-versao').value, reajuste: (parseFloat($('#c-reaj').value) || 0) / 100 }); // relê cfg fresca no clique
      _sujo = false;
      toast('Config aplicada ✓'); vAdmin('unidades');
    };
    $$('.adm-un tbody tr').forEach((tr) => {
      const id = tr.dataset.id;
      const statusSel = $('.e-status', tr);
      const vendCell = $('.td-vendedor', tr);
      const toggleVend = () => { vendCell.style.visibility = statusSel.value === 'Disponível' ? 'hidden' : 'visible'; }; // vendedor só p/ Reservado/Vendido
      toggleVend();
      statusSel.onchange = () => { _sujo = true; toggleVend(); }; // escolher status/vendedor sem salvar = edição pendente
      $('.e-vendedor', tr).onchange = () => { _sujo = true; };
      $('.e-salvar', tr).onclick = () => {
        const status = statusSel.value;
        const vv = $('.e-vendedor', tr).value || '|';
        const corte = vv.indexOf('|');
        const vendedorEmpresa = status === 'Disponível' ? '' : vv.slice(0, corte);
        const vendedorNome = status === 'Disponível' ? '' : vv.slice(corte + 1);
        STORE.salvarUnidade({
          id,
          precoBase: parseFloat($('.e-preco', tr).value) || 0,
          desconto: (parseFloat($('.e-desc', tr).value) || 0) / 100,
          status,
          vendedorNome,
          vendedorEmpresa,
        });
        tr.dataset.status = status; // mantém o filtro de status coerente sem re-render
        recalcSujo(); // salvou esta linha; só libera o re-render se NENHUMA outra linha estiver com edição pendente
        toast('Unidade salva ✓');
      };
    });
    marcarSujo('.adm-un'); // digitar preço/desconto também marca edição pendente
    // busca client-side: filtra as linhas por nº da unidade ou andar (sem re-render → não perde edições)
    const linhas = $$('.adm-un tbody tr');
    // uma linha "difere" quando seus inputs não batem com o que está salvo → há edição pendente
    const linhaDifere = (tr) => {
      const u = STORE.unidadePorId(tr.dataset.id); if (!u) return false;
      const status = $('.e-status', tr).value;
      const vv = $('.e-vendedor', tr).value || '|'; const corte = vv.indexOf('|');
      const vEmp = status === 'Disponível' ? '' : vv.slice(0, corte);
      const vNome = status === 'Disponível' ? '' : vv.slice(corte + 1);
      const desc10 = (frac) => Math.round((frac || 0) * 1000); // desconto → décimos de %, a MESMA granularidade do input (toFixed(1))
      return (parseFloat($('.e-preco', tr).value) || 0) !== (u.precoBase || 0)
        || desc10((parseFloat($('.e-desc', tr).value) || 0) / 100) !== desc10(u.desconto || 0) // compara arredondado (senão dado antigo com mais casas trava _sujo p/ sempre)
        || status !== (u.status || 'Disponível')
        || vEmp !== (u.vendedorEmpresa || '') || vNome !== (u.vendedorNome || '');
    };
    const recalcSujo = () => { _sujo = linhas.some(linhaDifere); }; // mantém _sujo=true se OUTRA linha ainda tem edição
    const contarUn = () => { const vis = linhas.filter((t) => t.style.display !== 'none').length; const c = $('#un-cont'); if (c) c.textContent = vis + ' de ' + linhas.length + ' unidades'; };
    const filtrarUn = () => {
      const q = ($('#un-q').value || '').trim().toLowerCase();
      const st = ($('#un-status') || {}).value || '';
      linhas.forEach((tr) => {
        const un = (tr.children[0].textContent || '').toLowerCase();
        const andar = (tr.children[1].textContent || '').toLowerCase();
        const okBusca = (!q || un.includes(q) || andar === q || ('andar ' + andar).includes(q));
        const okStatus = (!st || (tr.dataset.status || '') === st);
        tr.style.display = (okBusca && okStatus) ? '' : 'none';
      });
      contarUn();
    };
    $('#un-q').oninput = filtrarUn;
    { const s = $('#un-status'); if (s) s.onchange = filtrarUn; }
    contarUn();
    $$('.t-fotobtn').forEach((b) => {
      b.onclick = () => $('.t-file[data-tipo="' + b.dataset.tipo + '"]').click();
    });
    $$('.t-file').forEach((inp) => {
      inp.onchange = async (e) => {
        const tipo = inp.dataset.tipo; // revalida contexto pós-await (blueprint)
        const file = e.target.files[0]; if (!file) return;
        toast('Enviando foto do tipo ' + tipo + '…');
        await STORE.anexarFotoTipo(tipo, file);
        toast('Foto do tipo ' + tipo + ' salva ✓');
        vAdmin('unidades');
      };
    });
    $$('.t-girar').forEach((b) => {
      b.onclick = async () => {
        const tipo = b.dataset.tipo;
        toast('Girando…');
        const ok = await STORE.girarFotoTipo(tipo);
        toast(ok ? 'Imagem do tipo ' + tipo + ' girada ✓' : 'Tipo ' + tipo + ' ainda sem imagem', !ok);
        vAdmin('unidades');
      };
    });
    ativarFotos();
  }

  // VENDAS (domo): muda só o STATUS + VENDEDOR das unidades (não mexe em preço). Salva direto via setVendedor.
  function aVendas() {
    const cfg = STORE.getCfg() || {};
    const uns = STORE.getUnidades().slice().sort((a, b) => String(a.unidade).padStart(5, '0') < String(b.unidade).padStart(5, '0') ? -1 : 1);
    // vendedores conhecidos: o domo não recebe o cadastro de corretores (getCfg só manda p/ admin),
    // então junta todos os corretores que aparecem nos dados que o domo JÁ vê — propostas, leads do CRM
    // e vendedores já marcados em unidades. Assim dá p/ atribuir venda a quem ainda não enviou proposta.
    const vseen = new Set(); const vendedores = [];
    const addVend = (nome, empresa) => { const n = (nome || '').trim(); if (!n) return; const e = (empresa || '').trim(); const k = e + '|' + n; if (vseen.has(k)) return; vseen.add(k); vendedores.push({ nome: n, empresa: e }); };
    STORE.getPropostas().forEach((p) => addVend(p.corretor, p.corretorEmpresa));
    STORE.getLeads().forEach((l) => addVend(l.corretorNome, l.empresaNome));
    uns.forEach((u) => addVend(u.vendedorNome, u.vendedorEmpresa));
    vendedores.sort((a, b) => a.nome.localeCompare(b.nome));
    const vendSel = (u) => { const cur = (u.vendedorEmpresa || '') + '|' + (u.vendedorNome || ''); const conhecido = vendedores.some((v) => (v.empresa + '|' + v.nome) === cur);
      return `<select class="v-vend"><option value="|">— quem vendeu?</option>${vendedores.map((v) => { const k = v.empresa + '|' + v.nome; return `<option value="${esc(k)}" ${cur === k ? 'selected' : ''}>${esc(v.nome)}${v.empresa ? ' · ' + esc(v.empresa) : ' · Domo'}</option>`; }).join('')}${(u.vendedorNome && !conhecido) ? `<option value="${esc(cur)}" selected>${esc(u.vendedorNome)}${u.vendedorEmpresa ? ' · ' + esc(u.vendedorEmpresa) : ''}</option>` : ''}</select>`; };
    const nDisp = uns.filter((u) => u.status === 'Disponível').length;
    const nRes = uns.filter((u) => u.status === 'Reservado').length;
    const nVend = uns.filter((u) => u.status === 'Vendido').length;
    $('#aba-corpo').innerHTML = `
      <div class="hist-resumo">
        <button type="button" class="chip chip-f" data-st="Disponível">Disponíveis: <b>${nDisp}</b></button>
        <button type="button" class="chip chip-f" data-st="Reservado">Reservadas: <b>${nRes}</b></button>
        <button type="button" class="chip chip-f" data-st="Vendido">Vendidas: <b>${nVend}</b></button>
        <button type="button" class="chip chip-f" data-st="">Total: <b>${uns.length}</b></button>
      </div>
      <div class="nota">Marque o <b>status</b> e <b>quem vendeu</b> cada unidade. Preços e configuração ficam com o administrador.</div>
      <div class="filtros"><input id="v-busca" placeholder="🔎 buscar unidade…" autocomplete="off"><select id="v-status"><option value="">Todos os status</option><option value="Disponível">Disponíveis</option><option value="Reservado">Reservadas</option><option value="Vendido">Vendidas</option></select></div>
      <div class="tabela-wrap"><table class="tabela adm-un">
        <thead><tr><th>Unid.</th><th>Andar</th><th>Valor</th><th>Status</th><th>Vendedor</th><th></th></tr></thead>
        <tbody>${uns.map((u) => `<tr data-id="${esc(u.id)}" data-un="${esc(String(u.unidade))}" data-status="${esc(u.status || 'Disponível')}">
          <td data-lab="Unidade"><b>${esc(u.unidade)}</b></td>
          <td data-lab="Andar">${u.andar === 0 ? 'Térreo' : u.andar + 'º'}</td>
          <td data-lab="Valor">${u.precoBase ? fmt(valorNegociadoTabela(u, cfg)) : '—'}</td>
          <td data-lab="Status"><select class="v-status">${['Disponível', 'Reservado', 'Vendido'].map((s) => `<option ${u.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
          <td data-lab="Vendedor" class="td-vendedor">${vendSel(u)}</td>
          <td class="td-salvar"><button class="btn-mini v-salvar">salvar</button></td>
        </tr>`).join('')}</tbody></table></div>`;
    const linhas = $$('.adm-un tbody tr');
    const filtrarV = () => {
      const q = ($('#v-busca').value || '').trim().toLowerCase();
      const st = ($('#v-status') || {}).value || '';
      linhas.forEach((tr) => {
        const okBusca = (!q || (tr.dataset.un || '').toLowerCase().includes(q));
        const okStatus = (!st || (tr.dataset.status || '') === st);
        tr.style.display = (okBusca && okStatus) ? '' : 'none';
      });
    };
    $('#v-busca').oninput = filtrarV;
    const pintaChips = () => { const at = ($('#v-status') || {}).value || ''; $$('.chip-f').forEach((c) => c.classList.toggle('on', c.dataset.st === at && at !== '')); };
    { const s = $('#v-status'); if (s) s.onchange = () => { filtrarV(); pintaChips(); }; }
    // chips do topo filtram a tabela (clicar no mesmo de novo limpa o filtro)
    $$('.chip-f').forEach((c) => {
      c.onclick = () => {
        const s = $('#v-status'); if (!s) return;
        s.value = (c.dataset.st && s.value === c.dataset.st) ? '' : c.dataset.st;
        filtrarV(); pintaChips();
      };
    });
    pintaChips();
    linhas.forEach((tr) => {
      const stSel = $('.v-status', tr); const vCell = $('.td-vendedor', tr);
      const toggle = () => { vCell.style.visibility = stSel.value === 'Disponível' ? 'hidden' : 'visible'; };
      toggle();
      stSel.onchange = () => { _sujo = true; toggle(); };
      $('.v-vend', tr).onchange = () => { _sujo = true; };
      $('.v-salvar', tr).onclick = async (e) => {
        const btn = e.currentTarget; if (btn.disabled) return; btn.disabled = true; const t = btn.textContent; btn.textContent = '…';
        const vv = ($('.v-vend', tr).value) || '|'; const corte = vv.indexOf('|'); const st = stSel.value;
        const vEmp = st === 'Disponível' ? '' : vv.slice(0, corte); const vNome = st === 'Disponível' ? '' : vv.slice(corte + 1);
        try { await STORE.setVendedor(tr.dataset.un, st, vNome, vEmp); tr.dataset.status = st; _sujo = false; toast('Salvo ✓'); btn.textContent = '✓ salvo'; }
        catch (err) { toast(err.message, true); btn.textContent = t; }
        finally { btn.disabled = false; setTimeout(() => { if (btn.textContent === '✓ salvo') btn.textContent = 'salvar'; }, 1500); }
      };
    });
  }

  function aPredio() {
    const cfg = STORE.getCfg() || {};
    const fotos = cfg.empFotos || [];
    const aparts = cfg.apartamentos || [];
    $('#aba-corpo').innerHTML = `
      <div class="form form-cfg">
        <label class="larga">Título<input id="e-titulo" value="${esc(cfg.empTitulo || '')}"></label>
        <label class="larga">Texto do empreendimento (um parágrafo por linha)
          <textarea id="e-texto" rows="7">${esc(cfg.empTexto || '')}</textarea></label>
        <label class="larga">Amenidades (uma por linha)
          <textarea id="e-amen" rows="7">${esc((cfg.empAmenidades || []).join('\n'))}</textarea></label>
        <button class="btn-lime" id="e-salvar">Salvar textos</button>
      </div>
      <h3>Fotos do prédio (a 1ª vira a capa — use ◀ ▶ para ordenar)</h3>
      <div class="emp-fotos-adm">
        ${fotos.map((f, i) => `<div class="emp-thumb">
          <span class="mini-foto grande" data-fotoid="${f}"></span>
          <span class="ef-idx">${i + 1}</span>
          <div class="ef-acoes">
            <button class="btn-mini ef-mv" data-id="${f}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>◀</button>
            <button class="btn-mini ef-del" data-id="${f}">✕</button>
            <button class="btn-mini ef-mv" data-id="${f}" data-dir="1" ${i === fotos.length - 1 ? 'disabled' : ''}>▶</button>
          </div></div>`).join('')}
        <button class="btn" id="ef-add">+ adicionar fotos</button>
        <input type="file" id="ef-file" accept="image/*" multiple style="display:none">
      </div>

      <h3>Apartamentos <span class="nota" style="font-weight:400">— tipos e planta humanizada; cada um vira um chip na página do prédio e a foto abre com navegação</span></h3>
      <div class="apart-adm">
        ${aparts.length ? '' : '<div class="nota">Nenhum apartamento ainda. Dê um nome (ex.: "Tipo 01 · 46 m²" ou "Planta humanizada"), escolha a foto abaixo, e ele vira um chip na página do prédio.</div>'}
        ${aparts.map((a, i) => `<div class="apart-row" data-idx="${i}">
          <span class="mini-foto grande" data-fotoid="${a.fotoId || ''}"></span>
          <input class="apart-nome" data-idx="${i}" value="${esc(a.nome || '')}" placeholder="ex.: Tipo 01 · 46 m²">
          <div class="apart-acoes">
            <button class="btn-mini ap-mv" data-idx="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>◀</button>
            <button class="btn-mini ap-troca" data-idx="${i}">📷 trocar</button>
            <button class="btn-mini ap-del" data-idx="${i}">✕</button>
            <button class="btn-mini ap-mv" data-idx="${i}" data-dir="1" ${i === aparts.length - 1 ? 'disabled' : ''}>▶</button>
          </div>
          <input type="file" class="ap-file-troca" data-idx="${i}" accept="image/*" style="display:none">
        </div>`).join('')}
        <div class="apart-novo">
          <input id="ap-nome" placeholder="nome do tipo / planta humanizada">
          <button class="btn" id="ap-add">+ adicionar (escolher foto)</button>
          <input type="file" id="ap-file" accept="image/*" style="display:none">
        </div>
      </div>

      <h3>Vincular amenidade a uma foto (clicável na página do prédio)</h3>
      <div class="amen-link">
        ${(cfg.empAmenidades || []).map((a, i) => `<div class="amen-link-row">
          <span class="amen-link-nome">${esc(a)}</span>
          <select class="amen-link-sel" data-nome="${esc(a)}">
            <option value="">— sem foto —</option>
            ${fotos.map((f, k) => `<option value="${f}" ${(cfg.amenFotos || {})[a] === f ? 'selected' : ''}>Foto ${k + 1}</option>`).join('')}
          </select>
          <span class="mini-foto amen-link-prev" data-fotoid="${(cfg.amenFotos || {})[a] || ''}"></span>
        </div>`).join('') || '<div class="nota">Salve as amenidades acima primeiro para vinculá-las a fotos.</div>'}
      </div>
      <div class="nota">A página "O Prédio" fica visível para todos os corretores no chip DIAMOND. Amenidade com foto vinculada abre a imagem ao ser tocada.</div>`;
    $('#e-salvar').onclick = () => {
      STORE.salvarCfg({
        ...STORE.getCfg(),
        empTitulo: $('#e-titulo').value,
        empTexto: $('#e-texto').value,
        empAmenidades: $('#e-amen').value.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      toast('Textos salvos ✓'); vAdmin('predio');
    };
    $('#ef-add').onclick = () => $('#ef-file').click();
    $('#ef-file').onchange = async (e) => {
      const files = [...e.target.files];
      for (const f of files) { toast('Enviando…'); await STORE.anexarFotoEmp(f); }
      toast(files.length + ' foto(s) adicionada(s) ✓');
      vAdmin('predio');
    };
    $$('.ef-del').forEach((b) => {
      b.onclick = () => { if (confirm('Remover esta foto?')) { STORE.removerFotoEmp(b.dataset.id); vAdmin('predio'); } };
    });
    $$('.ef-mv').forEach((b) => {
      b.onclick = () => { STORE.moverFotoEmp(b.dataset.id, +b.dataset.dir); vAdmin('predio'); };
    });
    $$('.amen-link-sel').forEach((s) => {
      s.onchange = () => { STORE.vincularAmenFoto(s.dataset.nome, s.value); toast('Vínculo salvo ✓'); vAdmin('predio'); };
    });
    // apartamentos (tipos + planta humanizada)
    $('#ap-add').onclick = () => {
      if (!($('#ap-nome').value || '').trim()) { toast('Dê um nome ao apartamento primeiro.', true); return; }
      $('#ap-file').click();
    };
    $('#ap-file').onchange = async (e) => {
      const nome = ($('#ap-nome').value || '').trim(); // revalida pós-await
      const file = e.target.files[0]; if (!file) return;
      toast('Enviando…'); await STORE.anexarFotoApart(nome, file);
      toast('Apartamento adicionado ✓'); vAdmin('predio');
    };
    $$('.apart-nome').forEach((inp) => {
      inp.onchange = () => { STORE.renomearApart(+inp.dataset.idx, inp.value); toast('Nome salvo ✓'); };
    });
    $$('.ap-troca').forEach((b) => { b.onclick = () => $('.ap-file-troca[data-idx="' + b.dataset.idx + '"]').click(); });
    $$('.ap-file-troca').forEach((inp) => {
      inp.onchange = async (e) => {
        const idx = +inp.dataset.idx; // revalida contexto pós-await
        const file = e.target.files[0]; if (!file) return;
        toast('Enviando…'); await STORE.trocarFotoApart(idx, file);
        toast('Foto trocada ✓'); vAdmin('predio');
      };
    });
    $$('.ap-del').forEach((b) => {
      b.onclick = () => { if (confirm('Remover este apartamento?')) { STORE.removerApart(+b.dataset.idx); vAdmin('predio'); } };
    });
    $$('.ap-mv').forEach((b) => {
      b.onclick = () => { STORE.moverApart(+b.dataset.idx, +b.dataset.dir); vAdmin('predio'); };
    });
    ativarFotos();
  }

  function aConfig() {
    const cfg = STORE.getCfg() || {};
    const f = (v, m = 100) => ((v || 0) * m);
    const parcelasStr = (Array.isArray(cfg.planoParcelas) && cfg.planoParcelas.length ? cfg.planoParcelas : [12, 24, 36]).join(', ');
    const entOptsStr = (Array.isArray(cfg.planoEntradaOpcoes) && cfg.planoEntradaOpcoes.length ? cfg.planoEntradaOpcoes : [10, 20, 30]).join(', ');
    const finOptsStr = (Array.isArray(cfg.planoFinalOpcoes) && cfg.planoFinalOpcoes.length ? cfg.planoFinalOpcoes : [30, 40, 50]).join(', ');
    $('#aba-corpo').innerHTML = `
      <h3>Plano de pagamento <span class="nota" style="font-weight:400">— o corretor MONTA escolhendo entre estas opções</span></h3>
      <div class="form form-cfg">
        <label>Entrada — opções (%)<input id="k-pentopts" value="${esc(entOptsStr)}" placeholder="10, 20, 30"><span class="nota">o corretor escolhe · separe por vírgula</span></label>
        <label>Entrada padrão (%)<input id="k-pent" type="number" step="0.5" value="${f(cfg.planoEntradaPct ?? 0.20).toFixed(1)}"><span class="nota">já vem selecionada</span></label>
        <label>Parcela final — opções (%)<input id="k-pfinopts" value="${esc(finOptsStr)}" placeholder="30, 40, 50"><span class="nota">o corretor escolhe</span></label>
        <label>Parcela final padrão (%)<input id="k-pfin" type="number" step="0.5" value="${f(cfg.planoFinalPct ?? 0.30).toFixed(1)}"><span class="nota">já vem selecionada</span></label>
        <label>Parcelas oferecidas<input id="k-pparc" value="${esc(parcelasStr)}" placeholder="12, 24, 36"><span class="nota">o corretor escolhe</span></label>
        <label>Parcela final no mês (chaves)<input id="k-ch" type="number" value="${cfg.chavesMes ?? 36}"></label>
        <label>Índice de correção<select id="k-indice">${['INCC', 'IPCA'].map((x) => `<option ${(cfg.indice || 'INCC') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Correção mensal (%)<input id="k-corr" type="number" step="0.01" value="${f(cfg.correcaoMensal).toFixed(2)}"></label>
        <label>Corrigir desde o mês<input id="k-desde" type="number" value="${cfg.correcaoDesde || 1}"></label>
        <label>Dia de vencimento<input id="k-dia" type="number" min="1" max="28" value="${cfg.diaVenc ?? 10}"></label>
      </div>
      <fieldset class="cfg-grupo">
        <legend>Balões / reforços <span class="nota" style="font-weight:400">— parcelas maiores em intervalos (ex.: 5 balões de R$ 10.000 a cada 6 meses)</span></legend>
        <div class="form form-cfg">
          <label>Quantos<input id="k-bq" type="number" value="${cfg.balQtde ?? 5}"></label>
          <label>Valor de cada (R$)<input id="k-bv" type="number" value="${cfg.balValor ?? 10000}"></label>
          <label>1º balão no mês<input id="k-bp" type="number" value="${cfg.balPrimeiro ?? 6}"></label>
          <label>Intervalo (meses)<input id="k-bi" type="number" value="${cfg.balIntervalo ?? 6}"></label>
        </div>
      </fieldset>
      <h3>Simulador &amp; corretagem <span class="nota" style="font-weight:400">— só o SEU simulador (#/sim) e a margem; NÃO afeta o corretor</span></h3>
      <div class="form form-cfg">
        <label>Corretagem (%)<input id="k-corret" type="number" step="0.1" value="${f(cfg.corretagem).toFixed(1)}"></label>
        <label>Quem paga a corretagem<select id="k-quem">${['Construtora', 'Comprador'].map((s) => `<option ${cfg.quemPaga === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Entrada inicial do simulador (%)<input id="k-ent" type="number" step="0.5" value="${f(cfg.entradaPct).toFixed(1)}"></label>
        <label>Parcela final inicial do simulador (%)<input id="k-fin" type="number" step="0.5" value="${f(cfg.finalPct).toFixed(1)}"></label>
        <label>Nº de parcelas do simulador<input id="k-np" type="number" value="${cfg.nParcelas || 30}"></label>
      </div>
      <h3>Contato &amp; reservas <span class="nota" style="font-weight:400">— para onde vão as solicitações</span></h3>
      <div class="form form-cfg">
        <label>WhatsApp da Domo<input id="k-contato" value="${esc(cfg.contatoWhats || '11972746113')}" placeholder="11972746113"><span class="nota">recebe "Solicitar reserva" e "Falar com a Domo" · com DDD, só números</span></label>
      </div>
      <fieldset class="cfg-grupo">
        <legend>Modo apresentação <span class="nota" style="font-weight:400">— o que o login de apresentação enxerga (não acessa CRM, proposta, simulador nem reserva)</span></legend>
        <div class="cli-toggles">
          <label class="uni-toggle"><input type="checkbox" id="k-cli-precos" ${cliCfg().precos ? 'checked' : ''}> Mostrar os preços na tabela</label>
          <label class="uni-toggle"><input type="checkbox" id="k-cli-predio" ${cliCfg().predio ? 'checked' : ''}> Liberar a página “O Prédio” (apresentação)</label>
          <label class="uni-toggle"><input type="checkbox" id="k-cli-pdf" ${cliCfg().baixarPdf ? 'checked' : ''}> Permitir baixar a tabela em PDF</label>
        </div>
        <div class="nota">Crie o login de apresentação em <b>ADM → Corretores</b>, na seção “Modo apresentação”.</div>
      </fieldset>
      <div class="cfg-salvar" id="k-barra">
        <span class="cfg-aviso" id="k-aviso">⚠ há alterações não salvas</span>
        <button class="btn-lime" id="k-salvar">Salvar configurações</button>
      </div>
      <h3>Minha senha</h3>
      <div class="form">
        <label>Nova senha<input id="k-senha" type="password" placeholder="mínimo 6 caracteres"></label>
        <button class="btn" id="k-senhabtn">Trocar senha</button>
      </div>`;
    $('#k-salvar').onclick = () => {
      const pparc = ($('#k-pparc').value || '').split(/[,\s]+/).map((x) => parseInt(x, 10))
        .filter((n) => n >= 1 && n <= 120).filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => a - b);
      const parsePct = (v) => (v || '').split(/[,\s]+/).map((x) => parseFloat(x)).filter((n) => n > 0 && n < 100).filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => a - b);
      const entOpts = parsePct($('#k-pentopts').value); const finOpts = parsePct($('#k-pfinopts').value);
      STORE.salvarCfg({
        ...(STORE.getCfg() || {}), // relê a cfg fresca no clique (não o snapshot do render) p/ não reverter fotos/textos
        indice: $('#k-indice').value,
        correcaoMensal: (parseFloat($('#k-corr').value) || 0) / 100,
        correcaoDesde: parseInt($('#k-desde').value) || 1,
        corretagem: (parseFloat($('#k-corret').value) || 0) / 100,
        quemPaga: $('#k-quem').value,
        entradaPct: (parseFloat($('#k-ent').value) || 0) / 100,
        finalPct: (parseFloat($('#k-fin').value) || 0) / 100,
        nParcelas: parseInt($('#k-np').value) || 30,
        planoEntradaPct: (parseFloat($('#k-pent').value) || 0) / 100,
        planoFinalPct: (parseFloat($('#k-pfin').value) || 0) / 100,
        planoEntradaOpcoes: entOpts.length ? entOpts : [10, 20, 30],
        planoFinalOpcoes: finOpts.length ? finOpts : [30, 40, 50],
        planoParcelas: pparc.length ? pparc : [12, 24, 36],
        balQtde: parseInt($('#k-bq').value) || 0,
        balValor: parseFloat($('#k-bv').value) || 0,
        balPrimeiro: parseInt($('#k-bp').value) || 6,
        balIntervalo: parseInt($('#k-bi').value) || 6,
        chavesMes: parseInt($('#k-ch').value) || 36,
        diaVenc: parseInt($('#k-dia').value) || 10,
        contatoWhats: (($('#k-contato').value || '').replace(/\D/g, '')) || '11972746113',
        cliente: { precos: $('#k-cli-precos').checked, predio: $('#k-cli-predio').checked, baixarPdf: $('#k-cli-pdf').checked },
      });
      $('#k-barra').classList.remove('sujo'); _sujo = false;
      toast('Configurações salvas ✓');
    };
    // 22 campos e um botão só lá no fim: avisa que há alteração pendente e mantém a barra visível
    $('#aba-corpo').addEventListener('input', (e) => { if (e.target.closest('.form-cfg')) { $('#k-barra').classList.add('sujo'); _sujo = true; } });
    $('#k-senhabtn').onclick = async () => {
      if (($('#k-senha').value || '').trim().length < 6) { toast('Senha muito curta (mínimo 6).', true); return; }
      try {
        const r = await STORE.api('setSenha', { senhaNova: $('#k-senha').value });
        const sess = STORE.getUser(); sess.senhaHash = r.senhaHash;
        STORE.setUser(sess, !!localStorage.getItem('dv_user')); // mantém o modo (localStorage vs sessão)
        toast('Senha trocada ✓');
      } catch (e) { toast(e.message, true); }
    };
  }

  function aCorretores() {
    const usuarios = STORE.getUsuarios();
    const admins = usuarios.filter((u) => u.papel === 'admin');
    const empresas = usuarios.filter((u) => u.papel !== 'admin' && u.papel !== 'cliente').sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
    const clientes = usuarios.filter((u) => u.papel === 'cliente').sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

    const linhaAdmin = (u) => `
      <tr data-user="${esc(u.usuario)}">
        <td><b>${esc(u.usuario)}</b></td>
        <td><input class="a-nome" value="${esc(u.nome || '')}"></td>
        <td><input class="a-tel" type="tel" inputmode="tel" value="${esc(u.telefone || '')}"></td>
        <td style="text-align:center"><input class="a-ativo" type="checkbox" ${u.ativo !== false ? 'checked' : ''}></td>
        <td><input class="a-senha" type="password" placeholder="(manter)"></td>
        <td><button class="btn-mini a-salvar">salvar</button> <button class="btn-mini btn-danger a-del" data-user="${esc(u.usuario)}">✕</button></td>
      </tr>`;

    $('#aba-corpo').innerHTML = `
      <h3>Administradores (equipe Domo)</h3>
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Login</th><th>Nome</th><th>Telefone</th><th>Ativo</th><th>Nova senha</th><th></th></tr></thead>
        <tbody>${admins.map(linhaAdmin).join('')}
          <tr class="linha-nova">
            <td><input id="na-user" placeholder="login"></td>
            <td><input id="na-nome" placeholder="nome"></td>
            <td><input id="na-tel" type="tel" inputmode="tel" placeholder="telefone"></td>
            <td style="text-align:center">✓</td>
            <td><input id="na-senha" type="password" placeholder="senha"></td>
            <td><button class="btn-mini" id="na-criar">criar</button></td>
          </tr>
        </tbody></table></div>

      <h3>Empresas / imobiliárias (login compartilhado)</h3>
      <div class="nota">Cada empresa tem UM login e <b>DUAS senhas</b>: 🔑 a do <b>master</b> (o responsável — vê os clientes de toda a equipe e gerencia os corretores) e 🔓 a da <b>equipe</b> (compartilhada; cada corretor vê só os próprios clientes). A senha usada no login é o que define o papel.</div>
      ${empresas.map((e) => `
        <div class="empresa-card${e.ativo === false ? ' empresa-travada' : ''}" data-user="${esc(e.usuario)}">
          <div class="empresa-cab">
            <input class="e-nome" value="${esc(e.nome || '')}" placeholder="nome da empresa">
            <label class="e-login-wrap">login <input class="e-login" value="${esc(e.usuario)}" placeholder="login"></label>
            <input class="e-tel" type="tel" inputmode="tel" value="${esc(e.telefone || '')}" placeholder="telefone">
            ${e.ativo === false ? '<span class="tag-travada">🔒 TRAVADA</span>' : ''}
            <button class="btn-mini e-lock" data-ativo="${e.ativo !== false}">${e.ativo !== false ? '🔒 travar' : '🔓 destravar'}</button>
            <button class="btn-mini e-salvar">salvar</button>
            <button class="btn-mini btn-danger e-del" data-user="${esc(e.usuario)}" data-nome="${esc(e.nome || e.usuario)}">excluir</button>
          </div>
          <div class="senhas-lin">
            <span class="senha-tag master">🔑 master</span><input class="e-senha" type="password" placeholder="(trocar senha do master)" autocomplete="new-password">
            <span class="senha-tag">🔓 equipe</span><input class="e-senha-eq" type="password" placeholder="(trocar senha da equipe)" autocomplete="new-password">
            ${e.temSenhaEquipe ? '<span class="tag-ok">✓ equipe tem senha</span>' : '<span class="tag-falta" title="Enquanto não houver senha de equipe, os corretores não conseguem entrar — só o master.">⚠ sem senha de equipe</span>'}
          </div>
          <div class="e-logo-lin">
            <span class="senha-tag">🖼️ logo</span>
            <span class="e-logo-prev ${e.logoId ? '' : 'vazia'}" data-logoid="${esc(e.logoId || '')}">${e.logoId ? '' : 'sem logo'}</span>
            <input type="file" class="e-logo-file" accept="image/png,image/jpeg,image/*" style="display:none">
            <button type="button" class="btn-mini e-logo-btn">${e.logoId ? 'trocar logo' : 'adicionar logo'}</button>
            ${e.logoId ? '<button type="button" class="btn-mini e-logo-del">remover</button>' : ''}
            <span class="nota">sai centralizada na proposta, abaixo da barra do plano</span>
          </div>
          <div class="corretores-box">
            <label class="cor-lbl">Corretores <span class="nota" style="font-weight:400">— clique no chip para editar; o 1º (🔑) é o master. Clique em salvar ao terminar.</span></label>
            <div class="cor-chips">
              ${(e.corretores || []).map((c, i) => `<button type="button" class="cor-chip${i === 0 ? ' chip-master' : ''}" data-i="${i}">${i === 0 ? '🔑 ' : ''}${esc(c.nome)}</button>`).join('')}
              <button type="button" class="cor-chip chip-add" data-i="novo">＋ corretor</button>
            </div>
            <div class="cor-rows">
              ${(e.corretores || []).map((c, i) => `<div class="cor-row oculto" data-i="${i}" data-nome0="${esc(c.nome)}">
                ${i === 0 ? '<span class="master-tag">master</span>' : '<span class="cor-num">' + (i + 1) + '</span>'}
                <input class="ce-nome" value="${esc(c.nome)}" placeholder="nome">
                <input class="ce-tel" type="tel" inputmode="tel" value="${esc(c.telefone || '')}" placeholder="telefone">
                <button class="btn-mini cor-del" title="remover corretor">✕ remover</button>
              </div>`).join('')}
              <div class="cor-row cor-novo oculto" data-i="novo">
                <span class="cor-num">+</span>
                <input class="ce-nome" placeholder="novo corretor: nome">
                <input class="ce-tel" type="tel" inputmode="tel" placeholder="telefone">
              </div>
            </div>
          </div>
        </div>`).join('')}

      <h3>Nova empresa</h3>
      <div class="cfg-rapida">
        <label>Login<input id="ne-user" placeholder="ex.: orbi"></label>
        <label>Nome da empresa<input id="ne-nome" placeholder="ex.: Orbi Imóveis"></label>
        <label>Telefone<input id="ne-tel" type="tel" inputmode="tel" placeholder="telefone"></label>
        <label>🔑 Senha do master<input id="ne-senha" type="password" placeholder="do responsável" autocomplete="new-password"></label>
        <label>🔓 Senha da equipe<input id="ne-senha-eq" type="password" placeholder="dos corretores (opcional)" autocomplete="new-password"></label>
        <button class="btn-lime" id="ne-criar">+ criar empresa</button>
      </div>

      <h3>Modo apresentação <span class="nota" style="font-weight:400">— login que mostra só a tabela e a apresentação do prédio ao cliente; não acessa CRM, propostas, simulador nem reservas</span></h3>
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Login</th><th>Nome</th><th>Ativo</th><th>Nova senha</th><th></th></tr></thead>
        <tbody>${clientes.map((c) => `<tr data-cliuser="${esc(c.usuario)}">
          <td><b>${esc(c.usuario)}</b></td>
          <td><input class="cl-nome" value="${esc(c.nome || '')}"></td>
          <td style="text-align:center"><input class="cl-ativo" type="checkbox" ${c.ativo !== false ? 'checked' : ''}></td>
          <td><input class="cl-senha" type="password" placeholder="(manter)" autocomplete="new-password"></td>
          <td><button class="btn-mini cl-salvar">salvar</button> <button class="btn-mini btn-danger cl-del" data-user="${esc(c.usuario)}">✕</button></td>
        </tr>`).join('')}
          <tr class="linha-nova">
            <td><input id="ncl-user" placeholder="login (ex.: apresentacao)"></td>
            <td><input id="ncl-nome" placeholder="nome"></td>
            <td style="text-align:center">✓</td>
            <td><input id="ncl-senha" type="password" placeholder="senha (mín. 6)" autocomplete="new-password"></td>
            <td><button class="btn-mini" id="ncl-criar">criar</button></td>
          </tr>
        </tbody></table></div>
      <div class="nota">Desmarcar <b>Ativo</b> revoga o acesso na hora. O que esse login enxerga se ajusta em <b>ADM → Config → Modo apresentação</b>.</div>`;

    const salvarUser = async (dados, renomeados) => {
      try { await STORE.api('upsertUsuario', { usuarioDados: dados, renomeados: renomeados || [] }); toast('Salvo ✓'); await STORE.pull(); vAdmin('corretores'); }
      catch (e) { toast(e.message, true); }
    };
    const delUser = async (usuario) => {
      if (!confirm('Excluir "' + usuario + '"?')) return;
      try { await STORE.api('delUsuario', { usuario }); toast('Excluído ✓'); await STORE.pull(); vAdmin('corretores'); }
      catch (e) { toast(e.message, true); }
    };

    $$('#aba-corpo tr[data-user]').forEach((tr) => {
      const s = $('.a-salvar', tr);
      if (s) s.onclick = () => salvarUser({ usuario: tr.dataset.user, nome: $('.a-nome', tr).value, telefone: $('.a-tel', tr).value, papel: 'admin', ativo: $('.a-ativo', tr).checked, senha: $('.a-senha', tr).value || undefined });
    });
    $$('.a-del').forEach((b) => { b.onclick = () => delUser(b.dataset.user); });
    $('#na-criar').onclick = () => salvarUser({ usuario: $('#na-user').value, nome: $('#na-nome').value, telefone: $('#na-tel').value, papel: 'admin', ativo: true, senha: $('#na-senha').value });

    // coleta os corretores das linhas editáveis do card (existentes + a linha em branco), na ordem exibida
    const corretoresDoCard = (card) => [...$$('.cor-row', card)].map((row) => ({
      nome: ($('.ce-nome', row).value || '').trim(), telefone: ($('.ce-tel', row).value || '').trim(),
    })).filter((c) => c.nome);
    // corretores cujo nome mudou → alias no servidor (leads antigos continuam visíveis p/ eles)
    const renomeadosDoCard = (card) => [...$$('.cor-row', card)].map((row) => ({ de: row.dataset.nome0 || '', para: ($('.ce-nome', row).value || '').trim() }))
      .filter((x) => x.de && x.para && x.de !== x.para);
    $$('.empresa-card').forEach((card) => {
      const usuario = card.dataset.user;
      // logo da empresa — o admin sobe direto daqui (sai na proposta, abaixo da barra)
      (async () => {
        const pv = $('.e-logo-prev', card); const fid = pv && pv.dataset.logoid;
        if (fid) { const f = await STORE.obterFoto(fid); if (f && pv) { pv.textContent = ''; pv.style.backgroundImage = `url(data:${f.mime};base64,${f.base64})`; } }
      })();
      const lFile = $('.e-logo-file', card);
      const lBtn = $('.e-logo-btn', card);
      if (lBtn) lBtn.onclick = () => lFile.click();
      if (lFile) lFile.onchange = async () => {
        const file = lFile.files && lFile.files[0]; if (!file) return;
        lBtn.disabled = true; const t = lBtn.textContent; lBtn.textContent = 'enviando…';
        try {
          const fid = await STORE.anexarLogoDe(usuario, file);
          toast('Logo salva ✓');
          const pv2 = $('.e-logo-prev', card);
          if (pv2) { pv2.dataset.logoid = fid; pv2.classList.remove('vazia'); pv2.textContent = ''; const f2 = await STORE.obterFoto(fid); if (f2) pv2.style.backgroundImage = `url(data:${f2.mime};base64,${f2.base64})`; }
          lBtn.disabled = false; lBtn.textContent = 'trocar logo';
        }
        catch (e2) { toast('Erro ao enviar a logo: ' + e2.message, true); lBtn.disabled = false; lBtn.textContent = t; }
      };
      const lDel = $('.e-logo-del', card);
      if (lDel) lDel.onclick = async () => {
        if (!confirm('Remover a logo desta empresa?')) return;
        try {
          await STORE.removerLogoDe(usuario); toast('Logo removida');
          const pv2 = $('.e-logo-prev', card);
          if (pv2) { pv2.dataset.logoid = ''; pv2.classList.add('vazia'); pv2.textContent = 'sem logo'; pv2.style.backgroundImage = ''; }
          const lb2 = $('.e-logo-btn', card); if (lb2) lb2.textContent = 'adicionar logo';
          lDel.remove();
        }
        catch (e2) { toast('Erro: ' + e2.message, true); }
      };
      $('.e-salvar', card).onclick = async (ev) => {
        const novoLogin = ($('.e-login', card).value || '').toLowerCase().trim();
        const dados = { nome: $('.e-nome', card).value, telefone: $('.e-tel', card).value, papel: 'corretor', senha: ($('.e-senha', card).value || '').trim() || undefined, senhaEquipe: ($('.e-senha-eq', card).value || '').trim() || undefined, corretores: corretoresDoCard(card) };
        const rens = renomeadosDoCard(card);
        // removeu corretor sem trocar a senha da equipe? ele ainda sabe a senha e continua entrando
        if (!dados.senhaEquipe) {
          const orig = (STORE.getUsuarios().find((x) => x.usuario === usuario) || {}).corretores || [];
          const mapa = {}; rens.forEach((x) => { mapa[x.de] = x.para; });
          const depois = new Set(dados.corretores.map((c) => c.nome));
          const removidos = orig.slice(1).map((c) => (c.nome || '').trim()).filter(Boolean).filter((n) => !depois.has(mapa[n] || n));
          if (removidos.length && !confirm('Você removeu ' + (removidos.length > 1 ? removidos.length + ' corretores' : '"' + removidos[0] + '"') + '.\n\nEssa pessoa ainda sabe a senha da equipe e continua conseguindo entrar. Para revogar o acesso, preencha "🔓 equipe" com uma senha nova neste card antes de salvar.\n\nSalvar assim mesmo (sem revogar)?')) return;
        }
        if (novoLogin && novoLogin !== usuario) {
          const btn = ev.currentTarget; if (btn.disabled) return; btn.disabled = true; // evita duplo-clique durante o rename
          if (!confirm('Mudar o login de "' + usuario + '" para "' + novoLogin + '"? Quem usa o login antigo terá que entrar com o novo.')) { btn.disabled = false; return; }
          // rename + dados numa ÚNICA chamada (atômico); server registra alias do login antigo
          try { await STORE.api('renomearUsuario', { de: usuario, para: novoLogin, usuarioDados: dados, renomeados: rens }); toast('Salvo ✓'); await STORE.pull(); vAdmin('corretores'); }
          catch (e) { toast(e.message, true); btn.disabled = false; }
        } else {
          salvarUser({ usuario, ...dados }, rens);
        }
      };
      // CHIPS: cada corretor é um chip; clicar abre só o editor dele (e clicar de novo fecha)
      const chips = $$('.cor-chip', card);
      const linhas = $$('.cor-row', card);
      const fecharTudo = () => { linhas.forEach((r) => r.classList.add('oculto')); chips.forEach((c) => c.classList.remove('on')); };
      chips.forEach((ch) => {
        ch.onclick = () => {
          if (ch.classList.contains('on')) { fecharTudo(); return; }
          fecharTudo();
          ch.classList.add('on');
          const r = linhas.find((x) => x.dataset.i === ch.dataset.i);
          if (r) { r.classList.remove('oculto'); const n = $('.ce-nome', r); if (n) n.focus(); }
        };
      });
      // ✕ remove o corretor da tela (chip + linha); persiste ao clicar em salvar
      $$('.cor-del', card).forEach((b) => {
        b.onclick = () => {
          const row = b.closest('.cor-row');
          const chip = chips.find((c) => c.dataset.i === row.dataset.i);
          if (chip) chip.remove();
          row.remove();
          _sujo = true;
        };
      });
      // 🔒 travar / 🔓 destravar (imediato, sem apagar) — só alterna 'ativo', preserva o resto
      $('.e-lock', card).onclick = () => {
        const ativo = $('.e-lock', card).dataset.ativo === 'true';
        if (ativo && !confirm('Travar "' + usuario + '"? A empresa não conseguirá entrar até você destravar (nada é apagado).')) return;
        salvarUser({ usuario, ativo: !ativo });
      };
    });
    $$('.e-del').forEach((b) => { b.onclick = async () => {
      const nome = b.dataset.nome || b.dataset.user;
      if (!confirm('EXCLUIR a empresa "' + nome + '"?\n\nO login e o acesso de TODOS os corretores dela deixam de funcionar. Os clientes já cadastrados no CRM não são apagados, mas ninguém dessa empresa conseguirá mais entrar.\n\nEssa ação não pode ser desfeita.')) return;
      try { await STORE.api('delUsuario', { usuario: b.dataset.user }); toast('Empresa excluída ✓'); await STORE.pull(); vAdmin('corretores'); }
      catch (e) { toast(e.message, true); }
    }; });
    // acesso do cliente (papel 'cliente' — só leitura da tabela/apresentação)
    $$('#aba-corpo tr[data-cliuser]').forEach((tr) => {
      const s = $('.cl-salvar', tr);
      if (s) s.onclick = () => salvarUser({ usuario: tr.dataset.cliuser, nome: $('.cl-nome', tr).value, papel: 'cliente', ativo: $('.cl-ativo', tr).checked, senha: $('.cl-senha', tr).value || undefined });
    });
    $$('.cl-del').forEach((b) => { b.onclick = () => delUser(b.dataset.user); });
    $('#ncl-criar').onclick = () => {
      const login = ($('#ncl-user').value || '').trim(), senha = $('#ncl-senha').value || '';
      if (!login || !senha) { toast('Login e senha são obrigatórios.', true); return; }
      if (senha.length < 6) { toast('A senha precisa ter no mínimo 6 caracteres.', true); return; }
      salvarUser({ usuario: login, nome: $('#ncl-nome').value || 'Apresentação', papel: 'cliente', ativo: true, senha });
    };
    $('#ne-criar').onclick = () => {
      if (!$('#ne-user').value.trim() || !$('#ne-senha').value) { toast('Login e senha do master são obrigatórios.', true); return; }
      salvarUser({ usuario: $('#ne-user').value, nome: $('#ne-nome').value || $('#ne-user').value, telefone: $('#ne-tel').value, papel: 'corretor', ativo: true, senha: $('#ne-senha').value, senhaEquipe: ($('#ne-senha-eq').value || '').trim() || undefined, corretores: [] });
    };
    marcarSujo('#aba-corpo'); // editar empresa/corretor sem salvar bloqueia o re-render do pull
  }

  function papelDe(p) {
    if (p.corretorPapel) return p.corretorPapel;
    const u = STORE.getUsuarios().find((x) => x.usuario === p.corretorUsuario);
    return (u && u.papel) || '—';
  }
  const badgePapel = (papel) => `<span class="perfil ${papel === 'admin' ? 'perfil-adm' : 'perfil-cor'}">${esc(papel)}</span>`;
  const empresaDe = (p) => {
    if (p.corretorEmpresa) return p.corretorEmpresa;
    const u = STORE.getUsuarios().find((x) => x.usuario === p.corretorUsuario);
    return (u && (u.papel !== 'admin' ? (u.nome || '') : (u.empresa || ''))) || '';
  };
  const corKey = (p) => (p.corretorUsuario || 'x') + '|' + (p.corretor || '—'); // por PESSOA (empresa tem login compartilhado)
  const histFiltro = { un: '', corretor: '', empresa: '' }; // filtros da aba Histórico (apto/corretor/empresa)
  let _histView = 'propostas'; // sub-aba do Histórico: 'propostas' | 'clientes'
  // cadastro de clientes (derivado das propostas): corretor + cliente + número
  function aHistoricoClientes(todas, toggleHTML) {
    const mapa = {};
    todas.forEach((p) => {
      const nome = (p.cliente || '').trim(); if (!nome) return;
      const tel = (p.clienteTel || '').trim();
      const k = (nome + '|' + tel).toLowerCase();
      const m = mapa[k] || (mapa[k] = { nome, tel, corretores: new Set(), n: 0, ultimo: '' });
      if (p.corretor) m.corretores.add(p.corretor + (empresaDe(p) ? ' · ' + empresaDe(p) : ''));
      m.n++; if ((p.criadoEm || '') > m.ultimo) m.ultimo = p.criadoEm || '';
    });
    const clientes = Object.values(mapa).sort((a, b) => (b.ultimo || '').localeCompare(a.ultimo || ''));
    const dtc = (x) => x ? new Date(x).toLocaleDateString('pt-BR') : '—';
    $('#aba-corpo').innerHTML = `
      ${toggleHTML}
      <div class="hist-resumo"><span class="chip">Clientes: <b>${clientes.length}</b></span></div>
      ${clientes.length ? `<div class="filtros"><input id="hc-busca" placeholder="🔎 buscar cliente, telefone ou corretor…" autocomplete="off"></div>
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Cliente</th><th>Telefone</th><th>Corretor</th><th>Propostas</th><th>Última</th><th></th></tr></thead>
        <tbody>${clientes.map((c) => {
          const cor = [...c.corretores].join(', ') || '—'; const wa = telWa(c.tel);
          return `<tr data-busca="${esc((c.nome + ' ' + c.tel + ' ' + cor).toLowerCase())}">
            <td><b>${esc(c.nome)}</b></td>
            <td>${c.tel ? esc(c.tel) : '<span class="hist-tel">—</span>'}</td>
            <td>${esc(cor)}</td>
            <td>${c.n}</td>
            <td>${dtc(c.ultimo)}</td>
            <td>${wa ? '<a class="btn-mini lead-wa" href="https://wa.me/' + wa + '" target="_blank" rel="noopener">📱</a>' : ''}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`
        : '<div class="vazio">Nenhum cliente ainda. Os clientes aparecem aqui conforme as propostas são geradas.</div>'}`;
    const hb = $('#hc-busca'); if (hb) hb.oninput = () => { const q = hb.value.trim().toLowerCase(); $$('#aba-corpo tbody tr').forEach((tr) => { tr.style.display = (!q || (tr.dataset.busca || '').includes(q)) ? '' : 'none'; }); };
  }

  function aHistorico() {
    const cfg = STORE.getCfg() || {};
    const todas = STORE.getPropostas().slice();
    const toggleHTML = `<div class="hist-toggle"><button class="ht-btn ${_histView === 'propostas' ? 'on' : ''}" data-hv="propostas">📄 Propostas</button><button class="ht-btn ${_histView === 'clientes' ? 'on' : ''}" data-hv="clientes">👥 Clientes</button></div>`;
    const ligarHistToggle = () => $$('.ht-btn').forEach((b) => { b.onclick = () => { _histView = b.dataset.hv; aHistorico(); }; });
    if (_histView === 'clientes') { aHistoricoClientes(todas, toggleHTML); ligarHistToggle(); return; }
    const unidades = [...new Set(todas.map((p) => String(p.unidade)))].sort((a, b) => a.padStart(5, '0') < b.padStart(5, '0') ? -1 : 1);
    // corretores por usuário (evita colidir homônimos)
    const corMap = {};
    todas.forEach((p) => { const k = corKey(p); (corMap[k] = corMap[k] || { key: k, nome: p.corretor || '—', empresa: empresaDe(p), papel: papelDe(p), n: 0 }).n++; });
    const corretores = Object.values(corMap).sort((a, b) => a.nome.localeCompare(b.nome));
    const empresas = [...new Set(todas.map((p) => empresaDe(p)).filter(Boolean))].sort((a, b) => a.localeCompare(b));

    // sanitiza filtros presos em valores que já não existem (após excluir/sync)
    if (histFiltro.un && !unidades.includes(histFiltro.un)) histFiltro.un = '';
    if (histFiltro.corretor && !corMap[histFiltro.corretor]) histFiltro.corretor = '';
    if (histFiltro.empresa && !empresas.includes(histFiltro.empresa)) histFiltro.empresa = '';

    const lista = todas
      .filter((p) => (!histFiltro.un || String(p.unidade) === histFiltro.un)
        && (!histFiltro.corretor || corKey(p) === histFiltro.corretor)
        && (!histFiltro.empresa || empresaDe(p) === histFiltro.empresa))
      .sort((a, b) => {
        const ua = String(a.unidade).padStart(5, '0'); const ub = String(b.unidade).padStart(5, '0');
        if (ua !== ub) return ua < ub ? -1 : 1;
        return (b.criadoEm || '').localeCompare(a.criadoEm || ''); // mais recente primeiro dentro do apto
      });

    const ranking = corretores.slice().sort((a, b) => b.n - a.n);

    // agrupa por unidade
    const grupos = {};
    lista.forEach((p) => { (grupos[String(p.unidade)] = grupos[String(p.unidade)] || []).push(p); });

    // ---------- DASHBOARD (visão geral de TODAS as propostas) ----------
    const nTotal = todas.length;
    const totalUnidades = STORE.getUnidades().length;
    const aptosComProp = new Set(todas.map((p) => String(p.unidade))).size;
    const valorTotal = todas.reduce((s, p) => s + (+p.neg || 0), 0);
    const ticket = nTotal ? valorTotal / nTotal : 0;
    const comPlano = todas.filter((p) => (p.forma || '') !== 'avista').length;
    const aVista = nTotal - comPlano;
    const fmtC = (v) => !v ? 'R$ 0'
      : v >= 1e6 ? 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi'
        : v >= 1e3 ? 'R$ ' + Math.round(v / 1e3).toLocaleString('pt-BR') + ' mil'
          : fmt(v);
    const diaKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hojeD = new Date(); hojeD.setHours(0, 0, 0, 0);
    const dias = []; for (let i = 13; i >= 0; i--) { const dd = new Date(hojeD); dd.setDate(hojeD.getDate() - i); dias.push(dd); }
    const contDia = {}; todas.forEach((p) => { if (!p.criadoEm) return; const k = diaKey(new Date(p.criadoEm)); contDia[k] = (contDia[k] || 0) + 1; });
    const maxDia = Math.max(1, ...dias.map((d) => contDia[diaKey(d)] || 0));
    const d7 = new Date(hojeD); d7.setDate(hojeD.getDate() - 6);
    const ult7 = todas.filter((p) => p.criadoEm && new Date(p.criadoEm) >= d7).length;
    const porApto = {}; todas.forEach((p) => { const k = String(p.unidade); porApto[k] = (porApto[k] || 0) + 1; });
    const topAptos = Object.entries(porApto).map(([un, n]) => ({ un, n })).sort((a, b) => b.n - a.n).slice(0, 6);
    const maxCor = Math.max(1, ...ranking.map((c) => c.n));
    const maxApto = Math.max(1, ...topAptos.map((a) => a.n));
    // ---- ranking de VENDAS (unidades fechadas) — usa o "vendedor" marcado na aba Unidades ----
    const vendidas = STORE.getUnidades().filter((u) => u.status === 'Vendido');
    const vendMap = {};
    vendidas.forEach((u) => {
      const nome = (u.vendedorNome || '').trim(); if (!nome) return;
      const emp = (u.vendedorEmpresa || '').trim();
      const k = emp + '|' + nome;
      (vendMap[k] = vendMap[k] || { nome, empresa: emp, n: 0, valor: 0, uns: [] }).n++;
      const vu = valorNegociadoTabela(u, cfg);
      vendMap[k].valor += vu;
      vendMap[k].uns.push({ unidade: u.unidade, valor: vu, andar: u.andar });
    });
    const rankingVendas = Object.values(vendMap).sort((a, b) => b.n - a.n || b.valor - a.valor);
    const vendasComDono = rankingVendas.reduce((s, v) => s + v.n, 0);
    const valorVendas = rankingVendas.reduce((s, v) => s + v.valor, 0);
    const maxVenda = Math.max(1, ...rankingVendas.map((v) => v.n));
    const barH = (label, n, max, badge) => `
      <div class="bar-row"><div class="bar-lbl" title="${esc(label)}">${esc(label)}${badge ? ' ' + badge : ''}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.round(n / max * 100))}%"></div></div>
        <div class="bar-val">${n}</div></div>`;
    const dash = nTotal ? `
      <div class="dash">
        <div class="dash-kpis">
          <div class="kpi"><div class="kpi-v">${nTotal}</div><div class="kpi-l">Propostas</div></div>
          <div class="kpi"><div class="kpi-v">${aptosComProp}${totalUnidades ? '<span class="kpi-de">/' + totalUnidades + '</span>' : ''}</div><div class="kpi-l">Aptos com proposta</div></div>
          <div class="kpi"><div class="kpi-v">${fmtC(valorTotal)}</div><div class="kpi-l">Volume proposto</div></div>
          <div class="kpi"><div class="kpi-v">${fmtC(ticket)}</div><div class="kpi-l">Ticket médio</div></div>
          <div class="kpi kpi-lime"><div class="kpi-v">${ult7}</div><div class="kpi-l">Últimos 7 dias</div></div>
          <div class="kpi kpi-venda"><div class="kpi-v">${vendidas.length}</div><div class="kpi-l">Vendidas${valorVendas ? '<span class="kpi-de"> · ' + fmtC(valorVendas) + '</span>' : ''}</div></div>
        </div>
        <div class="dash-grid">
          <div class="dash-card">
            <div class="dash-tit">Ranking de vendas <span class="dash-sub">${vendasComDono} unidade(s) fechada(s)${valorVendas ? ' · ' + fmtC(valorVendas) : ''}</span></div>
            <div class="bars">${rankingVendas.length ? rankingVendas.slice(0, 8).map((v, vi) => `
              <div class="bar-row bar-clic" data-vi="${vi}" title="clique para ver as unidades de ${esc(v.nome)}">
                <div class="bar-lbl">${esc(v.nome)}<span class="bar-emp">${v.empresa ? esc(v.empresa) : 'Domo'}</span></div>
                <div class="bar-track bar-track-v"><div class="bar-fill bar-fill-v" style="width:${Math.max(4, Math.round(v.n / maxVenda * 100))}%"></div></div>
                <div class="bar-val">${v.n}<span class="bar-chev">▾</span></div></div>
              <div class="vend-det oculto" data-vi="${vi}">
                <div class="vend-det-cab">${v.n} unidade(s) · ${fmtC(v.valor)}</div>
                ${v.uns.slice().sort((a, b) => String(a.unidade).padStart(5, '0') < String(b.unidade).padStart(5, '0') ? -1 : 1)
                  .map((x) => `<span class="vend-un"><b>${esc(String(x.unidade))}</b><i>${fmtC(x.valor)}</i></span>`).join('')}
              </div>`).join('')
              : '<div class="nota">Nenhuma venda registrada. Na aba <b>Unidades</b>, marque o status <b>Vendido</b> e escolha quem vendeu — o ranking aparece aqui.</div>'}</div>
          </div>
          <div class="dash-card">
            <div class="dash-tit">Ranking de corretores <span class="dash-sub">por propostas</span></div>
            <div class="bars">${ranking.slice(0, 8).map((c) => barH(c.nome + (c.empresa ? ' · ' + c.empresa : ''), c.n, maxCor)).join('')}</div>
          </div>
          <div class="dash-card">
            <div class="dash-tit">Propostas por dia <span class="dash-sub">últimos 14 dias</span></div>
            <div class="spark">${dias.map((d) => { const n = contDia[diaKey(d)] || 0; return `<div class="spark-col" title="${d.toLocaleDateString('pt-BR')}: ${n} proposta(s)"><div class="spark-bar${n ? '' : ' vazio'}" style="height:${n ? Math.max(10, Math.round(n / maxDia * 100)) : 3}%"></div><div class="spark-x">${d.getDate()}</div></div>`; }).join('')}</div>
          </div>
          <div class="dash-card">
            <div class="dash-tit">Forma de pagamento</div>
            <div class="seg">${comPlano ? `<div class="seg-fill seg-plano" style="width:${Math.round(comPlano / nTotal * 100)}%">${comPlano / nTotal >= 0.12 ? comPlano : ''}</div>` : ''}${aVista ? `<div class="seg-fill seg-avista" style="width:${Math.round(aVista / nTotal * 100)}%">${aVista / nTotal >= 0.12 ? aVista : ''}</div>` : ''}</div>
            <div class="seg-leg"><span><i class="dot dot-plano"></i>Com plano <b>${comPlano}</b></span><span><i class="dot dot-avista"></i>À vista <b>${aVista}</b></span></div>
          </div>
          <div class="dash-card">
            <div class="dash-tit">Apartamentos mais procurados</div>
            <div class="bars">${topAptos.map((a) => barH('Apto ' + a.un, a.n, maxApto)).join('')}</div>
          </div>
        </div>
      </div>` : '';

    $('#aba-corpo').innerHTML = `
      ${toggleHTML}
      ${dash}
      <div class="filtros">
        <input id="h-busca" placeholder="🔎 buscar cliente, telefone ou corretor…" autocomplete="off">
        <select id="h-un"><option value="">Todos os apartamentos</option>
          ${unidades.map((u) => `<option value="${esc(u)}" ${histFiltro.un === u ? 'selected' : ''}>Apto ${esc(u)}</option>`).join('')}</select>
        <select id="h-emp"><option value="">Todas as empresas</option>
          ${empresas.map((e) => `<option value="${esc(e)}" ${histFiltro.empresa === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
        <select id="h-cor"><option value="">Todos os corretores</option>
          ${corretores.filter((c) => !histFiltro.empresa || c.empresa === histFiltro.empresa).map((c) => `<option value="${esc(c.key)}" ${histFiltro.corretor === c.key ? 'selected' : ''}>${esc(c.nome)}${c.empresa ? ' — ' + esc(c.empresa) : ''}</option>`).join('')}</select>
        ${(histFiltro.un || histFiltro.corretor || histFiltro.empresa) ? '<button class="btn-mini" id="h-limpar">limpar filtros</button>' : ''}
      </div>
      ${Object.keys(grupos).length ? Object.keys(grupos).sort((a, b) => String(a).padStart(5, '0') < String(b).padStart(5, '0') ? -1 : 1).map((un) => `
        <div class="hist-grupo">
          <div class="hist-grupo-cab">Apto ${esc(un)} <span class="hist-grupo-n">${grupos[un].length} proposta(s)</span><span class="grupo-chevron">▾</span></div>
          <div class="tabela-wrap"><table class="tabela">
            <thead><tr><th>Data</th><th>Cliente</th><th>Corretor</th><th>Perfil</th><th>Valor</th><th>Forma</th><th></th></tr></thead>
            <tbody>${grupos[un].map((p) => `
              <tr data-busca="${esc(((p.cliente || '') + ' ' + (p.clienteTel || '') + ' ' + (p.corretor || '') + ' ' + (empresaDe(p) || '')).toLowerCase())}">
                <td>${fmtData(p.criadoEm)}</td>
                <td>${esc(p.cliente)}${p.clienteTel ? '<br><span class="hist-tel">' + esc(p.clienteTel) + '</span>' : ''}</td>
                <td>${esc(p.corretor)}${empresaDe(p) ? '<br><span class="hist-tel">' + esc(empresaDe(p)) + '</span>' : ''}</td>
                <td>${badgePapel(papelDe(p))}</td>
                <td>${fmt(p.neg)}</td>
                <td>${esc(p.formaLabel || p.forma)}</td>
                <td class="hist-acoes">
                  <button class="btn-mini p-abrir" data-uid="${esc(p.unidadeId)}" data-pid="${esc(p.id)}">abrir</button>
                  <button class="btn-mini p-del" data-id="${esc(p.id)}">excluir</button>
                </td>
              </tr>`).join('')}</tbody>
          </table></div>
        </div>`).join('')
      : '<div class="vazio">nenhuma proposta ' + (histFiltro.un || histFiltro.corretor || histFiltro.empresa ? 'com esse filtro' : 'gerada ainda') + '</div>'}`;

    $('#h-un').onchange = (e) => { histFiltro.un = e.target.value; vAdmin('historico'); };
    $('#h-emp').onchange = (e) => { histFiltro.empresa = e.target.value; histFiltro.corretor = ''; vAdmin('historico'); }; // troca empresa zera o corretor (podia ser de outra)
    $('#h-cor').onchange = (e) => { histFiltro.corretor = e.target.value; vAdmin('historico'); };
    if ($('#h-limpar')) $('#h-limpar').onclick = () => { histFiltro.un = ''; histFiltro.corretor = ''; histFiltro.empresa = ''; vAdmin('historico'); };
    $$('.p-abrir').forEach((b) => { b.onclick = () => { location.hash = '#/sim/' + encodeURIComponent(b.dataset.uid) + '?p=' + encodeURIComponent(b.dataset.pid); }; }); // sem onclick inline (evita XSS via campos da proposta)
    $$('.p-del').forEach((b) => { b.onclick = () => { if (confirm('Excluir esta proposta do histórico?')) { STORE.excluirProposta(b.dataset.id); vAdmin('historico'); } }; });
    $$('.hist-grupo-cab').forEach((cab) => { cab.onclick = () => cab.closest('.hist-grupo').classList.toggle('recolhido'); }); // clica p/ recolher o apto
    // ranking de vendas: clicar no corretor abre a lista das unidades que ele fechou
    $$('.bar-clic').forEach((r) => {
      r.onclick = () => {
        const d = $$('.vend-det').find((x) => x.dataset.vi === r.dataset.vi);
        if (!d) return;
        const abrindo = d.classList.contains('oculto');
        $$('.vend-det').forEach((x) => x.classList.add('oculto'));           // só um aberto por vez
        $$('.bar-clic').forEach((x) => x.classList.remove('aberto'));
        if (abrindo) { d.classList.remove('oculto'); r.classList.add('aberto'); }
      };
    });
    // busca textual client-side (sem re-render → não perde o foco): esconde linhas e aptos sem resultado
    $('#h-busca').oninput = (e) => {
      const q = (e.target.value || '').trim().toLowerCase();
      $$('.hist-grupo').forEach((g) => {
        let visiveis = 0;
        $$('tbody tr', g).forEach((tr) => { const ok = !q || (tr.dataset.busca || '').includes(q); tr.style.display = ok ? '' : 'none'; if (ok) visiveis++; });
        g.style.display = visiveis ? '' : 'none';
      });
    };
    ligarHistToggle();
  }

  // painel de ENVIOS: links de proposta enviados por WhatsApp — aberturas + respostas do cliente
  async function aEnvios() {
    $('#aba-corpo').innerHTML = '<div class="nota">carregando envios…</div>';
    let envios = [];
    try { const r = await STORE.api('listEnvios'); envios = r.envios || []; }
    catch (e) { $('#aba-corpo').innerHTML = '<div class="aviso">Erro ao carregar: ' + esc(e.message) + '</div>'; return; }
    envios.sort((a, b) => (Number(b.numero) || 0) - (Number(a.numero) || 0) || (String(b.em || '') < String(a.em || '') ? -1 : 1)); // nº mais alto (mais recente) no topo
    const cont = (e, t) => (e.eventos || []).filter((x) => x.tipo === t).length;
    const dt = (x) => x ? new Date(x).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const totViews = envios.reduce((s, e) => s + (e.views || 0), 0);
    const totInt = envios.reduce((s, e) => s + cont(e, 'interesse'), 0);
    const totDuv = envios.reduce((s, e) => s + cont(e, 'duvida'), 0);
    $('#aba-corpo').innerHTML = `
      <div class="hist-resumo">
        <span class="chip">Propostas enviadas: <b>${envios.length}</b></span>
        <span class="chip">Aberturas: <b>${totViews}</b></span>
        <span class="chip">✅ Interesses: <b>${totInt}</b></span>
        <span class="chip">💬 Dúvidas: <b>${totDuv}</b></span>
        <button class="btn-mini" id="env-refresh">atualizar</button>
      </div>
      ${envios.length ? `<div class="filtros"><input id="env-busca" placeholder="buscar por nº, cliente, apto ou corretor…"></div>
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Nº</th><th>Enviado</th><th>Cliente</th><th>Apto</th><th>Corretor</th><th>Aberturas</th><th>Última</th><th>Cliente respondeu</th><th></th></tr></thead>
        <tbody>${envios.map((e) => {
          const inter = cont(e, 'interesse'), duv = cont(e, 'duvida'), pdf = cont(e, 'abriu_pdf');
          const resp = [inter ? '<span class="perfil perfil-adm">✅ interesse</span>' : '', duv ? '<span class="perfil perfil-cor">💬 dúvida</span>' : ''].filter(Boolean).join(' ') || '<span class="hist-tel">—</span>';
          const nn = e.numero ? '#' + String(e.numero).padStart(3, '0') : '—';
          return `<tr data-busca="${esc((nn + ' ' + String(e.numero || '') + ' ' + (e.cliente || '') + ' ' + (e.unidade || '') + ' ' + (e.corretor || '')).toLowerCase())}">
            <td><b>${nn}</b></td>
            <td>${dt(e.em)}</td>
            <td>${esc(e.cliente || '—')}</td>
            <td>${esc(e.unidade || '—')}</td>
            <td>${esc(e.corretor || '—')}${e.empresa ? '<br><span class="hist-tel">' + esc(e.empresa) + '</span>' : ''}</td>
            <td><b>${e.views || 0}</b>${pdf ? ' <span class="hist-tel">· ' + pdf + '× PDF</span>' : ''}</td>
            <td>${dt(e.lastView)}</td>
            <td>${resp}</td>
            <td><button class="btn-mini env-ver" data-id="${esc(e.id)}">ver link</button> <button class="btn-mini env-copy" data-id="${esc(e.id)}">📋 copiar</button>${STORE.isAdmin() ? ' <button class="btn-mini env-del" data-id="' + esc(e.id) + '">✕</button>' : ''}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`
      : '<div class="vazio">Nenhum link enviado ainda. Os links criados no botão <b>“Enviar link no WhatsApp”</b> aparecem aqui com quantas vezes o cliente abriu e se respondeu (interesse/dúvida).</div>'}`;
    $('#env-refresh').onclick = () => aEnvios();
    const eb = $('#env-busca'); if (eb) eb.oninput = () => { const q = eb.value.trim().toLowerCase(); $$('#aba-corpo tbody tr').forEach((tr) => { tr.style.display = (!q || (tr.dataset.busca || '').includes(q)) ? '' : 'none'; }); };
    $$('.env-ver').forEach((b) => { b.onclick = () => window.open(window.P_URL + '/' + b.dataset.id + '?preview=1', '_blank'); }); // ?preview não conta como abertura do cliente
    $$('.env-copy').forEach((b) => { b.onclick = async () => { const url = window.P_URL + '/' + b.dataset.id; try { await navigator.clipboard.writeText(url); toast('Link copiado ✓'); } catch (err) { window.prompt('Copie o link:', url); } }; });
    $$('.env-del').forEach((b) => { b.onclick = async () => { if (!confirm('Excluir este envio (o link deixa de funcionar)?')) return; try { await STORE.api('delEnvio', { id: b.dataset.id }); toast('Envio removido ✓'); aEnvios(); } catch (e) { toast(e.message, true); } }; });
  }

  async function aSaude() {
    $('#aba-corpo').innerHTML = '<div class="painel" id="saude-card">consultando a nuvem…</div>';
    let html = '';
    try {
      const s = await STORE.api('saude');
      html += `<div class="ok-linha">✅ Nuvem OK — ${s.totalUnidades} unidades · ${s.totalPropostas} propostas · tabela ${esc(s.tabela)}</div>`;
    } catch (e) { html += `<div class="aviso">❌ Nuvem com erro: ${esc(e.message)}</div>`; }
    const fila = STORE.filaGet();
    html += `<div>Fila local pendente: <b>${fila.length}</b> ${fila.length ? '(' + fila.map((x) => x.action).join(', ') + ')' : ''}</div>`;
    html += '<button class="btn" id="sd-sync">Sincronizar agora</button> <button class="btn" id="sd-diag">Diagnóstico Blobs</button> <span id="sd-out"></span>';
    $('#saude-card').innerHTML = html;
    $('#sd-sync').onclick = async () => { await STORE.retentarTudo(); await STORE.pull(render); toast('Sync disparado ✓'); vAdmin('saude'); };
    $('#sd-diag').onclick = async () => { try { const d = await STORE.api('diag'); $('#sd-out').textContent = 'blobs: ' + d.auto; } catch (e) { $('#sd-out').textContent = e.message; } };
  }

  // ---------- roteador ----------
  // ===== SCP (Sociedade em Conta de Participação) — aba exclusiva do cadastro da Domo =====
  const ehLoginDomo = () => (STORE.getUser() || {}).usuario === 'domo';
  let _scp = { unidadeId: '', desc10: false, p12: false, p2412: false, corr: '', cliente: '', tel: '' };
  function scpCalcular(base, o, cfg) {
    base = +base || 0;
    const corrPct = Math.max(0, Math.min(100, parseFloat(String(o.corr).replace(',', '.')) || 0));
    const desc = o.desc10 ? base * 0.10 : 0;     // 10% de DESCONTO sobre o valor de tabela
    const valor = base - desc;                    // valor negociado (o cliente paga isto; o parcelamento incide sobre ele)
    const corrValor = valor * corrPct / 100;      // corretagem sobre o valor negociado
    const liquido = valor - corrValor;            // corretagem DEDUZ do que a Domo recebe
    const incc = (cfg && cfg.correcaoMensal) || 0;
    const pNom = valor / 24;
    return { base, desc, valor, corrPct, corrValor, liquido,
      p12: valor / 12, pNom, p13: pNom * Math.pow(1 + incc, 1), p24: pNom * Math.pow(1 + incc, 12),
      marcado: o.desc10 || o.p12 || o.p2412 || corrPct > 0 };
  }
  function scpResumoHTML(base, o, cfg) {
    if (!base) return '<div class="nota">Escolha a unidade para calcular.</div>';
    const s = scpCalcular(base, o, cfg); const idx = esc((cfg && cfg.indice) || 'INCC');
    if (!s.marcado) return '<div class="nota">Marque as opções acima para montar o cálculo.</div>';
    const L = [`<div><span>Valor de tabela</span><b>${fmt(s.base)}</b></div>`];
    if (o.desc10) { L.push(`<div><span>Desconto 10%</span><b class="txt-desc">− ${fmt(s.desc)}</b></div>`); L.push(`<div><span>Valor negociado</span><b>${fmt(s.valor)}</b></div>`); }
    if (o.p12) L.push(`<div><span>12x sem juros</span><b>${fmt(s.p12, 2)}/mês</b></div>`);
    if (o.p2412) { L.push(`<div><span>12+12 · 1ª–12ª (fixas)</span><b>${fmt(s.pNom, 2)}/mês</b></div>`); L.push(`<div><span>12+12 · 13ª–24ª (${idx})</span><b>${fmt(s.p13, 2)} → ${fmt(s.p24, 2)}/mês</b></div>`); }
    if (s.corrPct > 0) { L.push(`<div><span>Corretagem ${String(s.corrPct).replace('.', ',')}%</span><b class="txt-desc">− ${fmt(s.corrValor)}</b></div>`); L.push(`<div><span>Líquido (Domo recebe)</span><b>${fmt(s.liquido)}</b></div>`); }
    const notas = [];
    if (o.p2412) notas.push('As 12 últimas parcelas são corrigidas por ' + idx + ' (estimativa pela taxa mensal atual).');
    if (s.corrPct > 0) notas.push('A corretagem deduz do valor que a Domo recebe.');
    // valor em DESTAQUE: com desconto mostra o valor negociado grande (+ tabela riscado); senão o valor de tabela
    const destaque = `<div class="scp-destaque"><span>${o.desc10 ? 'VALOR · com 10% de desconto' : 'VALOR DE TABELA'}</span><b>${fmt(o.desc10 ? s.valor : s.base)}</b>${o.desc10 ? '<s>de ' + fmt(s.base) + '</s>' : ''}</div>`;
    return destaque + `<div class="linhas uni-plano">${L.join('')}</div>${notas.length ? '<div class="nota">' + notas.join(' ') + '</div>' : ''}`;
  }
  function scpMsgTexto(unidade, base, o, cfg) {
    const s = scpCalcular(base, o, cfg); const idx = (cfg && cfg.indice) || 'INCC';
    let t = `*SCP · Edifício Diamond — Unidade ${unidade}*\n\nValor de tabela: ${fmt(s.base)}\n`;
    if (o.desc10) t += `Desconto 10%: − ${fmt(s.desc)} → valor negociado ${fmt(s.valor)}\n`;
    if (o.p12) t += `• 12x sem juros: ${fmt(s.p12, 2)}/mês\n`;
    if (o.p2412) t += `• 12 + 12: ${fmt(s.pNom, 2)}/mês — as 12 últimas corrigidas por ${idx}\n`;
    if (s.corrPct > 0) t += `Corretagem ${String(s.corrPct).replace('.', ',')}%: − ${fmt(s.corrValor)} (líquido ${fmt(s.liquido)})\n`;
    return t;
  }
  function vScp() {
    const cfg = STORE.getCfg() || {};
    const uns = STORE.getUnidades().slice().sort((a, b) => String(a.unidade).padStart(5, '0') < String(b.unidade).padStart(5, '0') ? -1 : 1).filter((x) => x.precoBase);
    const u = _scp.unidadeId ? STORE.unidadePorId(_scp.unidadeId) : null;
    const base = u ? valorNegociadoTabela(u, cfg) : 0;
    app().innerHTML = `
      <div class="sim">
        <a class="volta" href="#/home">← espelho</a>
        <div class="painel">
          <h2>SCP <span class="nota" style="font-weight:400">— Sociedade em Conta de Participação</span></h2>
          <div class="form">
            <label>Unidade
              <select id="scp-unidade">
                <option value="">— escolha a unidade —</option>
                ${uns.map((x) => `<option value="${esc(x.id)}" ${x.id === _scp.unidadeId ? 'selected' : ''}>${esc(x.unidade)} · ${x.andar === 0 ? 'Térreo' : x.andar + 'º'} · ${fmt(valorNegociadoTabela(x, cfg))}${x.status !== 'Disponível' ? ' · ' + x.status : ''}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="scp-box">
            <label class="scp-opt"><input type="checkbox" id="scp-desc" ${_scp.desc10 ? 'checked' : ''}> Desconto 10% <small>sobre o valor de tabela</small></label>
            <label class="scp-opt"><input type="checkbox" id="scp-12" ${_scp.p12 ? 'checked' : ''}> 12x sem juros</label>
            <label class="scp-opt"><input type="checkbox" id="scp-2412" ${_scp.p2412 ? 'checked' : ''}> 12 + 12 <small>INCC nas 12 últimas</small></label>
            <label class="scp-corr">Corretagem <small>deduz do valor</small> <span><input type="number" id="scp-corr" min="0" max="100" step="0.5" inputmode="decimal" value="${esc(_scp.corr)}" placeholder="0"> %</span></label>
          </div>
          <div class="scp-res" id="scp-res">${scpResumoHTML(base, _scp, cfg)}</div>
          <div class="form">
            <label>Cliente <span class="nota" style="font-weight:400">(opcional)</span><input id="scp-cliente" value="${esc(_scp.cliente)}" placeholder="nome do cliente"></label>
            <label>Telefone <span class="nota" style="font-weight:400">(opcional)</span><input id="scp-tel" type="tel" inputmode="tel" value="${esc(_scp.tel)}" placeholder="(34) 9 9999-9999"></label>
          </div>
          <div class="acoes">
            <button class="btn btn-whats" id="scp-whats">Enviar no WhatsApp</button>
            <button class="btn btn-sec" id="scp-pdf">📄 Baixar PDF</button>
          </div>
        </div>
      </div>`;
    $('#scp-unidade').onchange = (e) => { _scp.unidadeId = e.target.value; vScp(); };
    const reScp = () => { const r = $('#scp-res'); if (r) r.innerHTML = scpResumoHTML(base, _scp, cfg); };
    $('#scp-desc').onchange = (e) => { _scp.desc10 = e.target.checked; reScp(); };
    $('#scp-12').onchange = (e) => { _scp.p12 = e.target.checked; reScp(); };
    $('#scp-2412').onchange = (e) => { _scp.p2412 = e.target.checked; reScp(); };
    $('#scp-corr').oninput = (e) => { _scp.corr = e.target.value; reScp(); };
    $('#scp-cliente').oninput = (e) => { _scp.cliente = e.target.value; };
    $('#scp-tel').oninput = (e) => { _scp.tel = e.target.value; };
    const validaScp = () => { if (!u) { toast('Escolha a unidade primeiro.', true); return false; } if (!scpCalcular(base, _scp, cfg).marcado) { toast('Marque ao menos uma opção.', true); return false; } return true; };
    // registra a proposta SCP no Histórico (salvarProposta) E no CRM (crmRegistrar) — só se houver nome do cliente
    const registrarScp = async () => {
      const nome = _scp.cliente.trim(); if (!nome) return null;
      const usr = ator(); const s = scpCalcular(base, _scp, cfg);
      const nrm = (x) => (x || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      STORE.salvarProposta({
        id: 'p-scp-' + u.unidade + '-' + nrm(nome).replace(/[^a-z0-9]/g, ''), // id estável (formato p-… exigido pelo servidor); reenvio atualiza, não duplica
        unidadeId: u.id, unidade: u.unidade, area: u.area,
        cliente: nome, clienteTel: _scp.tel.trim(),
        corretor: usr.nome, corretorUsuario: usr.usuario, corretorTel: usr.telefone || '', corretorPapel: usr.papel, corretorEmpresa: usr.empresa || '',
        neg: s.valor, forma: 'scp', formaLabel: 'SCP',
        inp: { forma: 'scp', desc10: _scp.desc10, p12: _scp.p12, p2412: _scp.p2412, corr: _scp.corr },
        criadoEm: new Date().toISOString(),
      });
      return crmRegistrar({ cliente: nome, clienteTel: _scp.tel, unidade: u.unidade, estagio: 'proposta' });
    };
    $('#scp-pdf').onclick = async () => {
      if (!validaScp()) return;
      const btn = $('#scp-pdf'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'gerando…';
      try { const { doc, nome } = await gerarPdfScp(u, base, _scp, cfg, ator(), _scp.cliente.trim(), _scp.tel.trim()); doc.save(nome); await registrarScp(); toast('PDF gerado ✓' + (_scp.cliente.trim() ? ' · cliente salvo 👥' : '')); }
      catch (e) { toast('Erro ao gerar o PDF: ' + e.message, true); }
      finally { btn.disabled = false; btn.textContent = t; }
    };
    // WhatsApp: gera o PDF → hospeda → manda saudação + resumo + LINK (o cliente abre a landing com o PDF)
    $('#scp-whats').onclick = async () => {
      if (!validaScp()) return;
      if (!_scp.tel.trim()) { toast('Preencha o telefone do cliente para enviar no WhatsApp.', true); return; }
      const win = window.open('about:blank', '_blank'); // pré-abre no clique (evita bloqueio de popup)
      const btn = $('#scp-whats'); btn.disabled = true; const t = btn.textContent; btn.textContent = 'gerando…';
      try {
        const usr = ator();
        const { doc } = await gerarPdfScp(u, base, _scp, cfg, usr, _scp.cliente.trim(), _scp.tel.trim());
        const cr = await registrarScp(); // Histórico + CRM
        const base64 = doc.output('datauristring').split(',')[1];
        const link = await STORE.enviarPropostaPdf(base64, { unidade: u.unidade, valor: base, area: u.area || 0, andar: u.andar, cliente: _scp.cliente, corretor: usr.nome, corretorTel: usr.telefone, empresa: usr.empresa, propostaId: 'scp-' + Date.now() + '-' + u.unidade, leadId: (cr && cr.id) || '' });
        const saud = _scp.cliente.trim() ? `Olá ${_scp.cliente.trim()}! 😊 ` : '';
        const msg = saud + scpMsgTexto(u.unidade, base, _scp, cfg) + `\n\n📄 Abra a proposta completa aqui: ${link}` + (usr.nome ? `\n\nQualquer dúvida, estou à disposição!\n${usr.nome}${usr.telefone ? ' — ' + usr.telefone : ''}` : '');
        const url = 'https://wa.me/' + telWa(_scp.tel) + '?text=' + encodeURIComponent(msg);
        if (win) win.location.href = url; else window.open(url, '_blank');
        toast('WhatsApp aberto' + (cr && cr.acao === 'novo' ? ' · cliente salvo no CRM 👥' : '') + ' ✓');
      } catch (e) { if (win) win.close(); toast('Erro: ' + e.message, true); }
      finally { btn.disabled = false; btn.textContent = t; }
    };
  }

  // ===== RETORNO — rentabilidade da unidade = ALUGUEL + VALORIZAÇÃO (SÓ adm/Domo, interna; fora do fluxo do corretor) =====
  let _ret = { unidadeId: '', alug: 3000, custos: 20, valorizAA: 10, mesesEntrega: 30, cdi: 10.5 };
  try { const s = JSON.parse(localStorage.getItem('dv_ret2') || 'null'); if (s && typeof s === 'object') _ret = { ..._ret, ...s }; } catch (e) { /* defaults */ }
  function retSave() { try { localStorage.setItem('dv_ret2', JSON.stringify({ alug: _ret.alug, custos: _ret.custos, valorizAA: _ret.valorizAA, mesesEntrega: _ret.mesesEntrega, cdi: _ret.cdi })); } catch (e) { /* ignora */ } }
  function retCalc(valor) {
    const alugMes = parseFloat(_ret.alug) || 0;                         // aluguel base R$/mês (fixo, editável)
    const alugAno = alugMes * 12;
    const yBruto = valor ? alugAno / valor : 0;
    const rendaLiqAno = alugAno * (1 - (parseFloat(_ret.custos) || 0) / 100);
    const yLiq = valor ? rendaLiqAno / valor : 0;                       // rentabilidade da LOCAÇÃO (líquida) a.a.
    const valorizAA = (parseFloat(_ret.valorizAA) || 0) / 100;          // valorização do imóvel a.a.
    const valorizAno = valor * valorizAA;
    const rentTotal = yLiq + valorizAA;                                 // RENTABILIDADE TOTAL = aluguel + valorização
    const ganho1ano = rendaLiqAno + valorizAno;
    // projeção até a entrega (juros compostos sobre a taxa a.a.)
    const meses = Math.max(0, parseFloat(_ret.mesesEntrega) || 0);
    const anos = meses / 12;
    const valorEntrega = valor * Math.pow(1 + valorizAA, anos);
    const valorizPeriodo = valorEntrega - valor;
    const valorizPeriodoPct = valor ? valorizPeriodo / valor : 0;
    // payback: só o aluguel (caixa) vs aluguel + valorização (papel, só realiza na venda)
    const paybackAlug = rendaLiqAno ? valor / rendaLiqAno : 0;
    const paybackTotal = (rendaLiqAno + valorizAno) ? valor / (rendaLiqAno + valorizAno) : 0;
    return { alugMes, alugAno, yBruto, rendaLiqAno, yLiq, valorizAA, valorizAno, rentTotal, ganho1ano,
      meses, anos, valorEntrega, valorizPeriodo, valorizPeriodoPct, paybackAlug, paybackTotal };
  }
  const pctBR = (frac, casas = 1) => (frac * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
  function retResumoHTML(valor) {
    if (!valor) return '<div class="nota">Escolha a unidade para calcular o retorno.</div>';
    const r = retCalc(valor);
    const cdi = parseFloat(_ret.cdi) || 0;
    const pp = r.rentTotal * 100 - cdi; // rentabilidade total (aluguel + valorização) vs CDI
    const destaque = `<div class="scp-destaque"><span>RENTABILIDADE TOTAL ESTIMADA · a.a.</span><b>${pctBR(r.rentTotal)}</b></div>`;
    const L = [
      `<div><span>= aluguel + valorização</span><b>${pctBR(r.yLiq)} + ${pctBR(r.valorizAA)}</b></div>`,
      `<div><span>Valor da unidade</span><b>${fmt(valor)}</b></div>`,
      `<div><span>Aluguel</span><b>${fmt(r.alugMes)}/mês</b></div>`,
      `<div><span>Renda de aluguel (líquida/ano)</span><b>${fmt(r.rendaLiqAno)}</b></div>`,
      `<div><span>Valorização do imóvel/ano</span><b>+ ${fmt(r.valorizAno)}</b></div>`,
      `<div><span>Ganho no 1º ano (aluguel + valorização)</span><b>${fmt(r.ganho1ano)}</b></div>`,
      `<div><span>Rentabilidade total vs CDI</span><b class="${pp < 0 ? 'txt-desc' : ''}">${pp >= 0 ? '+' : ''}${pp.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.</b></div>`,
    ];
    return destaque + `<div class="linhas uni-plano">${L.join('')}</div><div class="nota">Rentabilidade = renda de aluguel + valorização do imóvel. Estimativa interna, premissas editáveis acima; custos (${(parseFloat(_ret.custos) || 0).toLocaleString('pt-BR')}% do aluguel) já descontados.</div>`;
  }
  // quanto o imóvel vale PRONTO (projeção até a entrega) — o valor é editável e a taxa a.a. se ajusta sozinha
  function retValorizHTML(valor) {
    if (!valor) return '<div class="nota">Escolha a unidade acima.</div>';
    const r = retCalc(valor);
    const destaque = `<div class="scp-destaque"><span>VALOR ESTIMADO QUANDO PRONTO</span><b>${fmt(r.valorEntrega)}</b></div>`;
    const L = [
      `<div><span>Valor hoje (tabela)</span><b>${fmt(valor)}</b></div>`,
      `<div><span>Valorização no período (${r.meses.toLocaleString('pt-BR')} meses)</span><b>+ ${fmt(r.valorizPeriodo)} · ${pctBR(r.valorizPeriodoPct)}</b></div>`,
      `<div><span>Equivale a</span><b>${pctBR(r.valorizAA)} a.a.</b></div>`,
    ];
    return destaque + `<div class="linhas uni-plano">${L.join('')}</div><div class="nota">Edite o <b>valor quando pronto</b> acima para fixar quanto ele vai valer — a taxa anual se recalcula sozinha. Ou mexa na taxa (% a.a.) que o valor se ajusta.</div>`;
  }
  function retPaybackHTML(valor) {
    if (!valor) return '<div class="nota">Escolha a unidade acima.</div>';
    const r = retCalc(valor);
    const anosTxt = (x) => (x && isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' anos' : '—');
    const L = [
      `<div><span>Só com o aluguel (renda líquida)</span><b>${anosTxt(r.paybackAlug)}</b></div>`,
      `<div><span>Com aluguel + valorização</span><b>${anosTxt(r.paybackTotal)}</b></div>`,
      `<div><span>Renda de aluguel por ano</span><b>${fmt(r.rendaLiqAno)}</b></div>`,
      `<div><span>Valorização por ano</span><b>+ ${fmt(r.valorizAno)}</b></div>`,
    ];
    return `<div class="linhas uni-plano">${L.join('')}</div><div class="nota">O aluguel é caixa que entra todo mês; a valorização só vira dinheiro na venda — por isso os dois prazos separados.</div>`;
  }
  function vRetorno() {
    const cfg = STORE.getCfg() || {};
    const uns = STORE.getUnidades().slice().sort((a, b) => String(a.unidade).padStart(5, '0') < String(b.unidade).padStart(5, '0') ? -1 : 1).filter((x) => x.precoBase);
    const u = _ret.unidadeId ? STORE.unidadePorId(_ret.unidadeId) : null;
    const valor = u ? valorNegociadoTabela(u, cfg) : 0;
    app().innerHTML = `
      <div class="sim">
        <a class="volta" href="#/home">← espelho</a>
        <div class="painel">
          <h2>Retorno do investimento <span class="nota" style="font-weight:400">— análise interna (adm / Domo)</span></h2>
          <div class="form">
            <label>Unidade
              <select id="ret-unidade">
                <option value="">— escolha a unidade —</option>
                ${uns.map((x) => `<option value="${esc(x.id)}" ${x.id === _ret.unidadeId ? 'selected' : ''}>${esc(x.unidade)} · ${x.andar === 0 ? 'Térreo' : x.andar + 'º'} · ${x.area ? x.area.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m²' : ''} · ${fmt(valorNegociadoTabela(x, cfg))}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="form form-cfg ret-params">
            <label>Aluguel (R$/mês)<input id="ret-alug" type="number" step="50" inputmode="decimal" value="${esc(String(_ret.alug))}"></label>
            <label>Custos (% do aluguel)<input id="ret-custos" type="number" step="1" value="${esc(String(_ret.custos))}"><span class="nota">IPTU, adm, vacância</span></label>
            <label>Valorização (% a.a.)<input id="ret-valoriz" type="number" step="0.5" value="${esc(String(Math.round((parseFloat(_ret.valorizAA) || 0) * 10) / 10))}"></label>
            <label>Prazo até a entrega (meses)<input id="ret-meses" type="number" step="1" value="${esc(String(_ret.mesesEntrega))}"></label>
            <label>CDI (% a.a.)<input id="ret-cdi" type="number" step="0.1" value="${esc(String(_ret.cdi))}"></label>
          </div>
          <div class="scp-res" id="ret-res">${retResumoHTML(valor)}</div>

          <h3>Valorização — quanto vai valer pronto</h3>
          <div class="form form-cfg">
            <label>Valor quando pronto (R$)<input id="ret-ventrega" type="number" step="1000" inputmode="decimal" value="${valor ? Math.round(retCalc(valor).valorEntrega) : ''}"><span class="nota">edite para fixar o valor final</span></label>
          </div>
          <div class="scp-res" id="ret-val">${retValorizHTML(valor)}</div>

          <h3>Payback</h3>
          <div class="scp-res" id="ret-pay">${retPaybackHTML(valor)}</div>
        </div>
      </div>`;
    const valAtual = () => { const uu = _ret.unidadeId ? STORE.unidadePorId(_ret.unidadeId) : null; return uu ? valorNegociadoTabela(uu, cfg) : 0; };
    // repinta os 3 blocos; syncV=true também atualiza o campo "valor quando pronto" (não fazer isso enquanto ele é digitado)
    const reRender = (syncV) => {
      const v = valAtual();
      const a = $('#ret-res'); if (a) a.innerHTML = retResumoHTML(v);
      const b = $('#ret-val'); if (b) b.innerHTML = retValorizHTML(v);
      const c = $('#ret-pay'); if (c) c.innerHTML = retPaybackHTML(v);
      if (syncV) { const i = $('#ret-ventrega'); if (i) i.value = v ? Math.round(retCalc(v).valorEntrega) : ''; }
    };
    $('#ret-unidade').onchange = (e) => { _ret.unidadeId = e.target.value; vRetorno(); };
    const bind = (sel, campo) => { const el = $(sel); if (el) el.oninput = (e) => { _ret[campo] = e.target.value; retSave(); reRender(true); }; };
    bind('#ret-alug', 'alug'); bind('#ret-custos', 'custos'); bind('#ret-valoriz', 'valorizAA');
    bind('#ret-meses', 'mesesEntrega'); bind('#ret-cdi', 'cdi');
    // digitar o VALOR quando pronto → recalcula a taxa a.a. equivalente (caminho inverso)
    $('#ret-ventrega').oninput = (e) => {
      const v = valAtual(); const alvo = parseFloat(e.target.value) || 0;
      const meses = Math.max(1, parseFloat(_ret.mesesEntrega) || 1);
      if (v > 0 && alvo > 0) {
        // guarda a taxa com precisão TOTAL (p/ o valor projetado bater exatamente com o digitado)
        // e mostra arredondada no campo de %, que é só exibição
        _ret.valorizAA = (Math.pow(alvo / v, 12 / meses) - 1) * 100;
        const iv = $('#ret-valoriz'); if (iv) iv.value = Math.round(_ret.valorizAA * 10) / 10;
        retSave();
      }
      reRender(false); // não mexe no campo que está sendo digitado
    };
  }

  function render() {
    _painelEquipe = false; // qualquer render de rota sai do painel de equipe (fora de rota)
    _sujo = false; // navegação explícita = a pessoa saiu da edição
    document.body.classList.remove('tema-predio');
    const _fab = $('#fab-domo'); if (_fab) _fab.remove(); // só reaparece nas telas do "site" (espelho/unidade)
    renderTopo();
    const h = location.hash || '#/home';
    if (!STORE.getUser() && h !== '#/login') { location.hash = '#/login'; return; }
    if (h === '#/login') { $('#topo').innerHTML = ''; vLogin(); return; }
    const _u = STORE.getUser();
    // CLIENTE: só enxerga a tabela e (se liberado) a apresentação — qualquer outra rota cai na tabela
    if (_u && _u.papel === 'cliente') {
      if (h === '#/predio' && cliCfg().predio) { vPredio(); return; }
      if (h !== '#/home') { location.hash = '#/home'; return; } // normaliza a URL (o hashchange repinta)
      vHome(); return;
    }
    if (_u && _u.papel !== 'admin') {
      // master de 1º acesso: explica as 2 senhas e cria a da equipe antes de qualquer coisa
      if (_u.ehMaster && !_u.temSenhaEquipe) { vPrimeiroAcessoMaster(); return; }
      const _cors = (_u.corretores || []).filter((c) => (c.nome || '').trim());
      if (_u.ehMaster) {
        // entrou com a senha do master → ele É o 1º corretor (responsável); não passa pelo seletor
        if (!(_u.corretorAtivo && _u.corretorAtivo.nome) && _cors[0]) { STORE.setCorretorAtivo(_cors[0].nome, _cors[0].telefone); renderTopo(); } // repinta: o topo já tinha sido desenhado sem o corretor
      } else if (_cors.length > 1 && !(_u.corretorAtivo && _u.corretorAtivo.nome)) {
        vEscolherCorretor(); return; // equipe: escolhe quem está acessando (entre os NÃO-master)
      }
    }
    if (h === '#/predio') { vPredio(); return; }
    if (h === '#/clientes') { vClientes(); return; }
    if (h === '#/scp') { if (ehLoginDomo()) vScp(); else location.hash = '#/home'; return; } // SCP: só o cadastro da Domo
    if (h === '#/retorno') { if (STORE.isAdmin() || ehLoginDomo()) vRetorno(); else location.hash = '#/home'; return; } // Retorno: análise interna adm/Domo
    if (h === '#/historico') { vHistoricoEquipe(); return; }
    const mSim = h.match(/^#\/sim\/([^?]+)(\?p=(.+))?$/);
    if (mSim) {
      const uid = decodeURIComponent(mSim[1]);
      if (STORE.isAdmin()) vSim(uid, mSim[3] ? decodeURIComponent(mSim[3]) : null);
      else vUnidade(uid); // corretor: tela estática (sem cálculo de venda)
      return;
    }
    const mAdm = h.match(/^#\/admin\/(\w+)/);
    if (mAdm) { vAdmin(mAdm[1]); return; }
    vHome();
  }

  window.addEventListener('hashchange', render);
  window.addEventListener('beforeunload', (e) => { if (_sujo) { e.preventDefault(); e.returnValue = ''; } }); // fechar/recarregar com edição pendente
  STORE.on('sync', atualizaSync);
  // leads mudaram (pull/sync trouxe novidade) → repinta só a lista do CRM, sem re-render da rota
  STORE.on('dados', (d) => { if (d && d.tipo === 'leads' && !_sujo && _crm.lista && $(_crm.lista)) crmPinta(); });
  STORE.iniciar(() => {
    const h = location.hash;
    if (_sujo) return; // há edição não salva na tela (ex.: vendedor/preço escolhidos, card do CRM em digitação) — não re-renderiza
    if (_painelEquipe || h.startsWith('#/sim/') || document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return; // não destruir digitação nem o painel de equipe (fora de rota)
    render();
  });
  render();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
