import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { source, copy, backend } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { jsPDF } = require('../vendor/jspdf.umd.min.js');

const fixture = { mime: 'image/jpeg', base64: fs.readFileSync(new URL('../pdf-diamond.jpg', import.meta.url)).toString('base64') };
function setup({ foto = fixture, obterFoto, arquivarPropostaPdf, unidade = { unidade: '403' } } = {}) {
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
    window: { jspdf: { jsPDF: Document } }, Date, Math, setTimeout, clearTimeout,
    Image: class { set src(value) { this.width = 900; this.height = 550; queueMicrotask(() => value.endsWith(fixture.base64) ? this.onload() : this.onerror()); } },
    STORE: { arquivarPropostaPdf, unidadePorId: () => unidade, obterFoto: obterFoto || (async () => foto), ymdLocal: d => d.toLocaleDateString('en-CA') },
  });
  vm.runInContext(source('plano.js'), ctx);
  vm.runInContext(source('proposta-domain.js'), ctx);
  const code = source('app.js');
  const cut = code.lastIndexOf("  window.addEventListener('hashchange'");
  assert.ok(cut > 0, 'O teste precisa carregar as funções do app sem iniciar a interface');
  vm.runInContext(code.slice(0, cut) + `
    imgData = async () => null;
    carregarLogoImob = async () => null;
    globalThis.pdfTools = { gerarPDF, gerarPropostaSimples, gerarPdfScp, baixarPropostaArquivada, resumoTexto, resumoDoPlano };
  })();`, ctx);
  return {
    gerar: ctx.pdfTools.gerarPDF,
    baixar: ctx.pdfTools.baixarPropostaArquivada,
    simples: ctx.pdfTools.gerarPropostaSimples,
    scp: ctx.pdfTools.gerarPdfScp,
    diluir: ctx.window.DiamondProposta.diluir,
    whats: ctx.pdfTools.resumoTexto,
    resumo: ctx.pdfTools.resumoDoPlano,
    plano: p => ctx.window.PLANO.calc({
      ...p.inp, neg: p.neg,
      entradaPct: p.inp.entradaPct / 100, finalPct: p.inp.finalPct / 100,
      dataProposta: new Date(p.inp.dataProposta + 'T12:00:00'),
    }),
  };
}

const cfgAtual = { fotosTipo: { '03': 'planta-teste' }, versao: 'v2', dataTabela: '05/10/2026', corretagem: 0.06 };
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

async function capturarWhatsApp(p, doc, mensagem, b) {
  const popup={location:{},close(){}},button={},avisos=[];
  const code=source('app.js'),start=code.indexOf("    $('#u-whats').onclick = async () => {"),end=code.indexOf('    // Solicitar reserva',start);
  assert.ok(start>0&&end>start);
  const context=vm.createContext({
    $:()=>button,window:{open:()=>popup},d:{cliente:p.cliente,clienteTel:p.clienteTel,propostaId:p.id},
    u:{unidade:p.unidade,precoBase:p.neg,area:p.area},vt:p.neg,user:{nome:p.corretor},
    preparar:async()=>({doc,proposta:p,msg:mensagem}),crmRegistrar:async()=>null,
    telWa:()=> '5538999990000',encodeURIComponent,toast:m=>avisos.push(m),
    STORE:{enviarPropostaPdf:async(base64,meta)=>{
      const r=await b.request('putPropostaPdf',{base64,...meta});
      if(!r.ok)throw Error(JSON.stringify(r));
      return 'https://proposta.invalid/'+r.id;
    }},
  });
  vm.runInContext(code.slice(start,end),context);
  await button.onclick();
  assert.ok(popup.location.href,avisos.join('\n'));
  return new URL(popup.location.href);
}

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

for (const foto of [null, { mime: 'image/jpeg', base64: 'invalida' }]) {
  test('PDF não retorna documento sem a planta esperada: ' + (foto ? 'inválida' : 'indisponível'), async () => {
    const s = setup({ foto }), p = proposta();
    await assert.rejects(s.gerar(p, s.plano(p), { ...cfgAtual, fotosTipo: { '03': 'planta-teste' } }), /planta/i);
  });
}

const qtdImagens = doc => Object.keys(doc.internal.collections.addImage_images || {}).length;
test('planta é incorporada nos três modelos de proposta', async () => {
  const s = setup(), p = proposta(), u = { unidade: '403', precoBase: 300000, area: 45, andar: 4 };
  const resultados = [await s.gerar(p, s.plano(p), cfgAtual), await s.simples(u, cfgAtual, 'Teste', '', {}), await s.scp(u, 300000, {}, cfgAtual, {}, 'Teste', '')];
  for (const { doc } of resultados) {
    assert.equal(qtdImagens(doc), 1);
    assert.match(texto(doc), /Unidade 403 · planta ilustrada/);
    assert.match(doc.output(), /Subtype \/Image/);
  }
});
test('falha temporária ou cache ilegível é recuperado diretamente da nuvem', async () => {
  for (const primeira of [null, { ...fixture, base64: 'invalida' }]) {
    const calls = [];
    const s = setup({ obterFoto: async (id, opts) => { calls.push({ id, ...opts }); return calls.length === 1 ? primeira : fixture; } }), p = proposta();
    const { doc } = await s.gerar(p, s.plano(p), cfgAtual);
    assert.equal(qtdImagens(doc), 1);
    assert.deepEqual(calls, [{ id: 'planta-teste', atualizar: false }, { id: 'planta-teste', atualizar: true }]);
  }
});
test('propostas simples e SCP também impedem PDF incompleto', async () => {
  const s = setup({ foto: null }), u = { unidade: '403', precoBase: 300000 };
  await assert.rejects(s.simples(u, cfgAtual, 'Teste', '', {}), /planta/i);
  await assert.rejects(s.scp(u, 300000, {}, cfgAtual, {}, 'Teste', ''), /planta/i);
});
test('planta sem cadastro exige correção em Configurações', async () => {
  const s = setup(), p = proposta();
  await assert.rejects(s.gerar(p, s.plano(p), {}), /Planta não cadastrada/);
});
test('tipo da unidade define a planta, mantendo fallback do cadastro antigo', async () => {
  for (const unidade of [{ unidade: '801', fotoId: 'antiga' }, { unidade: '808' }, { unidade: 'LOJA' }, { unidade: '999', fotoId: 'antiga' }]) {
    const calls = [], cfg = { ...cfgAtual, fotosTipo: { '01': 'tipo01', '08': 'tipo08', LOJA: 'loja' } };
    const s = setup({ unidade, obterFoto: async id => { calls.push(id); return fixture; } }), p = proposta({ unidade: unidade.unidade });
    await s.gerar(p, s.plano(p), cfg);
    const expected = cfg.fotosTipo[unidade.unidade === 'LOJA' ? 'LOJA' : unidade.unidade.slice(-2)] || unidade.fotoId;
    assert.deepEqual(calls, [expected]);
  }
});

test('PDF completo, simples e SCP arquivam os mesmos bytes liberados no download',async()=>{
  const archives=[],s=setup({arquivarPropostaPdf:async(data,p)=>archives.push({data,id:p.id})}),p=proposta(),u={unidade:'403',precoBase:300000,area:45,andar:4};
  const docs=[await s.gerar(p,s.plano(p),cfgAtual),await s.simples(u,cfgAtual,'Teste','',{}),await s.scp(u,300000,{},cfgAtual,{},'Teste','')];
  for(const {doc,nome} of docs){let downloaded;doc.save=()=>{downloaded=doc.output('datauristring').split(',')[1];};await s.baixar(doc,nome,p);assert.equal(downloaded,archives.at(-1).data);assert.equal(archives.at(-1).id,p.id);assert.match(Buffer.from(downloaded,'base64').toString('latin1'),/^%PDF-/);}
  assert.equal(archives.length,3);
});

test('PDF mostra centavos e separa mensalidade, balão e final com total exato', async()=>{
 const s=setup(),p=proposta({neg:300000.01,inp:{entradaPct:10,finalPct:50,nParcelas:36}}),before=copy(p);
 const {doc}=await s.gerar(p,s.plano(p),cfgAtual);
 assert.match(texto(doc),/300\.000,01/);
 assert.match(texto(doc),/35 x R\$\s*1\.944,44 \+ última de R\$\s*1\.944,60/);
 assert.ok(doc.texts.some(r=>r.text==='Parcela 36/36'));
 assert.ok(doc.texts.some(r=>r.text==='Parcela final (50%)'));
 assert.ok(!doc.texts.some(r=>r.text.includes(' + Parcela final')));
 assert.deepEqual(p,before);
 if(process.env.DIAMOND_PDF_TEST_OUTPUT) fs.writeFileSync(process.env.DIAMOND_PDF_TEST_OUTPUT,Buffer.from(doc.output('arraybuffer')));
});

test('PDF de 48 mensais leva a final de 20% para o mês 48 e preserva os centavos', async()=>{
 const s=setup(),p=proposta({neg:373563.84,inp:{entradaPct:20,finalPct:20,nParcelas:48,chavesMes:48}});
 const {doc}=await s.gerar(p,s.plano(p),cfgAtual),t=texto(doc);
 assert.match(t,/47 x R\$\s*3\.627,88 \+ última de R\$\s*3\.627,94/);
 assert.match(t,/Final: R\$\s*74\.712,77 no mês 48/);
 assert.ok(doc.texts.some(r=>r.text==='Parcela 48/48'));
 assert.ok(doc.texts.some(r=>r.text==='Parcela final (20%)'));
 assert.match(t,/373\.563,84/);
});

test('PDF mantém o arredondamento escolhido na proposta salva, sem trocar centavos antigos',async()=>{
 const s=setup();
 for(const arredondamento of ['decimal-v1',undefined]){
  const p=proposta({neg:150000.05,inp:{entradaPct:20,finalPct:30,nParcelas:36,...(arredondamento?{arredondamento}:{})}});
  const plano=s.plano(p),{doc}=await s.gerar(p,plano,cfgAtual);
  assert.match(texto(doc),arredondamento?/45\.000,02/:/45\.000,01/);
  assert.equal(plano.totalNominal,150000.05);
 }
});

test('PDF imprime a escolha da final e o vencimento dos seis planos v2',async()=>{
 const s=setup();
 for(const [n,opcoes] of [[36,[10,20,30]],[48,[10,15,20]]])for(const finalPct of opcoes){
  const p=proposta({neg:373563.84,inp:{regrasPlano:'36-48-v2',arredondamento:'decimal-v1',entradaPct:20,finalPct,nParcelas:n,chavesMes:n}});
  const antes=copy(p),plano=s.plano(p),{doc}=await s.gerar(p,plano,cfgAtual);
  assert.ok(doc.texts.some(r=>r.text===`Parcela final (${finalPct}%)`));
  assert.match(texto(doc),new RegExp('Final: R\\$[^\\n]+ no mês '+n));
  assert.ok(doc.texts.some(r=>r.text===`Parcela ${n}/${n}`));
  assert.equal(plano.totalNominal,373563.84);assert.deepEqual(p,antes);
 }
});

test('PDF e WhatsApp preservam entrada, mensais, balões e final nos seis planos, com três entradas e diluição',async()=>{
 const s=setup(), br=cents=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),norm=t=>t.replace(/\s+/g,' ');
 for(const [n,finalPct,finalCents] of [[36,10,3735638],[36,20,7471277],[36,30,11206915],[48,10,3735638],[48,15,5603458],[48,20,7471277]]){
  for(const entradaPct of [10,20,30])for(const balQtde of [0,5]){
   const p=proposta({neg:373563.84,inp:{regrasPlano:'36-48-v2',arredondamento:'decimal-v1',dataProposta:'2026-11-16',entradaPct,finalPct,nParcelas:n,chavesMes:n,balQtde}}),plano=s.plano(p);
   const entCents=Math.round(37356384*entradaPct/100),saldo=37356384-entCents-finalCents-balQtde*1000000,mensal=Math.floor(saldo/n),ultima=saldo-mensal*(n-1);
   const mensais=mensal===ultima?`${n} x ${br(mensal)}`:`${n-1} x ${br(mensal)} + última de ${br(ultima)}`,final=`${br(finalCents)} no mês ${n}`;
   const {doc}=await s.gerar(p,plano,cfgAtual),pdf=norm(texto(doc)),whats=norm(s.whats(plano,p)),resumo=s.resumo(p,plano);
   for(const t of [pdf,whats]){assert.ok(t.includes(norm(mensais)),t);assert.ok(t.includes(norm(final)),t);assert.ok(t.includes(norm(br(entCents))),t);assert.ok(t.includes('373.563,84'));}
   assert.ok(whats.includes(`Parcela final (${finalPct}%):`));
   assert.equal(whats.includes('balões de'),balQtde>0);
   assert.equal(resumo.itens.find(x=>x.rotulo==='Parcela final').valor,`${br(finalCents)} · mês ${n}`);
   const row=doc.texts.find(x=>x.text===`Parcela final (${finalPct}%)`),cells=doc.texts.filter(x=>x.y===row.y&&x.page===row.page).map(x=>x.text);
   assert.ok(cells.includes(String(n)));assert.ok(cells.includes(n===36?'10/11/2029':'10/11/2030'));assert.ok(cells.includes(br(finalCents)));
   assert.equal(plano.totalNominal,373563.84);
  }
 }
});

test('link do WhatsApp conserva o PDF original e o mês da final mesmo depois de editar a proposta',async()=>{
 const s=setup();
 for(const [n,opcoes] of [[36,[10,20,30]],[48,[10,15,20]]])for(const finalPct of opcoes){
  const p=proposta({unidade:'1',unidadeId:'u-1',corretor:'Teste',corretorUsuario:'domo',neg:373563.84,inp:{regrasPlano:'36-48-v2',arredondamento:'decimal-v1',entradaPct:20,finalPct,nParcelas:n,chavesMes:n}}),plano=s.plano(p);
  p.resumoEnvio=s.resumo(p,plano);
  const {doc}=await s.gerar(p,plano,cfgAtual),base64=doc.output('datauristring').split(',')[1],b=backend();
  b.table('propostas').set(p.id,copy(p));
  const url=await capturarWhatsApp(p,doc,s.whats(plano,p),b),mensagem=url.searchParams.get('text');
  assert.equal(url.hostname,'wa.me');assert.ok(mensagem.includes(`Parcela final (${finalPct}%):`));assert.ok(mensagem.includes('no mês '+n));
  const id=mensagem.match(/https:\/\/proposta\.invalid\/(pp-[a-f0-9]+)/)?.[1];assert.ok(id);
  const saved=await b.publicGet({id,dados:'1',preview:'1'}),publicData=JSON.parse(saved.body),pdf=await b.publicGet({id,pdf:'1',preview:'1'});
  assert.equal(pdf.statusCode,200);assert.equal(pdf.body,base64);
  assert.deepEqual(publicData.resumo.itens,copy(p.resumoEnvio.itens));
  if(process.env.DIAMOND_PROPOSAL_AUDIT_DIR){
   const dir=process.env.DIAMOND_PROPOSAL_AUDIT_DIR,name=`${n}x-final-${finalPct}`;
   fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name+'.pdf'),Buffer.from(pdf.body,'base64'));
   fs.writeFileSync(path.join(dir,name+'-whatsapp.txt'),mensagem);
   fs.writeFileSync(path.join(dir,name+'-link.json'),JSON.stringify(publicData.resumo,null,2));
  }
  b.table('propostas').get(p.id).resumoEnvio.itens.find(x=>x.rotulo==='Parcela final').valor='Condição de outra proposta';
  const again=JSON.parse((await b.publicGet({id,dados:'1',preview:'1'})).body);
  assert.deepEqual(again.resumo,publicData.resumo);
 }
});

test('texto do WhatsApp mantém os centavos dos balões, como o PDF e o plano',async()=>{
 const s=setup(),p=proposta({neg:373563.84,inp:{regrasPlano:'36-48-v2',arredondamento:'decimal-v1',entradaPct:20,finalPct:15,nParcelas:48,chavesMes:48,balValor:10000.51}}),plano=s.plano(p);
 const {doc}=await s.gerar(p,plano,cfgAtual);
 assert.match(texto(doc),/Balões: 5 x R\$\s*10\.000,51/);
 assert.match(s.whats(plano,p),/5 balões de R\$\s*10\.000,51/);
});
