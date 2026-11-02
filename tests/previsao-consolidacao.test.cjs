const test=require('node:test'),assert=require('node:assert/strict');
require('../previsao-custo-domain.js');require('../previsao-custo-schema.js');
const D=globalThis.DiamondPrevisaoDomain,S=globalThis.DiamondPrevisaoSchema,C=require('../previsao-cobertura-domain.js');
const clone=v=>JSON.parse(JSON.stringify(v));
function setup(){
 const rows=['a','b','c'].map((id,i)=>({u:{id,unidade:String(101+i),status:'Vendido',clienteId:'client-'+id,atualizadoEm:'r1'},contrato:{unidadeId:id,clienteId:'client-'+id,unidadeRevisao:'r1',revisao:1,total:i===2?30000:100000,entrada:0,permutas:[{valor:i===2?30000:10000}],parcelas:i===2?[]:[{valor:20000,quantidade:1,descricao:'Final'}]}}));
 const finance={contributionsCents:40000,contracts:Object.fromEntries(rows.map(r=>[r.u.id,{contractKey:D.contractKey(r),commissionCents:0,finalSeriesIndices:r.u.id==='c'?[]:[0],receivedCommonCents:null,receivedFinalCents:null}]))};
 const model=D.build({rows,settings:{targetCents:500000,futurePaymentShare:.5,futureCommissionRate:0},finance});
 const record={asOf:'2026-01-01',source:'Fonte sintética autorizada',contractKeys:Object.fromEntries(rows.map(r=>[r.u.id,D.contractKey(r)])),groups:[['scp','a',70020,10000],['direta','b',69996,null],['barter','c',0,null]].map(([origin,id,commonCents,receivedCents])=>({id:'group-'+id,label:'Grupo '+id,origin,unitIds:[id],commonCents,receivedCents,receivedCount:receivedCents===null?null:1,outstandingCount:receivedCents===null?null:6,source:'Documento sintético'}))};
 return {model,record,rows,finance};
}
test('cobertura usa dinheiro consolidado + permutas uma vez + aportes, mantém finais e contratos intactos',()=>{
 const {model,record}=setup(),before=clone(model),r=C.consolidate(model,record),c=C.build({model:r});
 assert.equal(model.totals.coverageComplete,false);assert.equal(r.consolidation.valid,true);
 assert.equal(r.totals.coverageCents,230016);assert.equal(r.totals.shortfallCents,269984);assert.equal(r.future.requiredGrossCents,539968);
 assert.equal(r.consolidation.adjustmentCents,16);assert.equal(c.metrics.finals.cents,40000);assert.equal(c.decomposition.totalCents,230016);assert.equal(c.decomposition.matchesCoverageKnown,true);
 assert.equal(c.decomposition.parts.find(p=>p.key==='barter').cents,50000);assert.equal(c.decomposition.parts.find(p=>p.key==='scp').cents,70020);assert.equal(c.decomposition.parts.find(p=>p.key==='direta').cents,69996);assert.equal(c.decomposition.parts.find(p=>p.key==='unknown').cents,0);
 assert.equal(c.decomposition.pending.length,0);assert.deepEqual(model,before);assert.equal(r.contracts,model.contracts);
 assert.equal(r.totals.receivedCommonCents,null);assert.equal(r.consolidation.groups[0].outstandingCents,60020);
});
test('a posição recebida muda apenas o saldo financeiro e nunca duplica cobertura',()=>{
 const {model,record}=setup(),a=C.consolidate(model,record);record.groups[0].receivedCents=70020;const b=C.consolidate(model,record);assert.equal(a.totals.coverageCents,b.totals.coverageCents);assert.equal(b.consolidation.groups[0].outstandingCents,0);assert.equal(b.totals.receivedCommonCents,null);
});
test('contrato alterado, novo, ausente ou grupo duplicado invalida a fonte sem reutilizar valores antigos',()=>{
 for(const change of [r=>r.contractKeys.a='old',r=>delete r.contractKeys.a,r=>r.contractKeys.d='new',r=>r.groups[0].unitIds.push('b')]){const {model,record}=setup();change(record);const v=C.consolidate(model,record);assert.equal(v.consolidation.valid,false);assert.equal(v.totals.coverageComplete,false);}
});
test('comissão e aporte são recalculados sem modificar os documentos',()=>{
 const {rows,finance,record}=setup();finance.contributionsCents=45000;finance.contracts.a.commissionCents=1234;const m=D.build({rows,finance,settings:{targetCents:500000,futurePaymentShare:.7,futureCommissionRate:.1}}),r=C.consolidate(m,record);assert.equal(r.totals.coverageCents,233782);assert.equal(r.future.requiredGrossCents,443697);assert.equal(C.build({model:r}).decomposition.matchesCoverageKnown,true);
});
test('schema preserva o novo campo e aceita registros antigos sem fabricá-lo',()=>{
 const {record}=setup(),old=S.defaults();assert.equal(Object.hasOwn(S.validate(old),'coverageConsolidation'),false);assert.deepEqual(S.validate({...old,coverageConsolidation:record}).coverageConsolidation,record);
});
test('schema recusa totais, grupos, datas e recebimentos inválidos',()=>{
 for(const change of [r=>r.groups[0].receivedCents=80000,r=>r.groups[0].commonCents=-1,r=>r.groups[0].commonCents=.1,r=>r.groups[2].commonCents=1,r=>r.groups[0].unitIds.push('b'),r=>r.asOf='2026-02-30',r=>r.groups[0].receivedCount=-1,r=>delete r.contractKeys.a,r=>r.injected=1]){const {record}=setup();change(record);assert.throws(()=>S.validate({...S.defaults(),coverageConsolidation:record}));}
});
test('permutas sem caixa não podem mascarar uma nova venda monetária',()=>{
 const {model,record}=setup();model.contracts[2].grossCents+=100;assert.equal(C.consolidate(model,record).consolidation.valid,false);
});
test('ausência de consolidação mantém o motor anterior e comissão futura vazia não vira zero',()=>{
 const {model,record}=setup();assert.equal(C.consolidate(model,null),model);model.future.valid=false;model.future.C=null;assert.equal(C.consolidate(model,record).future.requiredGrossCents,null);
});
