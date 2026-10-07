// Regras da proposta sem dependência do estado da tela ou alterações nos registros.
(function (root) {
  'use strict';

  const texto = value => typeof value === 'string' ? value.trim() : '';
  const numero = value => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  };
  const opcional = (value, fallback) => value == null || value === '' ? fallback : numero(value);

  function tabela(dados, valor, desconto) {
    const base = numero(valor), desc = opcional(desconto, 0);
    if (base == null || base < 0 || desc == null || desc < 0 || desc > 1) return null;
    const neg = base * (1 - desc);
    if (!Number.isFinite(neg)) return null;
    return { ...dados, valorTabela: base, desconto: desc, neg };
  }

  function mesmaTabela(a, b) {
    // IDs diferentes não se tornam a mesma tabela por um rótulo reaproveitado.
    if (a.tabelaId && b.tabelaId) return a.tabelaId === b.tabelaId;
    return !!(a.versao || a.dataTabela) && a.versao === b.versao && a.dataTabela === b.dataTabela;
  }

  function tabelas(u, cfg = {}, historico = []) {
    if (!u || typeof u !== 'object') return [];
    cfg = cfg || {};
    const result = [];
    const adicionar = item => {
      if (item && !result.some(anterior => mesmaTabela(anterior, item))) result.push(item);
    };
    const base = numero(u.precoBase);
    const reajuste = u.precoVersao ? 0 : opcional(cfg.reajuste, 0);
    if (base != null && reajuste != null && reajuste >= 0) {
      adicionar(tabela({
        key: 'atual', tabelaId: texto(cfg.tabelaId) || texto(u.precoVersao) || null,
        versao: texto(cfg.versao), dataTabela: texto(cfg.dataTabela), origem: 'atual', observacao: '',
      }, base * (1 + reajuste), u.desconto));
    }

    const registros = (Array.isArray(historico) ? historico : []).filter(h => h && typeof h === 'object');
    const itemDaUnidade = h => (Array.isArray(h.itens) ? h.itens : []).find(item => item &&
      (u.id != null ? item.id != null && String(item.id) === String(u.id)
        : u.unidade != null && item.id == null && String(item.unidade) === String(u.unidade)));
    const historica = (h, antes) => {
      const item = itemDaUnidade(h);
      if (!item) return null;
      const meta = (antes ? h.cfgAntes : h.cfgDepois) || {};
      const tabelaId = texto(meta.tabelaId) || (!antes ? texto(h.id) : '') || null;
      const versao = texto(meta.versao) || texto(antes ? h.versaoAnterior : h.versaoNova);
      const dataTabela = texto(meta.dataTabela) || (!antes ? texto(h.dataTabela) : '');
      if (!tabelaId && !versao && !dataTabela) return null;
      const reconstruida = antes && !tabelaId;
      return tabela({
        key: tabelaId ? 'tabela:' + tabelaId : 'versao:' + JSON.stringify([versao, dataTabela]),
        tabelaId, versao, dataTabela, origem: reconstruida ? 'reconstruida' : 'historico',
        observacao: reconstruida
          ? 'Tabela anterior reconstruída a partir dos preços base registrados no histórico.'
          : texto(h.observacao),
      }, antes ? item.anterior : item.novo, item.desconto);
    };
    // A tabela criada é a referência da versão. O "antes" de outro reajuste
    // pode já incluir edições individuais posteriores, por isso entra só depois.
    registros.forEach(h => adicionar(historica(h, false)));
    registros.forEach(h => adicionar(historica(h, true)));
    return result;
  }

  function diluir(inp = {}) {
    const n = numero(inp.nParcelas);
    if (!Number.isInteger(n) || n <= 0) throw Error('Informe um número inteiro de parcelas mensais maior que zero para diluir.');
    return { ...inp, forma: 'perso', finalPct: 0, balQtde: 0, balValor: 0 };
  }

  function comissao(inp = {}, cfg = {}, neg) {
    inp = inp || {}; cfg = cfg || {};
    const valorNegociado = numero(neg);
    if (valorNegociado == null || valorNegociado < 0) throw Error('Valor negociado inválido para calcular a comissão.');
    const salvo = opcional(inp.corretagemPct, null), configurado = opcional(cfg.corretagem, 0);
    const percentual = inp.semComissao === true ? 0
      : inp.corretagemPct != null && inp.corretagemPct !== '' ? salvo
        : configurado == null ? null : configurado * 100;
    if (percentual == null || percentual < 0 || percentual > 100) throw Error('Percentual de comissão inválido.');
    const quemPaga = texto(inp.quemPagaCorretagem) || texto(cfg.quemPaga);
    const valor = valorNegociado * (percentual / 100);
    const liquido = valorNegociado - (quemPaga === 'Construtora' ? valor : 0);
    return { percentual, valor, quemPaga, liquido };
  }

  root.DiamondProposta = Object.freeze({ tabelas, diluir, comissao });
})(typeof window !== 'undefined' ? window : globalThis);
