import { sb, getStore } from '../_shared/blobs-shim.mjs';
import crypto from 'node:crypto';

const hash = value => crypto.createHash('sha256').update(canonico(value)).digest('hex');
const canonico = value => value && typeof value === 'object'
  ? Array.isArray(value) ? '[' + value.map(canonico).join(',') + ']' : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonico(value[k])).join(',') + '}'
  : JSON.stringify(value);
const moeda = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const publicaCfg = ({ corretorGeralHash, ...cfg }) => cfg;
const erro = (mensagem, status = 400) => Object.assign(new Error(mensagem), { status });
const metadados = c => ({ versao: c.versao || 'v1', dataTabela: c.dataTabela || '', reajuste: Number(c.reajuste) || 0, tabelaId: c.tabelaId || null, precosRevisao: Number(c.precosRevisao) || 0 });

function parametros(b) {
  if (!['reajustar', 'regularizar'].includes(b.modo)) throw erro('Escolha reajustar ou regularizar a tabela.');
  if (b.percentual === '' || b.percentual == null || !Number.isFinite(Number(b.percentual)) || Number(b.percentual) <= 0 || Number(b.percentual) > 1000) throw erro('Informe um percentual maior que zero e de até 1000%.');
  const data = String(b.dataTabela || ''), partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data);
  if (!partes) throw erro('Informe a data da tabela no formato dia/mês/ano.');
  const [, dia, mes, ano] = partes, d = new Date(`${ano}-${mes}-${dia}T12:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.getUTCFullYear() !== +ano || d.getUTCMonth() + 1 !== +mes || d.getUTCDate() !== +dia) throw erro('Informe uma data válida para a tabela.');
  return { modo: b.modo, percentual: Number(b.percentual), dataTabela: data };
}

function preparar(cfg, unidades, args) {
  const legado = Number(cfg.reajuste || 0);
  if (!Number.isFinite(legado) || legado < 0 || legado > 10) throw erro('O reajuste antigo precisa de conferência antes de gerar a tabela.', 409);
  if (args.modo === 'reajustar' && legado !== 0) throw erro('Regularize primeiro o reajuste antigo para não aplicá-lo duas vezes.', 409);
  if (args.modo === 'regularizar' && (!legado || Math.abs(args.percentual - legado * 100) > 0.000001)) throw erro('O reajuste antigo mudou ou já foi regularizado. Atualize a tela.', 409);
  const revisao = Math.max(Number(cfg.precosRevisao) || 0, Number(/^v(\d+)$/i.exec(String(cfg.versao || ''))?.[1]) || 1) + 1;
  const itens = unidades.map(u => {
    const base = Number(u.precoBase || 0), desconto = Number(u.desconto || 0);
    if (!Number.isFinite(base) || base < 0 || !Number.isFinite(desconto) || desconto < 0 || desconto > 1) throw erro(`Confira o preço e o desconto da unidade ${u.unidade}.`, 409);
    // Existing records can contain fractions of a cent. Preserve the exact source
    // values in the comparison and round only the newly calculated available price.
    const anterior = base, elegivel = u.status === 'Disponível' && base > 0;
    const novo = elegivel ? moeda(anterior * (1 + args.percentual / 100)) : anterior;
    const exibidoAntes = anterior * (1 + legado);
    if (!Number.isSafeInteger(Math.round(novo * 100))) throw erro(`O novo preço da unidade ${u.unidade} excede o limite permitido.`);
    return { id: u.id, unidade: u.unidade, status: u.status, anterior, novo, exibidoAntes, diferenca: Number((novo - anterior).toFixed(10)), desconto, alterada: novo !== anterior, corrigida: args.modo === 'regularizar' && !elegivel && exibidoAntes !== novo };
  });
  const cfgAntes = metadados(cfg);
  const preview = { ...args, cfgAntes, versaoAnterior: cfgAntes.versao, versaoNova: 'v' + revisao, precosRevisao: revisao, itens,
    qtdAlteradas: itens.filter(x => x.alterada).length, qtdPreservadas: itens.filter(x => !x.alterada).length, qtdCorrigidas: itens.filter(x => x.corrigida).length,
    totalAnterior: moeda(itens.reduce((s, x) => s + x.anterior, 0)), totalNovo: moeda(itens.reduce((s, x) => s + x.novo, 0)),
    origem: args.modo === 'regularizar' ? 'regularizacao_legado' : 'reajuste',
    observacao: args.modo === 'regularizar' ? 'Comparação reconstruída a partir dos preços base e do percentual antigo. A data deste registro é a regularização; não comprova quando o reajuste original foi aplicado.' : 'Reajuste aplicado somente às unidades disponíveis nesta tabela.' };
  return { ...preview, token: hash({ args, cfg, unidades }) };
}

async function lerEstado() {
  const [cfg, linhas] = await Promise.all([getStore('cfg').get('cfg', { type: 'json' }), getStore('unidades').listJSON()]);
  if (!cfg) throw erro('A configuração da tabela ainda não está disponível.', 409);
  const unidades = linhas.map(x => x.valor).filter(Boolean).sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  return { cfg, unidades };
}

async function respostaRepetida(b, args, hist, json, estado) {
  const existente = await hist.get(b.operacaoId, { type: 'json' });
  if (!existente) return null;
  if (existente.solicitacaoHash !== hash({ args, token: b.token })) throw erro('Este identificador já foi usado em outra operação.', 409);
  const atual = estado || await lerEstado();
  const { solicitacaoHash, token, ...historico } = existente;
  return json(200, { ok: true, repetida: true, cfg: publicaCfg(atual.cfg), unidades: atual.unidades, historico });
}

export async function executarPrecos(b, usr, json) {
  try {
    const hist = getStore('precos_historico');
    if (b.action === 'precosHistorico') {
      const historico = (await hist.listJSON()).map(x => x.valor).filter(Boolean).sort((a, z) => String(z.criadoEm).localeCompare(String(a.criadoEm)));
      return json(200, { ok: true, historico: historico.map(({ solicitacaoHash, token, ...h }) => h) });
    }
    const args = parametros(b);
    if (b.action === 'precosAplicar') {
      if (!/^[\w-]{16,100}$/.test(String(b.operacaoId || '')) || !/^[a-f0-9]{64}$/.test(String(b.token || ''))) throw erro('Reabra a prévia antes de confirmar a tabela.');
      const repetida = await respostaRepetida(b, args, hist, json);
      if (repetida) return repetida;
    }
    const { cfg, unidades } = await lerEstado();
    // Another identical request may have committed while the reads were in flight.
    if (b.action === 'precosAplicar') {
      const repetida = await respostaRepetida(b, args, hist, json, { cfg, unidades });
      if (repetida) return repetida;
    }
    const preview = preparar(cfg, unidades, args);
    if (b.action === 'precosPrevia') return json(200, { ok: true, previa: preview });
    if (preview.token !== b.token) throw erro('A tabela ou as unidades mudaram. Revise a nova comparação antes de confirmar.', 409);
    const em = new Date().toISOString(), id = b.operacaoId;
    const novaCfg = { ...cfg, reajuste: 0, versao: preview.versaoNova, dataTabela: args.dataTabela, precosRevisao: preview.precosRevisao, precosModelo: 1, tabelaId: id, atualizadoEm: em };
    const porId = new Map(preview.itens.map(x => [x.id, x]));
    // Mark the entire snapshot, including preserved units. A client that reads units
    // and config separately can then safely ignore an older global multiplier.
    const depois = unidades.map(u => ({ ...u,
      ...(u.status === 'Disponível' && Number(u.precoBase) > 0 ? { precoBase: porId.get(u.id).novo } : {}),
      precoVersao: id, atualizadoEm: em, atualizadoPor: usr.usuario }));
    const { token, ...comparacao } = preview;
    const evento = { ...comparacao, id, criadoEm: em, por: usr.usuario, solicitacaoHash: hash({ args, token }), cfgDepois: metadados(novaCfg) };
    const { data, error } = await sb.rpc('dmd_precos_aplicar', {
      p_operacao_id: id, p_cfg_antes: cfg, p_cfg_depois: novaCfg,
      p_unidades_antes: Object.fromEntries(unidades.map(u => [u.id, u])), p_unidades_depois: Object.fromEntries(depois.map(u => [u.id, u])), p_evento: evento,
    });
    if (error) throw erro(/CONFLITO/.test(error.message || '') ? 'Os dados mudaram durante a confirmação. Revise a tabela novamente.' : 'Não foi possível salvar a tabela. Nenhuma alteração foi confirmada.', /CONFLITO/.test(error.message || '') ? 409 : 503);
    const { solicitacaoHash, token: omitToken, ...historico } = data.historico;
    return json(200, { ok: true, repetida: !!data.repetida, cfg: publicaCfg(data.cfg), unidades: data.unidades, historico });
  } catch (e) { return json(e.status || 500, { erro: e.status ? e.message : 'Não foi possível consultar ou salvar a tabela.' }); }
}
