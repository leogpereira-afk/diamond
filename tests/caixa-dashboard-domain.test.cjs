const {test}=require('node:test'),assert=require('node:assert/strict');
const D=require('../caixa-domain.js'),Dash=require('../caixa-dashboard-domain.js');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const u={id:'qa-u1',unidade:'QA01',status:'Vendido',clienteId:'qa-c1',atualizadoEm:'r1'};
 const c={unidadeId:u.id,clienteId:u.clienteId,unidadeRevisao:'r1',data:'2026-01-01',total:100001,entrada:10000,permutas:[{valor:20000}],parcelas:[{descricao:'Mensais',valor:35000,quantidade:2,intervalo:1,primeiro:'2026-10-31'},{descricao:'Centavo final',valor:1,quantidade:1,intervalo:1,primeiro:'2026-12-01'}]};
 return {unidades:[u],condicoes:[c],leads:[{id:u.clienteId,cliente:'Cliente de exemplo'}],recebimentos:[],hoje:'2026-11-01',mes:'2026-10'};
}
function receber(s,{id='qa-e1',unidade=0,valor=10000,parcelaId='parcela:0:1',data='2026-11-01'}={}){
 const u=s.unidades[unidade],c=s.condicoes.find(c=>c.unidadeId===u.id);
 const e={id,operacaoId:'op-'+id,tipo:'receber',parcelaId,cronogramaChave:D.cronograma(c,u).chave,valor,data,em:data+'T12:00:00Z',fonte:{clienteId:u.clienteId,unidade:u.unidade,cliente:s.leads.find(l=>l.id===u.clienteId).cliente,descricao:'Mensais',vencimento:'2026-10-31'}};
 let l=s.recebimentos.find(l=>l.unidadeId===u.id);if(!l){l={unidadeId:u.id,revisao:0,eventos:[]};s.recebimentos.push(l);}l.eventos.push(e);l.revisao++;return e;
}
function adicionar(s,{id='qa-u2',clienteId='qa-c2',nome='Outro cliente',unidade='QA02',valor=25000,mes='2026-10'}={}){
 const u={id,unidade,status:'Vendido',clienteId,atualizadoEm:'r1'};
 const c={unidadeId:id,clienteId,unidadeRevisao:'r1',data:'2026-01-01',total:valor,entrada:0,permutas:[],parcelas:[{descricao:'Parcela única',valor,quantidade:1,intervalo:1,primeiro:mes+'-10'}]};
 s.unidades.push(u);s.condicoes.push(c);if(!s.leads.some(l=>l.id===clienteId))s.leads.push({id:clienteId,cliente:nome});return u;
}
test('seis meses consecutivos reconciliam exatamente com o Caixa por vencimento e preservam centavos',()=>{
 const s=fixture();receber(s);const r=Dash.build(s);
 assert.deepEqual(r.periodo,{inicio:'2026-10',fim:'2027-03',quantidade:6});
 assert.deepEqual(r.mensal.map(m=>m.mes),['2026-10','2026-11','2026-12','2027-01','2027-02','2027-03']);
 for(const m of r.mensal){const base=D.build({...s,mes:m.mes});assert.equal(m.previsto,base.resumo.previsto);assert.equal(m.recebido,base.resumo.recebidoParcelas);assert.equal(m.aReceber,base.resumo.aReceber);assert.equal(m.parcelas,base.filtradas.length);}
 assert.equal(r.mensal[0].recebido,10000);assert.equal(r.mensal[1].recebido,0,'Data real de novembro não muda competência da parcela de outubro');assert.equal(r.mensal[2].previsto,1);
 assert.equal(r.mensal.reduce((sum,m)=>sum+m.previsto,0),70001);
});
test('ranking usa o saldo do mês e agrupa IDs, mantendo compradores homônimos separados',()=>{
 const s=fixture();s.leads[0].cliente='Mesmo Nome';adicionar(s,{nome:'Mesmo Nome'});adicionar(s,{id:'qa-u3',clienteId:'qa-c1',unidade:'QA03',valor:1000});receber(s);
 const r=Dash.build(s),[a,b]=r.ranking.clientes;
 assert.equal(r.ranking.disponivel,true);assert.equal(r.ranking.total,51000);assert.equal(r.ranking.clientes.length,2);
 assert.equal(a.id,'qa-c1');assert.deepEqual(a.unidades,['QA01','QA03']);assert.equal(a.aReceber,26000);assert.equal(a.previsto,36000);assert.equal(a.recebido,10000);assert.equal(a.parcelas,2);
 assert.equal(b.id,'qa-c2');assert.equal(b.aReceber,25000);assert.equal(a.nome,b.nome);
 assert.equal(a.participacao,26000/51000);assert.equal(b.participacao,25000/51000);assert.equal(a.participacao+b.participacao,1);
});
test('ranking exclui parcelas quitadas sem reduzir o denominador do saldo ainda aberto',()=>{
 const s=fixture();adicionar(s);receber(s,{valor:35000});const r=Dash.build(s);
 assert.equal(r.ranking.total,D.build(s).resumo.aReceber);assert.equal(r.ranking.clientes.length,1);assert.equal(r.ranking.clientes[0].id,'qa-c2');assert.equal(r.ranking.clientes[0].participacao,1);
 assert.equal(r.mensal[0].previsto,60000);assert.equal(r.mensal[0].recebido,35000);
});
test('estorno reabre saldo no ranking e nos meses sem remover histórico nem inventar caixa',()=>{
 const s=fixture(),e=receber(s,{valor:35000}),l=s.recebimentos[0];
 l.eventos.push({...e,id:'qa-s1',operacaoId:'op-qa-s1',tipo:'estornar',eventoId:e.id,data:'2026-11-01'});l.revisao++;
 const r=Dash.build(s);assert.equal(r.mensal[0].recebido,0);assert.equal(r.mensal[0].aReceber,35000);assert.equal(r.ranking.clientes[0].aReceber,35000);assert.equal(s.recebimentos[0].eventos.length,2);
});
test('permuta não entra no gráfico nem no ranking e venda só permuta não gera parcela',()=>{
 const s=fixture();s.condicoes[0]={...s.condicoes[0],total:20000,entrada:0,parcelas:[]};const r=Dash.build(s);
 assert.ok(r.mensal.every(m=>m.previsto===0&&m.recebido===0&&m.aReceber===0&&m.semParcelas));assert.equal(r.ranking.total,0);assert.deepEqual(r.ranking.clientes,[]);assert.equal(r.cobertura.incompleta,false);
});
test('busca e situação são aplicadas a cada mês, com mesma normalização do Caixa',()=>{
 const s=fixture();s.leads[0].cliente='Ficção';adicionar(s);receber(s,{valor:35000});
 for(const filters of [{busca:'FICCAO',status:'pendentes'},{busca:'QA02',status:'todos'},{busca:'Mensais',status:'recebidas'},{busca:'',status:'vencidas'}]){
  const args={...s,...filters},r=Dash.build(args),atual=D.build(args);assert.equal(r.ranking.total,atual.resumo.aReceber);
  for(const m of r.mensal){const base=D.build({...args,mes:m.mes});assert.equal(m.parcelas,base.filtradas.length);assert.equal(m.previsto,base.resumo.previsto);assert.equal(m.aReceber,base.resumo.aReceber);}
 }
});
test('mês sem parcelas é distinguido de mês com parcelas inteiramente recebidas',()=>{
 const s=fixture();receber(s,{valor:35000});const r=Dash.build(s);
 assert.equal(r.mensal[0].aReceber,0);assert.equal(r.mensal[0].semParcelas,false);assert.equal(r.mensal[0].parcelas,1);
 assert.equal(r.mensal[3].aReceber,0);assert.equal(r.mensal[3].semParcelas,true);assert.equal(r.mensal[3].parcelas,0);assert.equal(r.mensal[3].conferir,false);
});
test('saldo desconhecido não vira zero nem percentual, mesmo com outra unidade válida',()=>{
 const s=fixture();adicionar(s);receber(s);s.condicoes[0].correcao='Condição revisada';const r=Dash.build(s);
 assert.equal(r.mensal[0].conferir,true);assert.equal(r.mensal[0].previsto,60000);assert.equal(r.mensal[0].recebido,null);assert.equal(r.mensal[0].aReceber,null);
 assert.deepEqual(r.ranking,{disponivel:false,total:null,clientes:[]});assert.equal(r.cobertura.incompleta,true);
});
test('cobertura é global e conserva pendências de fontes incompletas fora da busca',()=>{
 const s=fixture();adicionar(s);s.condicoes=s.condicoes.filter(c=>c.unidadeId!=='qa-u2');s.busca='QA01';
 const r=Dash.build(s);assert.equal(r.ranking.total,35000);assert.equal(r.cobertura.incompleta,true);assert.ok(r.cobertura.pendencias.some(p=>p.unidadeId==='qa-u2'&&/Condições/.test(p.motivo)));
 assert.deepEqual(r.cobertura.pendencias,D.build(s).pendencias);
});
test('histórico inválido conserva pendência e indisponibilidade onde há parcelas atingidas',()=>{
 const s=fixture();receber(s);s.recebimentos[0].revisao=9;const r=Dash.build(s);
 assert.equal(r.ranking.disponivel,false);assert.equal(r.ranking.total,null);assert.equal(r.mensal[0].conferir,true);assert.ok(r.cobertura.pendencias.some(p=>/inválido/.test(p.motivo)));
});
test('sem data mantém ranking da entrada, sem fabricar seis competências ou data de vencimento',()=>{
 const s=fixture();s.mes='sem-data';receber(s,{parcelaId:'entrada',valor:1});const r=Dash.build(s);
 assert.equal(r.periodo,null);assert.deepEqual(r.mensal,[]);assert.equal(r.ranking.total,9999);assert.equal(r.ranking.clientes[0].previsto,10000);assert.equal(r.ranking.clientes[0].recebido,1);assert.equal(r.ranking.clientes[0].participacao,1);
});
test('fim do calendário reduz período sem exceção e não ultrapassa dezembro de 2199',()=>{
 const s=fixture();s.mes='2199-10';s.hoje='2199-10-01';let r=Dash.build(s);assert.deepEqual(r.periodo,{inicio:'2199-10',fim:'2199-12',quantidade:3});assert.equal(r.mensal.length,3);
 r=Dash.build({...s,mes:'2199-12'});assert.equal(r.mensal.length,1);assert.equal(r.periodo.fim,'2199-12');
});
test('fontes, modelo opcional e resultados de outra rodada não são mutados ou usados como cache obsoleto',()=>{
 const s=fixture(),old=D.build({...s,busca:'inexistente'}),before=JSON.stringify(s),oldBefore=JSON.stringify(old);
 function freeze(v){if(v&&typeof v==='object'){Object.freeze(v);Object.values(v).forEach(freeze);}return v;}
 freeze(s);freeze(old);const r=Dash.build(s,old);assert.equal(r.ranking.total,35000);assert.equal(JSON.stringify(s),before);assert.equal(JSON.stringify(old),oldBefore);
 r.cobertura.pendencias[0].motivo='Texto de outra tela';assert.notEqual(Dash.build(s).cobertura.pendencias[0].motivo,'Texto de outra tela');
});
test('mês inválido adota mês normalizado pelo motor, e fonte indisponível não gera dashboard vazio',()=>{
 const s=fixture(),r=Dash.build({...s,mes:'2026-99'});assert.equal(r.mes,'2026-11');assert.equal(r.periodo.inicio,'2026-11');
 assert.throws(()=>Dash.build({...s,unidades:null}),/indisponíveis/);
});
test('ranking não limita silenciosamente os clientes; empates têm ordenação determinística',()=>{
 const s=fixture();s.unidades=[];s.condicoes=[];s.leads=[];
 for(let i=0;i<8;i++)adicionar(s,{id:'qa-u'+i,clienteId:'qa-c'+i,nome:'Homônimo',unidade:'QA'+i,valor:1});
 const r=Dash.build(s);assert.equal(r.ranking.clientes.length,8);assert.equal(r.ranking.total,8);assert.ok(r.ranking.clientes.every(c=>c.participacao===1/8));assert.deepEqual(r.ranking.clientes.map(c=>c.id),Array.from({length:8},(_,i)=>'qa-c'+i));
});
