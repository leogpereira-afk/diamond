// Referências de tabela da venda. O cliente envia somente a chave da escolha;
// valores e metadados são lidos novamente no servidor e congelados no contrato.
const texto = value => typeof value === 'string' ? value.trim() : '';
const numero = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
};
const opcional = (value, fallback) => value == null || value === '' ? fallback : numero(value);
const mesma = (a, b) => a.tabelaId && b.tabelaId ? a.tabelaId === b.tabelaId
  : !!(a.versao || a.dataTabela) && a.versao === b.versao && a.dataTabela === b.dataTabela;
export function tabelasDaVenda(unidade, cfg = {}, historico = []) {
  if (!unidade || typeof unidade !== 'object') return [];
  cfg ||= {};
  const escolhas = [];
  const adicionar = (dados, valor, desconto, fonte) => {
    const base = numero(valor), desc = opcional(desconto, 0);
    if (base == null || base < 0 || desc == null || desc < 0 || desc > 1) return;
    const neg = base * (1 - desc); if (!Number.isFinite(neg)) return;
    const tabela = { ...dados, valorTabela: base, desconto: desc, neg };
    if (!escolhas.some(e => mesma(e.tabela, tabela))) escolhas.push({ tabela, fonte });
  };
  const base = numero(unidade.precoBase), reajuste = unidade.precoVersao ? 0 : opcional(cfg.reajuste, 0);
  if (base != null && reajuste != null && reajuste >= 0) adicionar({
    key: 'atual', tabelaId: texto(cfg.tabelaId) || texto(unidade.precoVersao) || null,
    versao: texto(cfg.versao), dataTabela: texto(cfg.dataTabela), origem: 'atual', observacao: '',
  }, base * (1 + reajuste), unidade.desconto, { store: 'cfg', key: 'cfg', valor: cfg });
  const registros = historico.filter(r => r?.valor && typeof r.valor === 'object');
  const historica = (row, antes) => {
    const h = row.valor;
    const item = (Array.isArray(h.itens) ? h.itens : []).find(item => item &&
      (unidade.id != null ? item.id != null && String(item.id) === String(unidade.id)
        : unidade.unidade != null && item.id == null && String(item.unidade) === String(unidade.unidade)));
    if (!item) return;
    const meta = (antes ? h.cfgAntes : h.cfgDepois) || {};
    const tabelaId = texto(meta.tabelaId) || (!antes ? texto(h.id) : '') || null;
    const versao = texto(meta.versao) || texto(antes ? h.versaoAnterior : h.versaoNova);
    const dataTabela = texto(meta.dataTabela) || (!antes ? texto(h.dataTabela) : '');
    if (!tabelaId && !versao && !dataTabela) return;
    const reconstruida = antes && !tabelaId;
    adicionar({
      key: tabelaId ? 'tabela:' + tabelaId : 'versao:' + JSON.stringify([versao, dataTabela]),
      tabelaId, versao, dataTabela, origem: reconstruida ? 'reconstruida' : 'historico',
      observacao: reconstruida ? 'Tabela anterior reconstruída a partir dos preços base registrados no histórico.' : texto(h.observacao),
    }, antes ? item.anterior : item.novo, item.desconto, { store: 'precos_historico', key: row.key, valor: h });
  };
  registros.forEach(h => historica(h, false));
  registros.forEach(h => historica(h, true));
  return escolhas;
}
