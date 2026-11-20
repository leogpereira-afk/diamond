import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { source, copy } from './helpers.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function fixture(mode) {
  const nodes = new Map(), saved = [], archived = [], pdf = [], links = [];
  const vaga = deferred(), vagaStarted = deferred(), pdfGate = deferred(), pdfStarted = deferred();
  const element = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, textContent: '', innerHTML: '', value: '', disabled: false, remove() {} });
  const get = key => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); };
  const buttons = [1, 2].map(quartos => ({ ...element(), dataset: { quartos: String(quartos) } }));
  const u = { id: 'u-1', unidade: '403', area: 45, andar: 4, status: 'Disponível', precoBase: 300000 };
  const usr = { usuario: 'domo', nome: 'Domo', papel: 'corretor', empresa: 'Domo', corretorAtivo: { nome: 'Teste', telefone: '' } };
  const S = {
    ymdLocal: d => d.toLocaleDateString('en-CA'), diaLocalISO: d => new Date(d).toLocaleDateString('en-CA'),
    getCfg: () => ({}), getUnidades: () => [u], unidadePorId: () => u, getUser: () => usr,
    isAdmin: () => false, getReservas: () => [],
    salvarProposta: p => { saved.push(copy(p)); return p; },
    enviarPropostaPdf: async (_, meta) => { links.push(copy(meta)); return 'https://example.invalid/proposta'; },
  };
  const opened = [];
  const context = vm.createContext({
    Date, Math, STORE: S, location: { hash: '#/sim/u-1' },
    window: { open: () => { const w = { location: {}, close() {} }; opened.push(w); return w; } },
    document: { querySelector: get, querySelectorAll: selector => selector === '[data-quartos]' ? buttons : [], createElement: element, body: { appendChild() {} } },
    setTimeout: () => 0,
    checkVaga: () => { vagaStarted.resolve(); return vaga.promise; },
    makePdf: async record => { pdf.push(copy(record)); pdfStarted.resolve(); await pdfGate.promise; return { doc: { output: () => 'data:application/pdf;base64,JVBERi0=' }, nome: 'teste.pdf' }; },
    archivePdf: async (_, __, proposta) => archived.push(copy(proposta)),
  });
  vm.runInContext(source('proposta-domain.js'), context);
  vm.runInContext(source('plano.js'), context);
  const code = process.env.DMD_TEST_APP ? fs.readFileSync(process.env.DMD_TEST_APP, 'utf8') : source('app.js');
  vm.runInContext(code.slice(0, code.lastIndexOf("  window.addEventListener('hashchange'")) + `
    toast=()=>{}; ativarFotos=()=>{}; wireVaga=()=>{}; montarFabDomo=()=>{}; bloquearSimuladorIndisponivel=()=>false;
    conferirVaga=checkVaga; crmRegistrar=async()=>({id:'lead-1'}); baixarPropostaArquivada=archivePdf;
    gerarPdfScp=async(u,base,opts)=>makePdf({quartos:opts.quartos,valor:scpCalcular(base,opts,{}).valor,cliente:opts.cliente});
    gerarPropostaSimples=async(u,cfg,cliente,tel,user,vaga,p)=>makePdf(p);
    if (${JSON.stringify(mode)}==='scp') {
      _scp={unidadeId:'u-1',cliente:'Cliente Teste',tel:'11999999999',quartos:2,descPct:'10',p12:true,nParc:'12',p2412:false,nFix:'12',nCor:'12',corr:0};
      vScp();
    } else {
      _uniDraft['u-1']={cliente:'Cliente Teste',clienteTel:'11999999999',quartos:2,planoOn:false,parcelas:24,entradaPct:20,finalPct:30};
      vUnidade('u-1');
    }
  })();`, context);
  return {
    saved, archived, pdf, links, opened, buttons,
    submit: target => get('#' + (mode === 'scp' ? 'scp-' : 'u-') + target).onclick(),
    select: q => buttons.find(b => b.dataset.quartos === String(q)).onclick(),
    waitVaga: () => vagaStarted.promise, allowVaga: () => vaga.resolve(true),
    waitPdf: () => pdfStarted.promise, allowPdf: () => pdfGate.resolve(),
  };
}

for (const target of ['pdf', 'whats']) {
  test(`SCP ${target}: mantém quartos e preço escolhidos antes das esperas de vaga e PDF`, async () => {
    const f = fixture('scp');
    const pending = f.submit(target);
    await f.waitVaga();
    f.select(1); // A edição seguinte não pode alterar a proposta que já está sendo emitida.
    f.allowVaga();
    await f.waitPdf();
    assert.equal(f.pdf[0].quartos, 2);
    assert.equal(f.pdf[0].valor, 285000);
    f.select(1);
    f.allowPdf();
    await pending;
    assert.equal(f.saved.at(-1).quartos, 2);
    assert.equal(f.saved.at(-1).neg, 285000);
    if (target === 'pdf') assert.equal(f.archived[0].quartos, 2);
    else {
      assert.equal(f.links[0].valor, 285000);
      assert.match(decodeURIComponent(f.opened[0].location.href), /Apartamento: 2 quartos/);
    }
  });

  test(`corretor ${target}: bloqueia troca de quartos até concluir a emissão`, async () => {
    const f = fixture('corretor');
    const pending = f.submit(target);
    await f.waitVaga();
    assert.ok(f.buttons.every(b => b.disabled));
    f.select(1); // Exercita também a guarda do callback, além do atributo disabled.
    f.allowVaga();
    await f.waitPdf();
    assert.equal(f.pdf[0].quartos, 2);
    assert.equal(f.pdf[0].neg, 315000);
    f.select(1);
    f.allowPdf();
    await pending;
    assert.equal(f.saved.at(-1).quartos, 2);
    assert.equal(f.saved.at(-1).neg, 315000);
    assert.ok(f.buttons.every(b => !b.disabled));
    if (target === 'pdf') assert.equal(f.archived[0].quartos, 2);
    else {
      assert.equal(f.links[0].valor, 315000);
      assert.match(decodeURIComponent(f.opened[0].location.href), /Apartamento: 2 quartos/);
    }
  });
}
