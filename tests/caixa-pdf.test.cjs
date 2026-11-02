const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {jsPDF}=require('../vendor/jspdf.umd.min.js');
const ctx={Intl,Date,jspdf:{jsPDF}};
for(const file of ['previsao-custo-domain.js','caixa-domain.js','caixa-dashboard-domain.js','caixa-money-domain.js','caixa-pdf.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
const PDF=ctx.DiamondCaixaPdf,D=ctx.DiamondCaixaDomain,P=ctx.DiamondPrevisaoDomain;
function fixture(){
 const u={id:'qa-unit',unidade:'101',status:'Vendido',clienteId:'qa-client',compradorNome:'Cliente Sintético',atualizadoEm:'2026-07-01T12:00:00.000Z'};
 const c={unidadeId:u.id,clienteId:u.clienteId,unidadeRevisao:u.atualizadoEm,revisao:1,data:'2026-07-01',total:50000000,entrada:0,permutas:[{valor:10000000}],parcelas:[{descricao:'Parcelas sintéticas',quantidade:40,valor:1000000,primeiro:'2026-07-26',intervalo:1}],correcao:''};
 const key=P.contractKey({u,contrato:c}),record={revision:7,data:{contracts:{[u.id]:{contractKey:key,finalSeriesIndices:[]}},receipts:[],coverageConsolidation:{asOf:'2026-11-02',contractKeys:{[u.id]:key},groups:[{id:'qa-scp',label:'SCP sintética',unitIds:[u.id],commonCents:40000000,receivedCents:5000000}]}}};
 const plan=D.cronograma(c,u),line=plan.parcelas[0],ev={id:'qa-event',operacaoId:'qa-operation',tipo:'receber',parcelaId:line.id,cronogramaChave:plan.chave,data:'2026-10-31',valor:1000000,por:'qa',em:'2026-11-02T12:00:00Z',solicitacao:'qa',fonte:{clienteId:u.clienteId,cliente:u.compradorNome,unidade:u.unidade,descricao:line.descricao,vencimento:line.vencimento,valorPrevisto:line.valor},confirmacaoHistorica:{versao:1,ate:'2026-10-31',consolidacao:{grupoId:'qa-scp',dataBase:'2026-11-02',recebidoCentavos:5000000}}};
 const source={unidades:[u],condicoes:[c],leads:[{id:u.clienteId,cliente:u.compradorNome}],recebimentos:[{unidadeId:u.id,revisao:1,eventos:[ev]}],mes:'2026-11',hoje:'2026-11-02'};
 assert.ok(D.validarLedger(source.recebimentos[0]));return {source,record};
}
test('relatório usa os mesmos modelos e todos os 40 meses; histórico não duplica o consolidado',()=>{
 const {source,record}=fixture(),before=JSON.stringify({source,record}),r=PDF.model(source,record,{generatedAt:'02/11/2026'});
 assert.deepEqual(r.charts,ctx.DiamondCaixaDashboardDomain.build(source));assert.deepEqual(r.position,ctx.DiamondCaixaMoneyDomain.build({units:source.unidades,conditions:source.condicoes,record,model:D.build(source)}));
 assert.equal(r.position.total,40000000);assert.equal(r.position.received,5000000);assert.equal(r.position.outstanding,35000000);assert.equal(r.totals.recebido,1000000);assert.equal(r.charts.mensal.length,40);assert.equal(r.charts.mensal.at(-1).mes,'2029-10');
 const doc=PDF.build(r),out=doc.output();assert.match(out,/50.000,00/);assert.match(out,/350.000,00/);assert.match(out,/outubro\/2029/);assert.match(out,/sem vínculo individual/);assert.ok(doc.getNumberOfPages()>=3);assert.equal(JSON.stringify({source,record}),before);
});
test('busca e situação são iguais ao painel, posição geral permanece carteira completa',()=>{
 const {source,record}=fixture();source.busca='Ninguém';source.status='pendentes';const r=PDF.model(source,record);
 assert.equal(r.position.received,5000000);assert.equal(r.charts.mensal.length,40);assert.equal(r.totals.previsto,0);assert.deepEqual(r.charts,ctx.DiamondCaixaDashboardDomain.build(source));const out=PDF.build(r).output();assert.match(out,/Ninguém/);assert.match(out,/A receber/);
});
test('sem vencimento não elimina meses do PDF e não altera o ranking do recorte',()=>{
 const {source,record}=fixture();source.mes='sem-data';const r=PDF.model(source,record);assert.equal(r.charts.mensal.length,40);assert.equal(r.selected.mes,'sem-data');assert.match(PDF.build(r).output(),/Sem vencimento/);
});
test('falha ou divergência mantém A conferir, nunca zero recebido aparente',()=>{
 const {source,record}=fixture();source.recebimentos[0].revisao=50;const r=PDF.model(source,record);assert.equal(r.position.received,null);assert.equal(r.totals.recebido,null);assert.match(PDF.build(r).output(),/A conferir/);
 assert.throws(()=>PDF.model(source,null),/ainda não estão completos/);
});
test('tabela longa repete cabeçalho e exporta até o último mês sem truncar a série',()=>{
 const {source,record}=fixture();source.condicoes[0].parcelas[0].quantidade=120;source.condicoes[0].total=130000000;source.recebimentos=[];const r=PDF.model(source,record);assert.equal(r.charts.mensal.length,120);const doc=PDF.build(r),out=doc.output();assert.match(out,/junho\/2036/);assert.ok((out.match(/Valores exatos - continuação/g)||[]).length>=2);
});
test('arquivo novo participa do shell offline e carrega antes da interface',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),sw=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),v=sw.match(/diamond-pages-v(\d+)/)[1];assert.ok(html.includes('caixa-pdf.js?v='+v));assert.ok(sw.includes('caixa-pdf.js?v='+v));assert.ok(html.indexOf('src="caixa-pdf.js')<html.indexOf('src="caixa.js'));
});
