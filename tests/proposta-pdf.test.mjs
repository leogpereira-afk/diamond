import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { source, copy } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { jsPDF } = require('../vendor/jspdf.umd.min.js');

function setup() {
  function Document(options) {
    const doc = new jsPDF(options), text = doc.text.bind(doc);
    doc.texts = [];
    doc.text = (value, x, y, ...rest) => {
      doc.texts.push({
        text: Array.isArray(value) ? value.join('\n') : String(value), x, y,
        page: doc.internal.getCurrentPageInfo().pageNumber,
      });
      return text(value, x, y, ...rest);
    };
    return doc;
  }
  const ctx = vm.createContext({
    window: { jspdf: { jsPDF: Document } }, Date, Math,
    STORE: { unidadePorId: () => ({ unidade: '403' }), obterFoto: async () => null },
  });
  vm.runInContext(source('plano.js'), ctx);
  vm.runInContext(source('proposta-domain.js'), ctx);
  const code = source('app.js');
  const cut = code.lastIndexOf("  window.addEventListener('hashchange'");
  assert.ok(cut > 0, 'O teste precisa carregar as funções do app sem iniciar a interface');
  vm.runInContext(code.slice(0, cut) + `
    imgData = async () => null;
    carregarLogoImob = async () => null;
    globalThis.pdfTools = { gerarPDF };
  })();`, ctx);
  return {
    gerar: ctx.pdfTools.gerarPDF,
    diluir: ctx.window.DiamondProposta.diluir,
    plano: p => ctx.window.PLANO.calc({
      ...p.inp, neg: p.neg,
      entradaPct: p.inp.entradaPct / 100, finalPct: p.inp.finalPct / 100,
      dataProposta: new Date(p.inp.dataProposta + 'T12:00:00'),
    }),
  };
}

const cfgAtual = { versao: 'v2', dataTabela: '05/10/2026', corretagem: 0.06 };
function proposta({ inp = {}, ...rest } = {}) {
  return {
    id: 'p-teste-pdf', unidadeId: 'u-403', unidade: '403', area: 45,
    cliente: 'Cliente de teste', clienteTel: '(38) 99999-0000',
    corretor: 'Corretor de teste', corretorUsuario: 'domo', corretorTel: '(38) 99999-0001',
    neg: 300000,
    tabela: { key: 'salva', versao: 'v1', dataTabela: '01/07/2026', valorTabela: 300000, desconto: 0, neg: 300000 },
    ...rest,
    inp: {
      forma: 'perso', entradaPct: 20, finalPct: 40, nParcelas: 30,
      balQtde: 5, balValor: 10000, balPrimeiro: 6, balIntervalo: 6, chavesMes: 36,
      dataProposta: '2026-10-07', diaVenc: 10, indice: 'INCC',
      corretagemPct: 5, quemPagaCorretagem: 'Construtora', semComissao: false,
      ...inp,
    },
  };
}

const texto = doc => doc.texts.map(row => row.text).join('\n');
const valorBRL = value => Number(value.replace(/[^\d,-]/g, '').replace(',', '.'));

test('PDF preserva tabela v1 de julho no cabeçalho de todas as páginas e na ficha, com configuração atual v2', async () => {
  const s = setup(), p = proposta(), cfg = copy(cfgAtual), before = copy({ p, cfg });
  const { doc, nome } = await s.gerar(p, s.plano(p), cfg);
  assert.equal(nome, 'Proposta-Diamond-403-Cliente_de_teste.pdf');
  assert.match(doc.output(), /^%PDF-/);
  assert.ok(doc.getNumberOfPages() > 1, 'O cenário deve exercitar cabeçalhos de continuação');
  assert.match(texto(doc), /Tabela escolhida:\nv1\nData da tabela:\n01\/07\/2026/);
  assert.doesNotMatch(texto(doc), /05\/10\/2026|\bv2\b/);
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    const header = doc.texts.find(row => row.page === page && row.text.startsWith('Edifício Diamond'));
    assert.ok(header, `Cabeçalho ausente na página ${page}`);
    assert.match(header.text, /tabela 01\/07\/2026 · v1/);
  }
  assert.deepEqual({ p, cfg }, before, 'Exportar não pode alterar a proposta salva nem a configuração corrente');
});

test('PDF exibe Sem comissão apenas quando essa condição está marcada na proposta', async () => {
  const s = setup();
  for (const semComissao of [true, false]) {
    const p = proposta({ inp: { semComissao } });
    const { doc } = await s.gerar(p, s.plano(p), cfgAtual);
    assert.equal(doc.texts.some(row => row.text === 'Sem comissão'), semComissao);
    if (semComissao) assert.match(texto(doc), /Comissão:\nSem comissão\nCondição:\nNesta proposta/);
  }
});

test('PDF de plano diluído contém somente entrada e mensais, cujo somatório confere com o total impresso', async () => {
  const s = setup(), p = proposta();
  p.inp = s.diluir(p.inp);
  const plano = s.plano(p), { doc } = await s.gerar(p, plano, cfgAtual);
  assert.equal(plano.ent, 60000);
  assert.equal(plano.vParc, 8000);
  assert.equal(plano.totalNominal, 300000);
  assert.match(texto(doc), /Entrada: R\$\s*60\.000,00 \| Mensais: 30 x R\$\s*8\.000,00/);
  assert.match(texto(doc), /Sem balões \| Final: R\$\s*0,00/);
  assert.doesNotMatch(texto(doc), /Balão|Parcela final|Parcelas e balões corrigidos/);
  const rows = doc.texts.filter(row => /^Entrada \(|^Parcela \d+\//.test(row.text));
  assert.equal(rows.length, 31, 'Uma entrada e trinta mensais devem aparecer no PDF');
  let soma = 0;
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i].text, i === 0 ? 'Entrada (20%)' : `Parcela ${i}/30`);
    const amount = doc.texts.find(row => row.page === rows[i].page && row.y === rows[i].y && row.x > 500);
    assert.ok(amount, `Valor ausente na linha ${i}`);
    soma += valorBRL(amount.text);
  }
  const total = doc.texts.find(row => row.text === 'TOTAL');
  const totalAmount = doc.texts.find(row => row.page === total.page && row.y === total.y && row.x > 500);
  assert.equal(soma, 300000);
  assert.equal(valorBRL(totalAmount.text), soma);
});

test('tabela sem versão registrada não atribui a versão corrente ao PDF', async () => {
  const s = setup(), p = proposta({ tabela: { key: 'salva', neg: 300000, versao: '', dataTabela: '', origem: 'sem_registro' } });
  const { doc } = await s.gerar(p, s.plano(p), cfgAtual);
  assert.match(texto(doc), /data não registrada · versão não registrada/);
  assert.match(texto(doc), /Tabela escolhida:\nNão registrada/);
  assert.doesNotMatch(texto(doc), /05\/10\/2026|\bv2\b/);
});

test('paginação preserva todas as mensais, o total e as notas finais dentro da página', async () => {
  const s = setup();
  for (const nParcelas of [24, 25, 26, 27, 28, 29, 30, 31, 60]) {
    const p = proposta({ vaga: { codigo: 'V01', pavimento: 'Térreo' }, inp: { semComissao: true, nParcelas, finalPct: 0, balQtde: 0, balValor: 0 } });
    const { doc } = await s.gerar(p, s.plano(p), cfgAtual);
    const rows = doc.texts.filter(row => /^Parcela \d+\//.test(row.text));
    assert.equal(rows.length, nParcelas, `Mensais ausentes no plano de ${nParcelas} parcelas`);
    for (let i = 1; i <= nParcelas; i++) assert.equal(rows[i - 1].text, `Parcela ${i}/${nParcelas}`);
    const total = doc.texts.find(row => row.text === 'TOTAL');
    const notes = doc.texts.filter(row => /^(Valores nominais|Gerado em)/.test(row.text));
    assert.equal(notes.length, 2);
    for (const row of [total, ...notes]) {
      assert.equal(row.page, total.page, `Total e notas separados no plano de ${nParcelas} parcelas`);
      assert.ok(row.y <= doc.internal.pageSize.getHeight() - 20,
        `${nParcelas} parcelas: "${row.text}" em y=${row.y} invade a margem inferior da página ${row.page}`);
    }
  }
});
