import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { backend, copy } from './helpers.mjs';
const V=createRequire(import.meta.url)('../vagas-domain.js');
function fixture({garagem=true,antesCommit}={}){
 const b=backend({beforeReservaCommit:antesCommit});
 const u={id:'u-701',unidade:'701',status:'Vendido',precoBase:401234.4375,desconto:.04,precoVersao:'tabela-v2',compradorNome:'Comprador anterior',clienteId:'lead-701',clienteVinculadoNome:'Comprador anterior',compradorFonte:'cadastro',vendedorNome:'Corretor anterior',vendedorEmpresa:'Empresa anterior',atualizadoEm:'2026-10-05T12:00:00Z'};
 b.table('unidades').set(u.id,copy(u));b.table('leads').set('lead-701',{id:'lead-701',nome:'Comprador anterior'});b.table('propostas').set('p-701',{id:'p-701',unidadeId:'u-701',cliente:'Comprador anterior',neg:u.precoBase});
 const f={vinculos:[['Apartamento','Tipologia / Área','Cliente / Proprietário','Vaga Vinculada','Confirmação (V/R)','Pavimento da Vaga','Status','Contratos','Início','Término','Contador de Dias','Observações'],...Array.from({length:82},(_,i)=>['Apto '+(701+i),'40 m²',i===0?'Comprador anterior':'','','','','Vendida','Finalizado','','','',''])]};
 if(garagem)b.table('domo_vagas_estado').set('diamond',{estado:V.importar(f),revisao:20});
 return{b,u,f,estado:()=>b.table('domo_vagas_estado').get('diamond')?.estado};
}
const req=(u,extra={})=>({operacao:'reabrir',unidadeId:u.id,revisao:u.atualizadoEm||'',motivo:'Distrato confirmado pela direção',...extra});
test('reabre venda com motivo/histórico, preservando preço, CRM e propostas',async()=>{
 const {b,u}=fixture({garagem:false}),leads=copy([...b.table('leads')]),props=copy([...b.table('propostas')]);
 const r=await b.request('reservasPainel',req(u));assert.equal(r.status,200,r.erro);assert.equal(r.unidade.status,'Disponível');assert.equal(r.unidade.precoBase,u.precoBase);assert.equal(r.unidade.desconto,u.desconto);assert.equal(r.unidade.precoVersao,u.precoVersao);
 for(const k of ['compradorNome','clienteId','clienteVinculadoNome','compradorFonte','vendedorNome','vendedorEmpresa','reserva'])assert.equal(r.unidade[k],undefined,k);
 assert.deepEqual([...b.table('leads')],leads);assert.deepEqual([...b.table('propostas')],props);
 const h=(await b.request('reservasPainel',{operacao:'listar'})).historico.find(x=>x.acao==='reabrir');assert.equal(h.antes.compradorNome,u.compradorNome);assert.equal(h.antes.clienteId,u.clienteId);assert.equal(h.antes.vendedorNome,u.vendedorNome);assert.equal(h.depois.status,'Disponível');assert.equal(h.motivo,req(u).motivo);
});
test('recusa falta de motivo, revisão antiga, unidade não vendida e usuário sem permissão',async()=>{
 const {b,u}=fixture();b.table('cfg').get('usuarios').push({usuario:'externo',papel:'corretor',hash:'fake',ativo:true});
 for(const patch of [{motivo:''},{revisao:'antiga'}])assert.equal((await b.request('reservasPainel',req(u,patch))).status,409);
 for(const user of ['cliente','externo',null])assert.equal((await b.request('reservasPainel',req(u),user)).status,403);
 b.table('unidades').get(u.id).status='Disponível';assert.equal((await b.request('reservasPainel',req(u))).status,409);assert.equal(b.table('reservas_historico').size,0);
});
test('reabertura sem vaga limpa dados comerciais da linha da planilha sem inventar vínculo',async()=>{
 const {b,u,estado}=fixture();const r=await b.request('reservasPainel',req(u));assert.equal(r.status,200,r.erro);
 const a=estado().ajustesUnidades['Apto 701'];assert.equal(a.antes['cliente / proprietario'],'Comprador anterior');assert.equal(a.depois.status,'Disponível');assert.equal(a.depois['cliente / proprietario'],'');assert.equal(a.depois.contratos,'');assert.equal(a.depois['vaga vinculada'],undefined);
 assert.deepEqual(estado().ajustes,{});assert.equal(estado().historico.at(-1).acao,'reabrirUnidade');
});
test('reabertura preserva vaga estrutural própria e libera vaga comercial antiga',async()=>{
 for(const estrutural of [true,false]){
  const {b,u,estado}=fixture();const s=estado();s.ajustes={V18:{assinatura:s.vagas[17].assinatura,situacao:'vendida',apartamento:'Apto 701',cliente:'Comprador anterior',contrato:'Finalizado',reserva:'',expiracao:'',observacoes:'Conferência anterior',vinculoEstrutural:estrutural}};
  const r=await b.request('reservasPainel',req(u));assert.equal(r.status,200,r.erro);
  const v=V.efetivas(estado()).find(v=>v.codigo==='V18');assert.equal(v.situacao,'disponivel');assert.equal(v.apartamento,estrutural?'Apto 701':'');assert.equal(v.cliente,'');assert.equal(v.contrato,'');assert.equal(v.vinculoEstrutural,estrutural);assert.equal(v.observacoes,'Conferência anterior');
  assert.equal(estado().historico.at(-1).antes.cliente,'Comprador anterior');
 }
});
test('não libera nem reatribui vaga já movida para outro apartamento',async()=>{
 const {b,u,f,estado}=fixture();f.vinculos[1][3]='V18';f.vinculos[1][4]='V';b.table('domo_vagas_estado').get('diamond').estado=V.importar(f);
 const s=estado();s.ajustes={V18:{assinatura:s.vagas[17].assinatura,situacao:'vendida',apartamento:'Apto 702',cliente:'Outro comprador',contrato:'Assinaturas',reserva:'',expiracao:'',motivo:'Transferência já registrada'}};const outra=copy(s.ajustes.V18);
 const r=await b.request('reservasPainel',req(u));assert.equal(r.status,200,r.erro);assert.deepEqual(estado().ajustes.V18,outra);assert.equal(estado().ajustesUnidades['Apto 701'].depois['vaga vinculada'],undefined);
});
test('sem linha correspondente na planilha reabre somente a unidade',async()=>{
 const {b,u,f,estado}=fixture();f.vinculos[1][0]='Apto 999';b.table('domo_vagas_estado').get('diamond').estado=V.importar(f);
 const r=await b.request('reservasPainel',req(u));assert.equal(r.status,200,r.erro);assert.deepEqual(estado().ajustesUnidades,{});assert.equal(r.unidade.status,'Disponível');
});
test('conflito real de garagem, duplicidade ou sincronização pendente impede reabertura',async()=>{
 for(const modo of ['conflito','duplicado','pendente','ajusteUnidade']){
  const {b,u,estado}=fixture(),s=estado();
  if(modo==='conflito')Object.assign(s.vagas[0],{apartamento:'Apto 701',situacao:'conferir',alertas:['Vínculo divergente']});
  if(modo==='duplicado')for(const v of s.vagas.slice(0,2))Object.assign(v,{apartamento:'Apto 701',situacao:'vendida',cliente:'Comprador anterior'});
  if(modo==='pendente')s.sync={pendente:{id:'sync'}};
  if(modo==='ajusteUnidade')s.ajustesUnidades={'Apto 701':{id:'pendente'}};
  const r=await b.request('reservasPainel',req(u));assert.equal(r.status,409,modo+':'+r.erro);assert.equal(b.table('unidades').get(u.id).status,'Vendido');assert.equal(b.table('reservas_historico').size,0);
 }
});
test('CAS impede reabertura parcial quando unidade ou garagem mudou durante confirmação',async()=>{
 for(const modo of ['unidade','garagem']){
  const {b,u,estado}=fixture({antesCommit:({table})=>{if(modo==='unidade')table('unidades').get('u-701').compradorNome='Atualização concorrente';else table('domo_vagas_estado').get('diamond').revisao++;}});
  const r=await b.request('reservasPainel',req(u));assert.equal(r.status,409,r.erro);assert.equal(b.table('unidades').get(u.id).status,'Vendido');assert.equal(estado().ajustesUnidades,undefined);assert.equal(b.table('reservas_historico').size,0);
 }
});
test('rotas antigas não reabrem venda sem histórico',async()=>{
 const {b,u}=fixture();assert.equal((await b.request('setVendedor',{unidade:'701',status:'Disponível'})).status,409);assert.equal((await b.request('upsert',{unidade:{...u,status:'Disponível'}},'admin')).status,409);assert.equal(b.table('unidades').get(u.id).status,'Vendido');
});
