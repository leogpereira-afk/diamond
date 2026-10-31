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

  // A conferência corrige uma referência bruta, nunca o preço de um contrato.
  // Não se pode inferir essa referência dividindo a base pelo desconto: no legado
  // existem tanto bases brutas quanto bases que já embutem uma negociação.
  function referencia(u) {
    const r = u?.precoTabelaReferencia;
    if (r === undefined) return null;
    const falha = () => { throw Error('A referência conferida da tabela precisa de revisão.'); };
    if (!r || r.modelo !== 1 || typeof r.precoBase !== 'number' || !Number.isFinite(r.precoBase) || r.precoBase < 0 ||
        !Number.isSafeInteger(Math.round(r.precoBase * 100)) || Math.abs(r.precoBase * 100 - Math.round(r.precoBase * 100)) > .00001 ||
        !texto(r.versao) || !texto(r.fonte) || texto(r.fonte).length > 600 ||
        (r.tabelaId !== null && (typeof r.tabelaId !== 'string' || !texto(r.tabelaId))) ||
        typeof r.conferidoEm !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(r.conferidoEm) || !Number.isFinite(Date.parse(r.conferidoEm))) falha();
    const p = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r.dataTabela || '');
    if (!p) falha();
    const iso = `${p[3]}-${p[2]}-${p[1]}`, d = new Date(iso + 'T12:00:00Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== iso) falha();
    return r;
  }

  function precoAncorado(r, alvo, historico) {
    const conferir = () => { throw Error('Não foi possível conferir a referência e o histórico da tabela vigente.'); };
    const porId = new Map(historico.map(h => [h.id, h])), vistos = new Set(), fatores = [];
    let atual = alvo || {};
    while (!(r.tabelaId ? r.tabelaId === atual.tabelaId : mesmaTabela(r, atual))) {
      const id = texto(atual.tabelaId);
      if (!id || vistos.has(id)) conferir();
      vistos.add(id);
      const h = porId.get(id), pct = Number(h?.percentual);
      if (!h || !h.cfgAntes || !Number.isFinite(pct) || pct <= 0 || pct > 1000) conferir();
      fatores.unshift(1 + pct / 100); atual = h.cfgAntes;
    }
    let valor = r.precoBase;
    for (const fator of fatores) {
      valor = Math.round((valor * fator + Number.EPSILON) * 100) / 100;
      if (!Number.isFinite(valor) || !Number.isSafeInteger(Math.round(valor * 100))) conferir();
    }
    return valor;
  }

  function precoReferencia(u, alvo, historico = []) {
    const r = referencia(u); return r ? precoAncorado(r,alvo,historico) : null;
  }

  function origemConferida(u) {
    const r = referencia(u), origem = u?.precoTabelaOrigem;
    if (!r || !origem || origem.referenciaConferidaEm !== r.conferidoEm) return null;
    if (typeof origem.precoBase !== 'number' || !Number.isFinite(origem.precoBase) || origem.precoBase < 0 ||
        !Number.isSafeInteger(Math.round(origem.precoBase * 100)) ||
        (origem.tabelaId !== null && (typeof origem.tabelaId !== 'string' || !texto(origem.tabelaId))))
      throw Error('A origem conferida da reserva precisa de revisão.');
    return origem;
  }

  function precoAtualConferido(u, cfg, historico = []) {
    const r = referencia(u); if (!r) return null;
    const origem = origemConferida(u);
    // A price deliberately edited while available remains the current price.
    // Its reservation snapshot is trusted only when captured after this audit.
    if (u.status === 'Disponível' && u.precoVersao && u.precoVersao === cfg.tabelaId) {
      const n = numero(u.precoBase);
      if (n == null || n < 0 || !Number.isSafeInteger(Math.round(n * 100))) throw Error('Confira o preço atual da unidade.');
      return n;
    }
    return precoAncorado(origem ? {...r,precoBase:origem.precoBase,tabelaId:origem.tabelaId} : r,cfg,historico);
  }

  function tabelas(u, cfg = {}, historico = []) {
    if (!u || typeof u !== 'object') return [];
    cfg = cfg || {};
    const result = [];
    const adicionar = item => {
      if (item && !result.some(anterior => mesmaTabela(anterior, item))) result.push(item);
    };
    const registros = (Array.isArray(historico) ? historico : []).filter(h => h && typeof h === 'object');
    const ref = referencia(u);
    // On first render the chain may still be loading. Never show/save the old
    // negotiated base as the current table while the reference is unresolved.
    let base = ref ? null : numero(u.precoBase);
    if(ref){try{base=precoAtualConferido(u,cfg,registros);}catch(e){if(registros.length)throw e;}}
    const reajuste = u.precoVersao ? 0 : opcional(cfg.reajuste, 0);
    if (base != null && reajuste != null && reajuste >= 0) {
      adicionar(tabela({
        key: 'atual', tabelaId: texto(cfg.tabelaId) || texto(u.precoVersao) || null,
        versao: texto(cfg.versao), dataTabela: texto(cfg.dataTabela), origem: 'atual', observacao: ref ? 'Preço bruto conferido; reajustes aplicados por versão.' : '',
      }, base * (1 + reajuste), u.desconto));
    }

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
        tabelaId, versao, dataTabela, origem: ref ? 'conferida' : reconstruida ? 'reconstruida' : 'historico',
        observacao: ref ? 'Preço bruto conferido; reajustes aplicados por versão.' : reconstruida
          ? 'Tabela anterior reconstruída a partir dos preços base registrados no histórico.'
          : texto(h.observacao),
      }, ref ? precoReferencia(u,{tabelaId,versao,dataTabela},registros) : antes ? item.anterior : item.novo, item.desconto);
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

  root.DiamondProposta = Object.freeze({ tabelas, diluir, comissao, referencia, precoReferencia, origemConferida, precoAtualConferido });
})(typeof window !== 'undefined' ? window : globalThis);
