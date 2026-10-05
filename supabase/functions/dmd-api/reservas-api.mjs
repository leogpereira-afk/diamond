import {sb,getStore} from '../_shared/blobs-shim.mjs';
import './vagas-domain.js';
const texto=(s,n=160)=>String(s||'').trim().slice(0,n);
export function prepararReserva(u,b,pedido,por,agora=new Date().toISOString()){
 const acao=b.operacao,anterior=u.reserva||{};
 if(!['reservar','prorrogar','cancelar','vender','recusar','reabrir'].includes(acao))throw Error('Operação inválida.');
 if(acao==='reabrir'&&u.status!=='Vendido')throw Error('Só uma unidade vendida pode ser reaberta por esta ação. Atualize a lista.');
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
 const comerciais=['compradorNome','comprador','clienteNome','cliente','compradorFonte','clienteId','clienteVinculadoNome','vendedorNome','vendedorEmpresa'];
 const origemComercial=Object.fromEntries(comerciais.filter(k=>Object.hasOwn(u,k)).map(k=>[k,u[k]]));
 if(acao==='reabrir'){depois.status='Disponível';delete depois.reserva;for(const k of comerciais)delete depois[k];}
 return {depois,event:{id:crypto.randomUUID(),unidadeId:u.id,unidade:u.unidade,acao,em:agora,por,motivo,antes:{status:u.status,reserva:u.reserva||null,pedido:pedido||null,...(acao==='reabrir'?origemComercial:{})},depois:{status:depois.status,reserva:depois.reserva||null,compradorNome:depois.compradorNome||''}}};
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
 const V=globalThis.DomoVagas;
 let garagem=null,propria=null;
 if(b.operacao==='reservar'||b.operacao==='reabrir'||u.status==='Reservado'||b.vaga||u.reserva?.vaga){
  const {data,error}=await sb.from('domo_vagas_estado').select('estado,revisao').eq('obra','diamond').maybeSingle();
  if(error)throw Error('Não foi possível conferir as vagas.');
  garagem=data;
  if(garagem){
   if(b.operacao!=='reabrir'&&V.unidadeAguardandoPlanilha(garagem.estado,u.unidade))throw Error('A unidade está aguardando a confirmação da reabertura na planilha. Aguarde a sincronização antes de alterar sua reserva.');
   const vinculadas=V.efetivas(garagem.estado).filter(v=>v.vinculoEstrutural&&V.chaveApartamento(v.apartamento)===V.chaveApartamento(u.unidade));
   if(vinculadas.length>1)throw Error('A unidade possui mais de uma vaga vinculada. Confira a garagem antes de alterar a reserva.');
   propria=vinculadas[0]||null;
   if(propria&&b.operacao!=='reabrir'){
    if(b.vaga&&b.vaga!==propria.codigo)throw Error('A unidade já possui a vaga '+propria.codigo+'. Para trocá-la, use a garagem antes de alterar a reserva.');
    if(u.reserva?.vaga&&u.reserva.vaga!==propria.codigo)throw Error('A vaga da reserva diverge da garagem. Confira o vínculo antes de continuar.');
    b={...b,vaga:propria.codigo};
   }
  }
 }
 const por=usr.nome||usr.usuario,{depois,event}=prepararReserva(u,b,pedido,por);
 let estado=null,revisao=null;
 const anterior=u.reserva?.vaga||'',codigo=depois.reserva?.vaga||anterior||propria?.codigo;
 if(b.operacao==='reabrir'&&garagem){
  if(garagem.estado.sync?.pendente)throw Error('A planilha está sincronizando. Aguarde a confirmação antes de reabrir a unidade.');
  const chave=V.chaveApartamento(u.unidade),efetivas=V.efetivas(garagem.estado);
  const vinculadas=efetivas.filter(v=>V.chaveApartamento(v.apartamento)===chave||(v.alertas.length&&(v.origem?.vinculos||[]).some(x=>V.chaveApartamento(x.apartamento)===chave)));
  if(vinculadas.length>1||vinculadas.some(v=>v.alertas.length||v.situacao==='conferir'))throw Error('A garagem desta unidade possui um vínculo divergente. Confira as vagas antes de reabrir.');
  const linhas=garagem.estado.unidades.filter(x=>V.chaveApartamento(x.apartamento)===chave);
  if(linhas.length>1)throw Error('Há mais de uma linha para esta unidade na planilha. Confira antes de reabrir.');
  const v=vinculadas[0],ajustes={...garagem.estado.ajustes},ajustesUnidades={...garagem.estado.ajustesUnidades};
  let ajuste=null;
  if(v){
   ajuste=V.validarAjuste(v.codigo,{situacao:'disponivel',apartamento:v.vinculoEstrutural?v.apartamento:'',cliente:'',contrato:'',reserva:'',expiracao:'',observacoes:v.observacoes||'',motivo:texto(b.motivo,300)},garagem.estado);
   ajustes[v.codigo]=ajuste;
  }
  if(linhas[0]){
   const linha=linhas[0];
   if(ajustesUnidades[linha.apartamento])throw Error('A linha desta unidade já tem uma alteração aguardando a planilha. Aguarde a confirmação antes de reabrir.');
   ajustesUnidades[linha.apartamento]={id:event.id,em:event.em,por,motivo:event.motivo,antes:structuredClone(linha),depois:{'cliente / proprietario':'','confirmacao (v/r)':'',status:'Disponível',contratos:'',inicio:'',termino:''}};
  }
  estado={...garagem.estado,ajustes,ajustesUnidades,historico:[...(garagem.estado.historico||[]),{id:crypto.randomUUID(),em:event.em,por,acao:'reabrirUnidade',vaga:v?.codigo||'Apartamento '+u.unidade,unidade:u.unidade,antes:v||null,depois:ajuste,motivo:event.motivo}]};
  revisao=garagem.revisao;
 }else if(codigo){
  if(anterior&&b.operacao==='prorrogar'&&b.vaga!==anterior)throw Error('Para trocar a vaga, cancele a reserva e faça uma nova.');
  if(!garagem)throw Error('Não foi possível conferir as vagas.');
  if(garagem.estado.sync?.pendente)throw Error('A planilha está sincronizando. Aguarde e tente novamente.');
  const v=V.efetivas(garagem.estado).find(x=>x.codigo===codigo);
  if(!v||v.alertas.length||v.situacao==='conferir')throw Error('A vaga precisa de conferência.');
  const estrutural=!!propria&&propria.codigo===codigo;
  if(!anterior&&(v.situacao!=='disponivel'||(!estrutural&&(v.apartamento||v.cliente))))throw Error('A vaga já não está disponível.');
  if(anterior&&((v.situacao!=='reservada'&&!(estrutural&&v.situacao==='disponivel'))||V.chaveApartamento(v.apartamento)!==V.chaveApartamento(u.unidade)))throw Error('O vínculo da vaga mudou. Confira o espelho de vagas.');
  if(depois.reserva){depois.reserva.vaga=codigo;if(estrutural)depois.reserva.vagaEstrutural=true;else delete depois.reserva.vagaEstrutural;}
  const r=depois.reserva||u.reserva;const dia=s=>new Date(s).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  const ajuste=V.validarAjuste(codigo,{situacao:b.operacao==='cancelar'?'disponivel':b.operacao==='vender'?'vendida':'reservada',apartamento:b.operacao==='cancelar'?(estrutural?v.apartamento:''):propria?.apartamento||'Apto '+u.unidade,cliente:b.operacao==='cancelar'?'':b.operacao==='vender'?depois.compradorNome:r.cliente,reserva:b.operacao==='cancelar'?'':dia(r.inicio),expiracao:b.operacao==='cancelar'?'':dia(r.prazo),motivo:b.motivo,observacoes:v.observacoes||'',contrato:v.contrato||''},garagem.estado);
  estado={...garagem.estado,ajustes:{...garagem.estado.ajustes,[codigo]:ajuste},historico:[...(garagem.estado.historico||[]),{id:crypto.randomUUID(),em:event.em,por,acao:'reservaApartamento',vaga:codigo,antes:v,depois:ajuste,motivo:b.motivo}]};revisao=garagem.revisao;
 }
 const {data,error}=await sb.rpc('dmd_reserva_confirmar',{p_id:u.id,p_antes:u,p_depois:depois,p_evento:event,p_pedido_em:b.pedidoEm||null,p_vagas_revisao:revisao,p_vagas_estado:estado,p_resolver_pedido:b.operacao!=='reabrir'});
 if(error)throw Error(/CONFLITO/.test(error.message)?'Os dados mudaram durante a confirmação. Atualize e confira novamente.':'Não foi possível salvar. Nenhuma alteração foi confirmada.');
 return json(200,{ok:true,unidade:data});
 }catch(e){return json(409,{erro:e.message});}
}
