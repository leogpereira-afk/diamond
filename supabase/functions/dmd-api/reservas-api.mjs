import {sb,getStore} from '../_shared/blobs-shim.mjs';
import './vagas-domain.js';
const texto=(s,n=160)=>String(s||'').trim().slice(0,n);
export function prepararReserva(u,b,pedido,por,agora=new Date().toISOString()){
 const acao=b.operacao,anterior=u.reserva||{};
 if(!['reservar','prorrogar','cancelar','vender','recusar'].includes(acao))throw Error('Operação inválida.');
 if(acao==='reservar'&&u.status!=='Disponível')throw Error('O apartamento não está disponível. Atualize a tela.');
 if(['prorrogar','cancelar','vender'].includes(acao)&&u.status!=='Reservado')throw Error('O apartamento não está reservado. Atualize a tela.');
 if(acao==='recusar'&&(!pedido||u.status!=='Disponível'))throw Error('O pedido já foi resolvido. Atualize a tela.');
 if((u.atualizadoEm||'')!==(b.revisao||''))throw Error('O apartamento mudou. Atualize antes de confirmar.');
 const motivo=texto(b.motivo,600);if(!motivo)throw Error('Informe o motivo da operação.');
 let r={...anterior};
 if(['reservar','prorrogar'].includes(acao)){
  r={...r,cliente:texto(b.cliente||pedido?.cliente),telefone:texto(b.telefone,40),corretor:texto(b.corretor||pedido?.corretor),empresa:texto(b.empresa||pedido?.empresa),prazo:texto(b.prazo,30),inicio:anterior.inicio||agora,vaga:texto(b.vaga,4)};
  if(!r.cliente||!r.corretor)throw Error('Informe cliente e corretor.');
  if(!/^\d{4}-\d{2}-\d{2}T/.test(r.prazo)||!Number.isFinite(Date.parse(r.prazo))||Date.parse(r.prazo)<=Date.parse(agora))throw Error('Defina um prazo futuro para a reserva.');
  if(acao==='prorrogar'&&anterior.prazo&&Date.parse(r.prazo)<=Date.parse(anterior.prazo))throw Error('O novo prazo deve ser posterior ao prazo atual.');
 }
 const depois={...u,atualizadoEm:agora,atualizadoPor:por};
 if(acao==='reservar'||acao==='prorrogar'){depois.status='Reservado';depois.reserva=r;depois.vendedorNome=r.corretor;depois.vendedorEmpresa=r.empresa;}
 if(acao==='cancelar'){depois.status='Disponível';delete depois.reserva;depois.vendedorNome='';depois.vendedorEmpresa='';}
 if(acao==='vender'){const cliente=texto(b.cliente||r.cliente);if(!cliente)throw Error('Informe o comprador antes de converter em venda.');depois.status='Vendido';depois.compradorNome=cliente;delete depois.reserva;}
 return {depois,event:{id:crypto.randomUUID(),unidadeId:u.id,unidade:u.unidade,acao,em:agora,por,motivo,antes:{status:u.status,reserva:u.reserva||null,pedido:pedido||null},depois:{status:depois.status,reserva:depois.reserva||null,compradorNome:depois.compradorNome||''}}};
}
export async function executarReservas(b,usr,json){
 try{
 const unidades=getStore('unidades'),pedidos=getStore('reservas'),hist=getStore('reservas_historico');
 if(b.operacao==='listar'){
  const [uu,pp,hh]=await Promise.all([unidades.listJSON(),pedidos.listJSON(),hist.listJSON()]);
  const historico=hh.map(r=>r.valor).filter(x=>x&&x.acao!=='atualizar').sort((a,b)=>b.em.localeCompare(a.em));
  return json(200,{ok:true,unidades:uu.map(r=>r.valor).filter(Boolean),pedidos:pp.map(r=>r.valor).filter(Boolean),historico});
 }
 const u=await unidades.get(texto(b.unidadeId,40),{type:'json'});if(!u)return json(404,{erro:'Apartamento não encontrado.'});
 const pedido=await pedidos.get(u.id,{type:'json'});
 if(pedido&&b.operacao==='reservar'&&b.pedidoEm!==pedido.em)return json(409,{erro:'Existe um pedido para esta unidade. Abra o pedido antes de confirmar.'});
 if(b.pedidoEm&&b.pedidoEm!==pedido?.em)return json(409,{erro:'O pedido mudou. Atualize a tela.'});
 const por=usr.nome||usr.usuario,{depois,event}=prepararReserva(u,b,pedido,por);
 let estado=null,revisao=null;
 const anterior=u.reserva?.vaga||'',codigo=depois.reserva?.vaga||anterior;
 if(codigo){
  if(anterior&&b.operacao==='prorrogar'&&b.vaga!==anterior)throw Error('Para trocar a vaga, cancele a reserva e faça uma nova.');
  const {data,error}=await sb.from('domo_vagas_estado').select('estado,revisao').eq('obra','diamond').maybeSingle();if(error||!data)throw Error('Não foi possível conferir as vagas.');
  if(data.estado.sync?.pendente)throw Error('A planilha está sincronizando. Aguarde e tente novamente.');
  const V=globalThis.DomoVagas,v=V.efetivas(data.estado).find(x=>x.codigo===codigo);
  if(!v||v.alertas.length||v.situacao==='conferir')throw Error('A vaga precisa de conferência.');
  if(!anterior&&v.situacao!=='disponivel')throw Error('A vaga já não está disponível.');
  if(anterior&&(v.situacao!=='reservada'||v.apartamento!=='Apto '+u.unidade))throw Error('O vínculo da vaga mudou. Confira o espelho de vagas.');
  const r=depois.reserva||u.reserva;const dia=s=>new Date(s).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  const ajuste=V.validarAjuste(codigo,{situacao:b.operacao==='cancelar'?'disponivel':b.operacao==='vender'?'vendida':'reservada',apartamento:b.operacao==='cancelar'?'':'Apto '+u.unidade,cliente:b.operacao==='cancelar'?'':b.operacao==='vender'?depois.compradorNome:r.cliente,reserva:b.operacao==='cancelar'?'':dia(r.inicio),expiracao:b.operacao==='cancelar'?'':dia(r.prazo),motivo:b.motivo,observacoes:v.observacoes||'',contrato:v.contrato||''},data.estado);
  estado={...data.estado,ajustes:{...data.estado.ajustes,[codigo]:ajuste},historico:[...(data.estado.historico||[]),{id:crypto.randomUUID(),em:event.em,por,acao:'reservaApartamento',vaga:codigo,antes:v,depois:ajuste,motivo:b.motivo}]};revisao=data.revisao;
 }
 const {data,error}=await sb.rpc('dmd_reserva_confirmar',{p_id:u.id,p_antes:u,p_depois:depois,p_evento:event,p_pedido_em:b.pedidoEm||null,p_vagas_revisao:revisao,p_vagas_estado:estado});
 if(error)throw Error(/CONFLITO/.test(error.message)?'Os dados mudaram durante a confirmação. Atualize e confira novamente.':'Não foi possível salvar. Nenhuma alteração foi confirmada.');
 return json(200,{ok:true,unidade:data});
 }catch(e){return json(409,{erro:e.message});}
}
