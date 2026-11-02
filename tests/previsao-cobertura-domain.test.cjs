const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../previsao-custo-domain.js'),'utf8'),context);
const D=context.DiamondPrevisaoDomain;
const C=require('../previsao-cobertura-domain.js');
const row=(id='example-a')=>({u:{id,unidade:id,status:'Vendido',clienteId:'example-client-'+id,atualizadoEm:'example-revision'},preco:130000,contrato:{unidadeId:id,clienteId:'example-client-'+id,unidadeRevisao:'example-revision',revisao:1,total:100000,entrada:10000,permutas:[{valor:20000}],parcelas:[{descricao:'Exemplo mensal',valor:4000,quantidade:10},{descricao:'Exemplo final',valor:30000,quantidade:1}]}});
const manual=r=>({contractKey:D.contractKey(r),commissionCents:5000,finalSeriesIndices:[1],receivedCommonCents:10000,receivedFinalCents:0});
const stock=(id,price,status='Disponível',unidade=id)=>({u:{id,unidade,status},preco:price});
function model({rows=[row()],settings={},finance={}}={}){return JSON.parse(JSON.stringify(D.build({rows,settings:{targetCents:200000,futurePaymentShare:.5,futureCommissionRate:.05,selectedInventoryIds:[],...settings},finance:{contributionsCents:10000,contracts:Object.fromEntries((rows||[]).filter(r=>r.contrato).map(r=>[r.u.id,manual(r)])),...finance}})));}
const build=(options={},classifications={})=>C.build({model:model(options),classifications});
const parts=x=>Object.fromEntries(x.decomposition.parts.map(p=>[p.key,p]));
const clone=x=>JSON.parse(JSON.stringify(x));
const freeze=x=>{if(x&&typeof x==='object'){Object.freeze(x);Object.values(x).forEach(freeze);}return x;};

test('decomposição disjunta reconcilia cobertura: dinheiro por origem + aporte + permuta − comissão',()=>{
 const rows=['example-a','example-b','example-c'].map(row),result=build({rows,settings:{targetCents:400000}},{'example-a':'direta','example-b':'scp'}),p=parts(result);
 assert.equal(result.coverage.cents,205000);assert.equal(result.coverage.percent,.5125);
 assert.equal(p.direta.cents,50000);assert.equal(p.scp.cents,50000);assert.equal(p.unknown.cents,50000);
 assert.equal(p.barter.cents,60000);assert.equal(p.commission.signedCents,-15000);assert.equal(p.contributions.cents,10000);
 assert.equal(result.decomposition.totalCents,205000);assert.equal(result.decomposition.matchesCoverageKnown,true);
 assert.equal(result.metrics.gross.cents,300000);assert.equal(result.metrics.gross.percent,.75);assert.equal(result.metrics.finals.cents,90000);
 assert.equal(result.decomposition.classificationComplete,false);
 assert.equal(result.metrics.received.cents,30000); // Not 40000: contributions stay separate.
});

test('100% permuta contribui uma vez e não cria dinheiro, parcela ou recebimento',()=>{
 const r=row();r.contrato={...r.contrato,total:100000,entrada:0,permutas:[{valor:100000}],parcelas:[]};
 const result=build({rows:[r],finance:{contributionsCents:0,contracts:{[r.u.id]:{...manual(r),commissionCents:0,finalSeriesIndices:[],receivedCommonCents:0}}}},{[r.u.id]:'scp'}),p=parts(result);
 assert.equal(result.coverage.cents,100000);assert.equal(p.scp.cents,0);assert.equal(p.barter.cents,100000);assert.equal(result.metrics.received.cents,0);
});

test('recebido só fica completo após conferir comum e final; conhecido parcial não vira total',()=>{
 const r=row(),incomplete=build({rows:[r],finance:{contracts:{[r.u.id]:{...manual(r),receivedFinalCents:null}}}});
 assert.equal(incomplete.metrics.received.cents,null);assert.equal(incomplete.metrics.received.knownCents,10000);assert.equal(incomplete.metrics.received.complete,false);
 assert.equal(incomplete.metrics.receivedCommon.cents,null);assert.equal(incomplete.metrics.receivedFinal.cents,null);
 const full=build({rows:[r],finance:{contracts:{[r.u.id]:{...manual(r),receivedCommonCents:50000,receivedFinalCents:30000}}}});
 assert.equal(full.metrics.received.cents,80000);assert.equal(full.coverage.cents,incomplete.coverage.cents);assert.equal(full.metrics.receivedFinal.percent,.15);
});

test('zero confirmado é diferente de fonte inexistente e aporte não conferido',()=>{
 const empty=build({rows:[],finance:{contributionsCents:0}});
 assert.equal(empty.coverage.cents,0);assert.equal(empty.coverage.percent,0);assert.equal(empty.metrics.received.cents,0);assert.equal(empty.decomposition.totalCents,0);
 const missing=C.build();assert.equal(missing.coverage.cents,null);assert.equal(missing.coverage.knownCents,null);assert.equal(missing.metrics.received.knownCents,null);assert.equal(missing.simulation.estimatedCount,null);
 const unchecked=build({finance:{contributionsCents:null}});assert.equal(unchecked.metrics.contributions.cents,null);assert.equal(unchecked.coverage.cents,null);assert.equal(unchecked.coverage.knownCents,65000);assert.equal(parts(unchecked).contributions.cents,null);
});

test('contrato incompleto mantém bruto conhecido mas não entra em nenhuma parcela da cobertura',()=>{
 const a=row(),b=row('example-b');b.contrato.total=200000;
 const result=build({rows:[a,b]},{[a.u.id]:'scp',[b.u.id]:'direta'}),p=parts(result);
 assert.equal(result.metrics.gross.cents,300000);assert.equal(result.coverage.cents,null);assert.equal(result.coverage.knownCents,75000);
 assert.equal(p.scp.cents,50000);assert.equal(p.direta.cents,0);assert.equal(p.barter.cents,20000);assert.equal(p.commission.cents,5000);
 assert.deepEqual(result.decomposition.acceptedUnitIds,[a.u.id]);assert.equal(result.decomposition.pending[0].id,b.u.id);assert.equal(result.decomposition.pending[0].reason,'coverage_incomplete');
 assert.equal(result.decomposition.totalCents,null);assert.equal(result.decomposition.knownTotalCents,75000);
});

test('comissão desconhecida e revisão manual obsoleta nunca viram comissão zero',()=>{
 const r=row();
 for(const patch of [{commissionCents:null},{contractKey:'previous-example-revision'}]){
  const result=build({rows:[r],finance:{contracts:{[r.u.id]:{...manual(r),...patch}}}});
  assert.equal(result.metrics.commission.cents,null);assert.equal(result.coverage.cents,null);assert.equal(result.decomposition.knownTotalCents,10000);assert.equal(result.decomposition.pending.length,1);
 }
 const zero=build({rows:[r],finance:{contracts:{[r.u.id]:{...manual(r),commissionCents:0}}}});assert.equal(zero.metrics.commission.cents,0);assert.equal(zero.coverage.cents,80000);
});

test('condição não confirmada fica pendente; canceladas e não vendidas aparecem nas exclusões',()=>{
 const a=row(),b=row('example-b'),c=row('example-c');a.contrato.unidadeRevisao='old-example';b.contrato.cancelado=true;c.u.status='Reservado';
 const result=build({rows:[a,b,c]});assert.equal(result.decomposition.pending[0].reason,'unconfirmed');assert.deepEqual(result.decomposition.excluded.map(x=>x.reason),['cancelled','not_sold']);assert.equal(result.coverage.cents,null);assert.equal(result.coverage.knownCents,10000);
});

test('não infere origem por cliente, observação informal, final, permuta ou protótipo do map',()=>{
 const r=row();r.row={tipo:'scp'};r.nome='SCP Exemplo';r.contrato.observacoes='Conversa informal sobre SCP.';
 const result=build({rows:[r]},Object.create({[r.u.id]:'scp'}));assert.equal(parts(result).unknown.cents,50000);assert.equal(parts(result).scp.cents,0);
 const invalid=build({rows:[r]},{[r.u.id]:'SCP'});assert.equal(parts(invalid).unknown.cents,50000);
});

test('simulador usa somente apartamentos disponíveis e separa a loja e as reservas',()=>{
 const values=[345,410,455,360,390,420,440,480],rows=values.map((n,i)=>stock('example-stock-'+i,n*100000));rows.push(stock('example-shop',70000000,'Disponível',' Loja '),stock('example-reserved',38000000,'Reservado'));
 const result=build({rows,settings:{targetCents:200000000},finance:{contributionsCents:73000000}}),s=result.simulation;
 assert.equal(s.availableCount,8);assert.equal(s.shops.length,1);assert.equal(s.availableGrossCents,330000000);assert.equal(s.availableContributionCents,148500000);assert.equal(s.averagePriceCents,41250000);assert.equal(s.averageContributionCents,18562500);assert.equal(s.gapCents,127000000);assert.equal(s.estimatedCount,7);assert.equal(s.possibleCount,7);assert.equal(s.insufficient,false);assert.equal(s.remainingGapCents,0);
});

test('seleção real mantém valores dos apartamentos e ignora loja sem contaminar a média',()=>{
 const rows=[stock('example-a',100000),stock('example-b',300000),stock('example-shop',900000,'Disponível','LOJA')];
 const result=build({rows,settings:{targetCents:100000,selectedInventoryIds:['example-b','example-shop']},finance:{contributionsCents:0}}),s=result.simulation;
 assert.equal(s.availableCount,2);assert.deepEqual(s.selection.ids,['example-b']);assert.equal(s.selection.count,1);assert.equal(s.selection.grossCents,300000);assert.equal(s.selection.contributionCents,135000);assert.equal(s.selection.remainingGapCents,0);assert.equal(s.selection.surplusCents,35000);assert.equal(s.selection.coversGap,true);assert.deepEqual(s.selection.ignoredShopIds,['example-shop']);
});

test('seleção obsoleta ou duplicada não confirma cobertura',()=>{
 for(const ids of [['example-missing'],['example-a','example-a'],['example-reserved']]){
  const s=build({rows:[stock('example-a',100000),stock('example-reserved',100000,'Reservado')],settings:{selectedInventoryIds:ids}}).simulation;
  assert.equal(s.selection.complete,false);assert.equal(s.selection.contributionCents,null);assert.equal(s.selection.coversGap,null);
 }
});

test('preço ausente da loja não bloqueia a estimativa de apartamentos; apartamento sem preço bloqueia',()=>{
 const a=build({rows:[stock('example-a',100000),stock('example-shop',null,'Disponível','LOJA')]}).simulation;
 assert.equal(a.inventoryComplete,true);assert.equal(a.estimatedCount,5);
 const b=build({rows:[stock('example-a',100000),stock('example-b',null)]}).simulation;
 assert.equal(b.inventoryComplete,false);assert.equal(b.estimatedCount,null);assert.equal(b.availableGrossCents,null);assert.equal(b.availableGrossKnownCents,100000);assert.equal(b.pricedCount,1);
});

test('comissão futura não preenchida bloqueia estimativa sem fabricar zero',()=>{
 const s=build({rows:[stock('example-a',100000)],settings:{futureCommissionRate:null}}).simulation;
 assert.equal(s.rates.P,.5);assert.equal(s.rates.C,null);assert.equal(s.rates.valid,false);assert.equal(s.estimatedCount,null);assert.equal(s.averageContributionCents,null);assert.equal(s.availableContributionCents,null);assert.equal(s.selection.coversGap,null);assert.equal(s.averagePriceCents,100000);
});

test('cenário parcial usa falta conhecida sem apresentá-la como cobertura definitiva',()=>{
 const r=row();r.contrato.total=200000;
 const result=build({rows:[r,stock('example-stock',100000)]}),s=result.simulation;
 assert.equal(result.coverage.gapCents,null);assert.equal(result.coverage.knownGapCents,190000);assert.equal(s.gapCents,190000);assert.equal(s.gapBasis,'known');assert.equal(s.partial,true);assert.equal(s.definitive,false);assert.equal(s.estimatedCount,5);assert.equal(s.possibleCount,1);assert.equal(s.insufficient,true);assert.equal(s.remainingGapCents,145000);
});

test('estoque vazio e contribuição individual zero não prometem apartamentos suficientes',()=>{
 for(const rows of [[],[stock('example-tiny',1)]]){
  const s=build({rows,finance:{contributionsCents:0}}).simulation;assert.equal(s.estimatedCount,null);assert.equal(s.insufficient,true);assert.equal(s.availableContributionCents,0);
 }
 assert.equal(build({rows:[]}).simulation.possibleCount,0);
});

test('arredondamento da média é só visual: ceil usa fração exata sem erro de centavo',()=>{
 const s=build({rows:[stock('example-a',1),stock('example-b',2)],settings:{targetCents:2,futureCommissionRate:0},finance:{contributionsCents:0}}).simulation;
 assert.equal(s.availableContributionCents,1);assert.equal(s.averageContributionCents,1);assert.equal(s.estimatedCount,4);assert.equal(s.possibleCount,2);assert.equal(s.insufficient,true);
});

test('estoque insuficiente permanece insuficiente e excesso de cobertura aparece sem falta negativa',()=>{
 const insufficient=build({rows:[stock('example-a',100000)],finance:{contributionsCents:0}}).simulation;
 assert.equal(insufficient.estimatedCount,5);assert.equal(insufficient.possibleCount,1);assert.equal(insufficient.remainingGapCents,155000);
 const excessive=build({rows:[stock('example-a',100000)],finance:{contributionsCents:250000}});assert.equal(excessive.coverage.surplusCents,50000);assert.equal(excessive.coverage.surplusPercent,.25);assert.equal(excessive.coverage.gapCents,0);assert.equal(excessive.simulation.estimatedCount,0);
});

test('cobertura negativa causada por comissão continua reconciliada sem esconder a dedução',()=>{
 const r=row();r.contrato={...r.contrato,entrada:0,permutas:[],parcelas:[{quantidade:1,valor:100000}]};
 const result=build({rows:[r],finance:{contributionsCents:0,contracts:{[r.u.id]:{...manual(r),commissionCents:10000,finalSeriesIndices:[0],receivedCommonCents:0}}}});
 assert.equal(result.coverage.cents,-10000);assert.equal(result.coverage.percent,-.05);assert.equal(result.decomposition.totalCents,-10000);assert.equal(result.coverage.gapCents,210000);
});

test('BigInt permite produtos intermediários grandes e detecta estimativa ou soma fora da precisão',()=>{
 const max=Number.MAX_SAFE_INTEGER;
 const exact=build({rows:[stock('example-a',max-1000)],settings:{targetCents:max,futurePaymentShare:1,futureCommissionRate:0},finance:{contributionsCents:0}}).simulation;
 assert.equal(exact.estimatedCount,2);
 const overflow=build({rows:[stock('example-a',1),stock('example-b',2)],settings:{targetCents:max,futureCommissionRate:0},finance:{contributionsCents:0}}).simulation;
 assert.equal(overflow.estimatedCount,null);assert.equal(overflow.insufficient,true);
 const sumOverflow=build({rows:[stock('example-a',max),stock('example-b',max)],settings:{futurePaymentShare:1,futureCommissionRate:0}}).simulation;
 assert.equal(sumOverflow.availableGrossCents,null);assert.equal(sumOverflow.inventoryComplete,false);assert.equal(sumOverflow.estimatedCount,null);
});

test('posição ausente ou unidade duplicada impede simulação válida',()=>{
 const absent=build({rows:null});assert.equal(absent.coverage.complete,false);assert.equal(absent.simulation.inventoryComplete,false);assert.equal(absent.simulation.estimatedCount,null);
 const a=stock('example-duplicate',100000),duplicate=build({rows:[a,a]});assert.equal(duplicate.simulation.inventoryComplete,false);assert.equal(duplicate.simulation.estimatedCount,null);
});

test('meta ausente mantém o cenário incompleto mesmo quando contratos e estoque estão conferidos',()=>{
 const result=build({rows:[stock('example-stock',100000)],settings:{targetCents:null}}),s=result.simulation;
 assert.equal(result.coverage.complete,true);assert.equal(s.gapCents,null);assert.equal(s.estimatedCount,null);assert.equal(s.definitive,false);assert.equal(s.partial,true);assert.ok(result.issues.some(i=>i.code==='target_unknown'));
});

test('motor não altera modelo, classificação, seleção nem registros aninhados',()=>{
 const m=model({rows:[row(),stock('example-stock',100000)],settings:{selectedInventoryIds:['example-stock']}}),classification={'example-a':'scp'},before=clone(m),beforeClass=clone(classification);
 freeze(m);freeze(classification);const result=C.build({model:m,classifications:classification});assert.deepEqual(clone(m),before);assert.deepEqual(classification,beforeClass);assert.equal(result.simulation.apartments[0].selected,true);
});

test('helper de origem aceita somente fontes positivas previstas, sem nomes específicos',()=>{
 for(const text of ['Origem da venda: SCP. Contrato sintético.','A data cadastrada corresponde aos instrumentos SCP de 12/03/2024.','SCP/PBS, unidade DEMO.'])assert.equal(C.classifyOrigin({observacoes:text}),'scp');
 for(const text of ['Origem da venda: venda direta. Contrato sintético.','Fonte: CONTRATO_COMPRA_E_VENDA_EXEMPLO.pdf'])assert.equal(C.classifyOrigin({observacoes:text}),'direta');
 for(const text of ['', 'Cliente Exemplo SCP', 'Contrato será avaliado como SCP.', 'Venda normal','Origem da venda: SCPX.'])assert.equal(C.classifyOrigin({observacoes:text}),null);
 assert.equal(C.classifyOrigin({cliente:'SCP',origem:'scp',tipo:'direta'}),null);
});

test('origem negada, ambígua, em rascunho ou não confirmada permanece desconhecida',()=>{
 for(const text of ['Não é SCP. Origem da venda: SCP.','Sem instrumentos SCP.','Rascunho. Origem da venda: SCP.','Origem da venda: SCP. A confirmar.','Origem da venda: SCP. Origem da venda: venda direta.','SCP/PBS, unidade DEMO. Fonte: CONTRATO_COMPRA_E_VENDA_EXEMPLO.pdf','Não usar Fonte: CONTRATO_COMPRA_E_VENDA_EXEMPLO.pdf'])assert.equal(C.classifyOrigin({observacoes:text}),null,text);
});

test('referências a terceiros, exemplos, propostas e vínculos negados não provam origem',()=>{
 for(const text of ['Contrato de terceiro. A data cadastrada corresponde aos instrumentos SCP de 01/01/2026.','Contrato de terceiro. Fonte: CONTRATO_COMPRA_E_VENDA_EXEMPLO.pdf','Exemplo: A data cadastrada corresponde aos instrumentos SCP de 01/01/2026.','Proposta de contrato. A data cadastrada corresponde aos instrumentos SCP de 01/01/2026.','Origem da venda: SCP. Vínculo não existe.'])assert.equal(C.classifyOrigin({observacoes:text}),null,text);
});

test('unidade diferente no prefixo SCP não classifica outro apartamento',()=>{
 assert.equal(C.classifyOrigin({unidadeId:'u-101',observacoes:'SCP/PBS, unidade 999.'}),null);
 assert.equal(C.classifyOrigin({unidadeId:'u-101',observacoes:'SCP/PBS, unidade 101.'}),'scp');
 assert.equal(C.classifyOrigin({observacoes:'SCP/PBS, unidade 999.'},'101'),null);
 assert.equal(C.classifyOrigin({observacoes:'SCP/PBS, unidade 101.'},'101'),'scp');
});

test('módulo expõe a mesma API no navegador e no CommonJS',()=>{
 const browser=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../previsao-cobertura-domain.js'),'utf8'),browser);
 assert.deepEqual(Object.keys(browser.window.DiamondCoberturaDomain).sort(),['build','classifyOrigin']);assert.equal(browser.window.DiamondCoberturaDomain.classifyOrigin({observacoes:'Origem da venda: SCP.'}),C.classifyOrigin({observacoes:'Origem da venda: SCP.'}));
});
