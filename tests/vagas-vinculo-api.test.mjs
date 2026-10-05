import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { backend, copy, source } from './helpers.mjs';
const V = createRequire(import.meta.url)('../vagas-domain.js');
function fonte() {
  return { vinculos: [['Apartamento','Tipologia / Área','Cliente / Proprietário','Vaga Vinculada','Confirmação (V/R)','Pavimento da Vaga','Status','Contratos','Início','Término','Contador de Dias','Observações'], ...Array.from({length:82}, (_,i) => ['Apto '+(i+1),'40 m²','','','','','Disponível','','','','',''])] };
}
function fixture(options) {
  const b = backend(options), f = fonte(), estado = V.importar(f);
  b.table('domo_vagas_estado').set('diamond', { estado, revisao: 10 });
  return { b, f, estado, vaga: cod => V.efetivas(b.table('domo_vagas_estado').get('diamond').estado).find(v => v.codigo === cod) };
}
async function vincular(b, unidadeId='u-1', codigo='V01', user='domo') {
  const r = await b.request('vagas', { operacao:'carregar', unidadeId }, user);
  if(r.status!==200)return r;
  return b.request('vagas', { operacao:'vincularUnidade', unidadeId, codigo, revisao:r.revisao, unidadeRevisao:r.unidade.atualizadoEm||'' }, user);
}
const reserva = (u, extra={}) => ({ operacao:'reservar', unidadeId:u.id, revisao:u.atualizadoEm||'', cliente:'Cliente real', corretor:'Corretor real', prazo:'2030-01-01T15:00:00Z', motivo:'Reserva confirmada', ...extra });

test('vincula disponível sem cliente, preservando preço/status e pedidos de reserva', async () => {
  const {b,vaga} = fixture(), antes=copy(b.table('unidades').get('u-1'));
  b.table('reservas').set('u-1', { unidadeId:'u-1', cliente:'Pedido ainda pendente' });
  const r=await vincular(b); assert.equal(r.status,200,r.erro); assert.equal(r.revisao,11);
  assert.deepEqual(r.unidade,antes); assert.deepEqual(b.table('unidades').get('u-1'),antes); assert.equal(b.table('reservas').size,1);
  assert.equal(vaga('V01').situacao,'disponivel'); assert.equal(vaga('V01').apartamento,'Apto 1'); assert.equal(vaga('V01').cliente,''); assert.equal(vaga('V01').vinculoEstrutural,true); assert.equal(vaga('V01').somenteVinculo,true);
  assert.ok(!V.livres(r.estado).some(v=>v.codigo==='V01')); assert.ok(!V.paraProposta(r.estado).some(v=>v.codigo==='V01'));
  assert.equal(r.estado.historico.at(-1).acao,'vincularUnidade');
});
test('unidade vendida sem comprador vincula sem criar cliente ou venda na garagem', async () => {
  const {b,vaga}=fixture(),antes=copy(b.table('unidades').get('u-2'));
  const r=await vincular(b,'u-2'); assert.equal(r.status,200,r.erro); assert.deepEqual(r.unidade,antes); assert.equal(vaga('V01').cliente,''); assert.equal(vaga('V01').situacao,'disponivel');
});
test('vínculo herda dados existentes da linha da planilha sem exigir cliente fictício', async () => {
  const {b,f}=fixture(); f.vinculos[2][6]='Vendida';f.vinculos[2][7]='Assinaturas';f.vinculos[2][11]='Observação existente';
  b.table('domo_vagas_estado').get('diamond').estado=V.importar(f);
  const r=await vincular(b,'u-2');assert.equal(r.status,200,r.erro);
  const a=r.estado.ajustes.V01;assert.equal(a.situacao,'vendida');assert.equal(a.cliente,'');assert.equal(a.contrato,'Assinaturas');assert.equal(a.observacoes,'Observação existente');assert.equal(a.somenteVinculo,true);
});
test('recusa vaga ocupada, unidade já vinculada, fonte ausente e sincronização pendente', async () => {
  { const {b}=fixture(); await vincular(b);assert.equal((await vincular(b,'u-2','V01')).status,400);assert.equal((await vincular(b,'u-1','V02')).status,400); }
  { const {b}=fixture();b.table('unidades').set('u-LOJA',{id:'u-LOJA',unidade:'LOJA',status:'Disponível'});assert.equal((await vincular(b,'u-LOJA')).status,400); }
  { const {b}=fixture();b.table('domo_vagas_estado').get('diamond').estado.sync={pendente:{id:'em-curso'}};assert.equal((await vincular(b)).status,409); }
});
test('revisão obsoleta da unidade ou garagem não grava', async () => {
  const {b}=fixture();
  for(const patch of [{unidadeRevisao:'antiga'},{revisao:9}]){
    const r=await b.request('vagas',{operacao:'vincularUnidade',unidadeId:'u-1',codigo:'V01',revisao:10,unidadeRevisao:'',...patch});
    assert.equal(r.status,409);assert.equal(b.table('domo_vagas_estado').get('diamond').revisao,10);
  }
});
test('concorrência de preço ou vaga é recusada pela transação sem vínculo parcial', async () => {
  for(const tipo of ['unidade','garagem']){
    const {b}=fixture({beforeReservaCommit:({table})=>{if(tipo==='unidade')table('unidades').get('u-1').precoBase=312000;else table('domo_vagas_estado').get('diamond').revisao++;}});
    const r=await vincular(b);assert.equal(r.status,409,r.erro);assert.deepEqual(b.table('domo_vagas_estado').get('diamond').estado.ajustes,undefined);assert.equal(b.table('reservas_historico').size,0);
  }
});
test('duas unidades não recebem a mesma vaga em gravações simultâneas', async () => {
  const {b}=fixture();const rr=await Promise.all([vincular(b,'u-1'),vincular(b,'u-2')]);
  assert.equal(rr.filter(r=>r.ok).length,1);assert.equal(rr.filter(r=>r.status===409).length,1);assert.equal(b.table('domo_vagas_estado').get('diamond').revisao,11);
});
test('consulta da unidade atual e vínculo ficam restritos à gestão', async () => {
  const {b}=fixture();b.table('cfg').get('usuarios').push({usuario:'externo',papel:'corretor',hash:'fake',ativo:true});
  for(const user of ['cliente','externo',null])assert.equal((await vincular(b,'u-1','V01',user)).status,403);
  const r=await b.request('vagas',{operacao:'carregar',unidadeId:'u-1'},'admin');assert.equal(r.unidade.id,'u-1');assert.equal(r.revisao,10);
});
test('reserva futura reutiliza vaga estrutural própria e cancelamento conserva associação', async () => {
  const {b,vaga}=fixture();await vincular(b);
  const r=await b.request('reservasPainel',reserva(b.table('unidades').get('u-1')));assert.equal(r.status,200,r.erro);
  assert.equal(r.unidade.reserva.vaga,'V01');assert.equal(r.unidade.reserva.vagaEstrutural,true);assert.equal(vaga('V01').situacao,'reservada');
  const c=await b.request('reservasPainel',{operacao:'cancelar',unidadeId:'u-1',revisao:r.unidade.atualizadoEm,motivo:'Desistência'});assert.equal(c.status,200,c.erro);
  assert.equal(vaga('V01').situacao,'disponivel');assert.equal(vaga('V01').apartamento,'Apto 1');assert.equal(vaga('V01').cliente,'');assert.equal(vaga('V01').reserva,'');assert.ok(!V.livres(b.table('domo_vagas_estado').get('diamond').estado).some(v=>v.codigo==='V01'));
});
test('vínculo durante reserva atualiza referência sem mudar seus termos e permite prorrogar/vender', async () => {
  const {b,vaga}=fixture();const r=await b.request('reservasPainel',reserva(b.table('unidades').get('u-1')));assert.equal(r.status,200,r.erro);
  const antes=copy(r.unidade.reserva),v=await vincular(b);assert.equal(v.status,200,v.erro);assert.deepEqual(v.unidade.reserva,{...antes,vaga:'V01',vagaEstrutural:true});
  const p=await b.request('reservasPainel',reserva(v.unidade,{operacao:'prorrogar',prazo:'2030-02-01T15:00:00Z'}));assert.equal(p.status,200,p.erro);assert.equal(vaga('V01').situacao,'reservada');
  const venda=await b.request('reservasPainel',{operacao:'vender',unidadeId:'u-1',revisao:p.unidade.atualizadoEm,motivo:'Contrato confirmado'});assert.equal(venda.status,200,venda.erro);assert.equal(vaga('V01').situacao,'vendida');assert.equal(vaga('V01').apartamento,'Apto 1');
});
test('não permite usar estrutural de outra unidade nem contornar a própria', async () => {
  const {b}=fixture();await vincular(b);
  b.table('unidades').get('u-2').status='Disponível';
  assert.equal((await b.request('reservasPainel',reserva(b.table('unidades').get('u-2'),{vaga:'V01'}))).status,409);
  assert.equal((await b.request('reservasPainel',reserva(b.table('unidades').get('u-1'),{vaga:'V02'}))).status,409);
});
test('reserva avulsa anterior mantém cancelamento que libera a vaga completamente', async () => {
  const {b,vaga}=fixture();const r=await b.request('reservasPainel',reserva(b.table('unidades').get('u-1'),{vaga:'V01'}));assert.equal(r.status,200,r.erro);assert.equal(r.unidade.reserva.vagaEstrutural,undefined);
  const c=await b.request('reservasPainel',{operacao:'cancelar',unidadeId:'u-1',revisao:r.unidade.atualizadoEm,motivo:'Desistência'});assert.equal(c.status,200,c.erro);assert.equal(vaga('V01').apartamento,'');assert.equal(vaga('V01').cliente,'');assert.equal(vaga('V01').situacao,'disponivel');
});
test('editar ou transferir estrutural mantém o vínculo e os dois domínios são iguais', () => {
  const {estado}=fixture();estado.ajustes={V01:V.validarVinculoUnidade('V01','1',estado)};
  const a=V.validarAjuste('V01',{...estado.ajustes.V01,observacoes:'Conferido'},estado);assert.equal(a.vinculoEstrutural,true);assert.equal(a.somenteVinculo,undefined);
  const t=V.validarMudancaVaga('V01','V02',a,estado);assert.equal(t.destino.vinculoEstrutural,true);assert.equal(t.origem.apartamento,'');assert.equal(t.origem.vinculoEstrutural,false);
  assert.equal(source('vagas-domain.js'),source('supabase/functions/dmd-api/vagas-domain.js'));
});
test('transferência estrutural durante reserva atualiza garagem e referência da reserva juntas', async () => {
  const {b,vaga}=fixture();await vincular(b);const reservada=await b.request('reservasPainel',reserva(b.table('unidades').get('u-1')));assert.equal(reservada.status,200);
  const row=b.table('domo_vagas_estado').get('diamond');
  const r=await b.request('vagas',{operacao:'salvar',codigo:'V01',destino:'V02',revisao:row.revisao,ajuste:{...vaga('V01'),motivo:'Troca solicitada'}});
  assert.equal(r.status,200,r.erro);assert.equal(r.unidade.reserva.vaga,'V02');assert.equal(r.unidade.reserva.vagaEstrutural,true);assert.equal(vaga('V01').apartamento,'');assert.equal(vaga('V02').apartamento,'Apto 1');
  const c=await b.request('reservasPainel',{operacao:'cancelar',unidadeId:'u-1',revisao:r.unidade.atualizadoEm,motivo:'Desistência'});assert.equal(c.status,200,c.erro);assert.equal(vaga('V02').apartamento,'Apto 1');assert.equal(vaga('V02').situacao,'disponivel');
});
test('edição de vaga aguarda ajuste comercial da sua unidade sem bloquear apartamentos independentes', async () => {
  const {b,vaga}=fixture();await vincular(b);const row=b.table('domo_vagas_estado').get('diamond');
  row.estado.ajustesUnidades={'Apto 1':{id:'pendente'}};
  const edit=await b.request('vagas',{operacao:'salvar',codigo:'V01',revisao:row.revisao,ajuste:{...vaga('V01'),motivo:'Editar observações'}});assert.equal(edit.status,409);
  const transfer=await b.request('vagas',{operacao:'salvar',codigo:'V01',destino:'V03',revisao:row.revisao,ajuste:{...vaga('V01'),motivo:'Trocar de vaga'}});assert.equal(transfer.status,409);
  assert.equal((await vincular(b,'u-2','V02')).status,200);
});
