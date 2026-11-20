import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { jsPDF } = require('../vendor/jspdf.umd.min.js');
const source = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const unit = { id: 'u-403', unidade: '403', andar: 4, area: 44.99, precoBase: 400000, desconto: 0.1 };
const user = { nome: 'Teste', usuario: 'admin', papel: 'admin' };
const cfg = { fotosTipo: { '03': 'planta-1q' }, indice: 'INCC' };
const photo = { mime: 'image/jpeg', base64: fs.readFileSync(new URL('../pdf-diamond.jpg', import.meta.url)).toString('base64') };
function runtime() {
  const reads = [];
  class Image { width = 600; height = 400; set src(value) { queueMicrotask(() => this.onload?.()); } }
  const ctx = vm.createContext({ window: { jspdf: { jsPDF } }, Date, Math, setTimeout, clearTimeout, Image,
    fetch: async () => { throw Error('Sem logos neste teste'); },
    STORE: { unidadePorId: () => unit, getUser: () => user, getUsuarios: () => [], obterFoto: async id => { reads.push(id);
      const path = ctx.window.DiamondProposta.urlPlantaPublicada(id);
      return path ? { mime: 'image/png', base64: fs.readFileSync(new URL('../' + path, import.meta.url)).toString('base64') } : photo; } }
  });
  vm.runInContext(source('proposta-domain.js'), ctx);
  vm.runInContext(source('plano.js'), ctx);
  const app = source('app.js');
  vm.runInContext(app.slice(0, app.lastIndexOf("  window.addEventListener('hashchange'")) + ';globalThis.pdfTools={gerarPDF,gerarPropostaSimples,gerarPdfScp,plantaParaProposta};})();', ctx);
  return { ctx, reads, ...ctx.pdfTools };
}
function proposal(quartos = 2) {
  return { unidadeId: unit.id, unidade: unit.unidade, quartos, acrescimoQuartos: quartos === 2 ? 15000 : 0,
    neg: quartos === 2 ? 375000 : 360000, cliente: 'Cliente fictício', corretor: user.nome,
    inp: { forma: 'avista', diaVenc: 10, indice: 'INCC' } };
}
test('os três PDFs exibem 2 quartos, acréscimo fixo e a planta publicada do mesmo final', async () => {
  const r = runtime(), p = proposal();
  const plano = r.ctx.window.PLANO.calc({ neg: p.neg, forma: 'avista', dataProposta: new Date('2026-11-19T12:00:00Z') });
  const docs = await Promise.all([
    r.gerarPDF(p, plano, cfg),
    r.gerarPropostaSimples(unit, cfg, p.cliente, '', user, null, p),
    r.gerarPdfScp(unit, 400000, { quartos: 2, descPct: 10 }, cfg, user, p.cliente, '')
  ]);
  for (const { doc } of docs) {
    const text = doc.output();
    assert.match(text, /2 quartos/);
    assert.match(text, /15\.000,00/);
    assert.match(text, /375\.000/);
    assert.doesNotMatch(text, /Planta de 2 quartos a cadastrar/);
    assert.match(text, /\/Subtype \/Image/);
  }
  assert.deepEqual(r.reads, Array(3).fill('diamond-2q-03'));
});
test('planta escolhida e snapshot de 2 quartos são respeitados sem consultar a de 1 quarto', async () => {
  const r = runtime(), two = { ...cfg, fotosTipo2Quartos: { '03': 'planta-2q' } };
  const first = await r.plantaParaProposta(unit, two, { quartos: 2 });
  assert.equal(first.foto, photo);
  await r.plantaParaProposta(unit, two, { quartos: 2, fotoPlantaId: 'planta-2q-salva' });
  assert.deepEqual(r.reads, ['planta-2q', 'planta-2q-salva']);
});
test('PDF simples preserva exatamente o total salvo e continua usando a planta original de 1 quarto', async () => {
  const r = runtime(), p = { ...proposal(1), neg: 360123.45 };
  const { doc } = await r.gerarPropostaSimples(unit, cfg, p.cliente, '', user, null, p);
  assert.match(doc.output(), /1 quarto/);
  assert.match(doc.output(), /360\.123,45/);
  assert.doesNotMatch(doc.output(), /Planta de 2 quartos a cadastrar/);
  assert.deepEqual(r.reads, ['planta-1q']);
});
test('SCP sem desconto inclui o adicional no valor em destaque do PDF', async () => {
  const r = runtime();
  const { doc } = await r.gerarPdfScp(unit, 400000, { quartos: 2 }, cfg, user, 'Cliente fictício', '');
  assert.match(doc.output(), /415\.000/);
  assert.match(doc.output(), /VALOR COM 2 QUARTOS/);
});
