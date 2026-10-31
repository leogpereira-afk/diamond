/* Identidade de exibição de corretores. Não altera cadastros, históricos ou permissões. */
(function (root) {
  'use strict';
  const texto = value => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizar = value => texto(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const login = value => texto(value).toLowerCase();
  const preferirGrafia = (a, b) => {
    // Prefere uma grafia já existente e legível; não inventa capitalização de nomes.
    const peso = s => (s !== s.toUpperCase() && s !== s.toLowerCase() ? 4 : 0) + (s.normalize('NFD') !== s ? 1 : 0);
    return peso(b) > peso(a) || (peso(b) === peso(a) && b < a) ? b : a;
  };

  function catalogo({ usuarios = [], propostas = [], leads = [], unidades = [], reservas = [], empresaPadrao = '' } = {}) {
    const empresas = usuarios.filter(u => u && u.papel !== 'admin' && u.papel !== 'cliente' && login(u.usuario));
    const administradores = new Set(usuarios.filter(u => u?.papel === 'admin').flatMap(u => [u.usuario, ...(u.loginsAntigos || [])]).map(login));
    const porLogin = new Map(), porNome = new Map(), pessoas = new Map();
    for (const u of empresas) {
      porLogin.set(login(u.usuario), u);
      for (const antigo of u.loginsAntigos || []) if (!porLogin.has(login(antigo))) porLogin.set(login(antigo), u);
      const k = normalizar(u.nome);
      if (k) porNome.set(k, [...(porNome.get(k) || []), u]);
    }
    const empresaDe = (empresa, usuario) => {
      let id = login(usuario);
      // A autoria administrativa antiga não era uma imobiliária. Nas telas que
      // já exibem empresa vazia como Domo, une a apresentação sem mudar seu dono.
      if (empresaPadrao && administradores.has(id) && (!texto(empresa) || normalizar(empresa) === normalizar(empresaPadrao))) id = '';
      const nome = texto(empresa) || (!id ? texto(empresaPadrao) : '');
      const candidatas = porNome.get(normalizar(nome)) || [];
      // Um login explícito prevalece. Nomes ambíguos não escolhem uma empresa arbitrária.
      const u = id ? porLogin.get(id) : candidatas.length === 1 ? candidatas[0] : null;
      return u
        ? { chave: 'usuario:' + login(u.usuario), empresa: texto(u.nome), empresaUsuario: u.usuario, cadastro: u }
        : { chave: id ? 'usuario:' + id : 'empresa:' + normalizar(nome), empresa: nome, empresaUsuario: id, cadastro: null };
    };
    const referencia = (nome, empresa, usuario) => {
      let n = texto(nome);
      if (!n) return null;
      const e = empresaDe(empresa, usuario);
      const atuais = (e.cadastro?.corretores || []).map(c => texto(c.nome)).filter(Boolean);
      const atual = atuais.find(c => normalizar(c) === normalizar(n));
      if (atual) n = atual;
      else {
        const alias = Object.entries(e.cadastro?.corretorAliases || {}).find(([antigo]) => normalizar(antigo) === normalizar(n));
        const destino = alias && atuais.find(c => normalizar(c) === normalizar(alias[1]));
        if (destino) n = destino;
      }
      return { chave: JSON.stringify([e.chave, normalizar(n)]), nome: n, empresa: e.empresa, empresaUsuario: e.empresaUsuario, cadastrado: atuais.some(c => normalizar(c) === normalizar(n)) };
    };
    const adicionar = (nome, empresa, usuario) => {
      const item = referencia(nome, empresa, usuario);
      if (!item) return;
      const anterior = pessoas.get(item.chave);
      if (!anterior || (!anterior.cadastrado && item.cadastrado)) pessoas.set(item.chave, item);
      else if (!anterior.cadastrado) {
        anterior.nome = preferirGrafia(anterior.nome, item.nome);
        anterior.empresa = preferirGrafia(anterior.empresa, item.empresa);
      }
    };
    for (const u of empresas) for (const c of u.corretores || []) adicionar(c.nome, u.nome, u.usuario);
    for (const p of propostas) adicionar(p.corretor, p.corretorEmpresa, p.corretorUsuario);
    for (const l of leads) adicionar(l.corretorNome, l.empresaNome, l.empresaUsuario);
    for (const u of unidades) adicionar(u.vendedorNome, u.vendedorEmpresa, u.vendedorUsuario);
    for (const r of reservas) adicionar(r.corretor, r.empresa, r.empresaUsuario || r.usuario);
    const resolver = (nome, empresa = '', usuario = '') => {
      const item = referencia(nome, empresa, usuario);
      return item && (pessoas.get(item.chave) || item);
    };
    return {
      lista: [...pessoas.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.empresa.localeCompare(b.empresa, 'pt-BR') || a.empresaUsuario.localeCompare(b.empresaUsuario, 'pt-BR')),
      resolver,
      chave: (nome, empresa = '', usuario = '') => referencia(nome, empresa, usuario)?.chave || '',
    };
  }
  root.DiamondCorretores = { normalizar, catalogo };
})(typeof window !== 'undefined' ? window : globalThis);
