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
 assert.equal(c.decomposition.parts.find(p=>p.key==='barter').unitIds.length,3);assert.equal(c.decomposition.parts.find(p=>p.key==='barter').groups.length,0);assert.equal(c.decomposition.pending.length,0);assert.deepEqual(model,before);assert.equal(r.contracts,model.contracts);
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
function withNewSale(complete=true){
 const x=setup(),r={u:{id:'new-sale',unidade:'205',status:'Vendido',clienteId:'new-client',atualizadoEm:'r2'},contrato:{unidadeId:'new-sale',clienteId:'new-client',unidadeRevisao:'r2',revisao:1,total:200000,entrada:50000,permutas:[{valor:20000}],parcelas:[{quantidade:10,valor:10000,descricao:'Mensais'},{quantidade:1,valor:30000,descricao:'Final'}],observacoes:'Origem da venda: venda direta.'}};
 x.rows.push(r);if(complete)x.finance.contracts[r.u.id]={contractKey:D.contractKey(r),commissionCents:5000,finalSeriesIndices:[1],receivedCommonCents:null,receivedFinalCents:null};
 const build=()=>D.build({rows:x.rows,settings:{targetCents:500000,futurePaymentShare:.5,futureCommissionRate:0},finance:x.finance});
 return {...x,r,build};
}
test('nova venda completa incrementa a base sem duplicar e reduz a falta automaticamente',()=>{
 const x=withNewSale(),before=clone(x.record),m=C.consolidate(x.build(),x.record),p=C.build({model:m});
 assert.equal(m.consolidation.valid,true);assert.equal(m.totals.coverageCents,395016);assert.equal(m.totals.shortfallCents,104984);assert.equal(m.future.requiredGrossCents,209968);
 assert.equal(p.decomposition.matchesCoverageKnown,true);assert.equal(p.decomposition.parts.find(p=>p.key==='direta').cents,219996);assert.equal(p.decomposition.parts.find(p=>p.key==='barter').cents,70000);
 assert.equal(m.consolidation.additionalUnitIds.length,1);assert.equal(m.consolidation.adjustmentCents,16);assert.deepEqual(x.record,before);
 assert.equal(C.consolidate(x.build(),x.record).totals.coverageCents,395016);
});
test('nova venda incompleta preserva a cobertura conhecida e fica explicitamente pendente',()=>{
 const x=withNewSale(false),m=C.consolidate(x.build(),x.record),p=C.build({model:m});assert.equal(m.consolidation.valid,true);assert.equal(m.totals.coverageKnownCents,230016);assert.equal(m.totals.coverageCents,null);assert.equal(m.consolidation.pending.length,1);assert.equal(m.future.requiredGrossCents,null);assert.equal(p.decomposition.pending.length,1);assert.equal(p.decomposition.matchesCoverageKnown,true);
});
test('cancelar nova venda retira sua contribuição sem afetar a base consolidada',()=>{
 const x=withNewSale();x.r.u.status='Disponível';const m=C.consolidate(x.build(),x.record);assert.equal(m.consolidation.valid,true);assert.equal(m.totals.coverageCents,230016);assert.equal(m.consolidation.additionalUnitIds.length,0);
});
test('alteração ou cancelamento de venda da base exige reconciliação do grupo',()=>{
 const x=setup();x.rows[0].u.status='Disponível';const m=D.build({rows:x.rows,settings:{targetCents:500000},finance:x.finance});assert.equal(C.consolidate(m,x.record).consolidation.valid,false);
});
test('novas vendas sem origem documental ficam separadas sem impedir o valor confirmado',()=>{
 const x=withNewSale();delete x.r.contrato.observacoes;const p=C.build({model:C.consolidate(x.build(),x.record)});assert.equal(p.decomposition.parts.find(p=>p.key==='unknown').cents,150000);assert.equal(p.decomposition.classificationComplete,false);assert.equal(p.coverage.cents,395016);
});
test('nova venda sem condições atuais não apaga o total inicial conhecido',()=>{
 const x=withNewSale();x.r.contrato.unidadeRevisao='old';const m=C.consolidate(x.build(),x.record);assert.equal(m.consolidation.valid,true);assert.equal(m.totals.coverageKnownCents,230016);assert.equal(m.consolidation.pending[0].id,'new-sale');
});
