import { sb, getStore } from '../_shared/blobs-shim.mjs';
import './vagas-domain.js';
export async function executarVagas(b,usr,json){
const V=globalThis.DomoVagas,acao=b.operacao;const reply=(dados,status=200)=>json(status,dados.error?{...dados,erro:dados.error}:dados);
try{
    const {data:row,error}=await sb.from('domo_vagas_estado').select('estado,revisao,atualizado_em').eq('obra','diamond').maybeSingle();
    if(error)throw Error('Não foi possível consultar o espelho.');
    if(!row)return reply({error:'O espelho ainda não foi importado.'},404);
    if(acao==='paraProposta')return reply({ok:true,vagas:V.paraProposta(row.estado)});
    if(acao==='carregar'){
      const unidade=b.unidadeId?await getStore('unidades').get(String(b.unidadeId),{type:'json'}):undefined;
      if(b.unidadeId&&!unidade)return reply({error:'Unidade não encontrada. Atualize a lista.'},404);
      return reply({ok:true,...row,...(unidade?{unidade}:{})});
    }
    if(!['salvar','vincularUnidade','preverImportacao','importar'].includes(acao))return reply({error:'Ação inválida'},400);
    if(row.estado.sync?.pendente)return reply({error:'A planilha está confirmando uma atualização. Aguarde a sincronização antes de alterar os dados.'},409);
    const estado=structuredClone(row.estado);
    const por=usr.nome||usr.usuario;
    if(acao==='salvar'){
      const atual=V.efetivas(estado).find(v=>v.codigo===b.codigo);
      if(V.unidadeAguardandoPlanilha(estado,atual?.apartamento)||V.unidadeAguardandoPlanilha(estado,b.ajuste?.apartamento))return reply({error:'A unidade está aguardando a confirmação da reabertura na planilha. Aguarde a sincronização antes de alterar sua vaga.'},409);
    }
    let novo=estado,detalhe,unidadeAntes,unidadeDepois;
    if(acao==='vincularUnidade'){
      unidadeAntes=await getStore('unidades').get(String(b.unidadeId||''),{type:'json'});
      if(!unidadeAntes)return reply({error:'Unidade não encontrada. Atualize a lista.'},404);
      if((unidadeAntes.atualizadoEm||'')!==b.unidadeRevisao)return reply({error:'A unidade mudou. Reabra a escolha de vaga antes de confirmar.',conflito:true},409);
      if(V.unidadeAguardandoPlanilha(estado,unidadeAntes.unidade))return reply({error:'A unidade está aguardando a confirmação da reabertura na planilha. Aguarde a sincronização antes de vincular a vaga.'},409);
      const ajuste=V.validarVinculoUnidade(b.codigo,unidadeAntes.unidade,estado);
      unidadeDepois=unidadeAntes;
      if(unidadeAntes.status==='Reservado'){
        if(unidadeAntes.reserva?.vaga)return reply({error:'A reserva desta unidade já informa uma vaga. Confira o vínculo na aba Reservas.',conflito:true},409);
        unidadeDepois={...unidadeAntes,reserva:{...(unidadeAntes.reserva||{}),vaga:b.codigo,vagaEstrutural:true},atualizadoEm:new Date().toISOString(),atualizadoPor:usr.usuario};
      }
      detalhe={vaga:b.codigo,antes:V.efetivas(estado).find(v=>v.codigo===b.codigo),depois:ajuste,motivo:ajuste.motivo};
      novo.ajustes={...(estado.ajustes||{}),[b.codigo]:ajuste};
    }else if(acao==='salvar'&&b.destino&&b.destino!==b.codigo){
      // mudança de vaga: as DUAS mudam na mesma gravação, com uma revisão só
      const t=V.validarMudancaVaga(b.codigo,b.destino,b.ajuste||{},estado);
      detalhe={vaga:t.de+' → '+t.para,antes:V.efetivas(estado).find((v)=>v.codigo===t.de),depois:t.destino,motivo:t.destino.motivo};
      novo.ajustes={...(estado.ajustes||{}),[t.de]:t.origem,[t.para]:t.destino};
      // Keep the two ends associated even after earlier unsynced apartment moves
      // have erased the apartment name from the now-empty origin adjustment.
      novo.sync={...(estado.sync||{}),transferenciasPendentes:[...(estado.sync?.transferenciasPendentes||[]),{de:t.de,para:t.para}]};
    }else if(acao==='salvar'){
      const ajuste=V.validarAjuste(b.codigo,b.ajuste||{},estado);
      detalhe={vaga:b.codigo,antes:V.efetivas(estado).find((v)=>v.codigo===b.codigo),depois:ajuste,motivo:ajuste.motivo};
      novo.ajustes={...(estado.ajustes||{}),[b.codigo]:ajuste};
        }else{
      if(usr.papel!=='admin')return reply({error:'Somente a direção pode importar uma planilha.'},403);
      const imp=V.importar({...b.fonte,lidoEm:new Date().toISOString()});
      novo={...imp,ajustes:estado.ajustes||{},ajustesUnidades:estado.ajustesUnidades||{},sync:estado.sync||{},historico:estado.historico||[],fonte:{...imp.fonte,tipo:'Planilha importada'}};
      const mudaram=imp.vagas.filter((v)=>v.assinatura!==estado.vagas.find((x)=>x.codigo===v.codigo)?.assinatura).map((v)=>v.codigo);
      if(acao==='preverImportacao')return reply({ok:true,mudaram,alertas:V.efetivas(novo).filter((v)=>v.alertas.length).length,revisao:row.revisao});
      detalhe={motivo:'Importação de planilha conferida',vagasAlteradas:mudaram,fonteAnterior:estado.fonte,fonteNova:novo.fonte};
    }
    if(!Number.isSafeInteger(b.revisao)||b.revisao!==row.revisao)return reply({error:'Outra pessoa atualizou o espelho. Atualize e confira antes de salvar.',conflito:true},409);
    if(acao==='salvar'&&detalhe.antes?.vinculoEstrutural&&detalhe.antes.apartamento){
      const u=await getStore('unidades').get('u-'+V.chaveApartamento(detalhe.antes.apartamento),{type:'json'});
      if(u?.status==='Reservado'){
        if((u.reserva?.vaga&&u.reserva.vaga!==b.codigo)||V.chaveApartamento(detalhe.depois.apartamento)!==V.chaveApartamento(detalhe.antes.apartamento)||detalhe.depois.situacao!==detalhe.antes.situacao)return reply({error:'Esta vaga pertence a uma reserva ativa. Use a aba Reservas para alterar a situação ou liberar o vínculo.',conflito:true},409);
        unidadeAntes=u;
        unidadeDepois={...u,reserva:{...(u.reserva||{}),vaga:b.destino||b.codigo,vagaEstrutural:true},atualizadoEm:new Date().toISOString(),atualizadoPor:usr.usuario};
      }
    }
    novo.historico=[...(estado.historico||[]),{id:crypto.randomUUID(),em:new Date().toISOString(),por,acao,...detalhe}];
    if(unidadeAntes){
      const {data:unidade,error:e}=await sb.rpc('dmd_reserva_confirmar',{p_id:unidadeAntes.id,p_antes:unidadeAntes,p_depois:unidadeDepois,p_evento:{id:crypto.randomUUID(),unidadeId:unidadeAntes.id,unidade:unidadeAntes.unidade,acao:'atualizar',em:new Date().toISOString(),por,motivo:detalhe.motivo,antes:{status:unidadeAntes.status},depois:{status:unidadeDepois.status}},p_pedido_em:null,p_vagas_revisao:b.revisao,p_vagas_estado:novo,p_resolver_pedido:false});
      if(e)return reply({error:/CONFLITO/.test(e.message||'')?'A unidade ou a garagem mudou durante a confirmação. Atualize e confira novamente.':'Não foi possível salvar o vínculo. Nenhuma alteração foi confirmada.',conflito:/CONFLITO/.test(e.message||'')},/CONFLITO/.test(e.message||'')?409:503);
      return reply({ok:true,revisao:b.revisao+1,estado:novo,unidade,atualizado_em:new Date().toISOString()});
    }
    const {data:revisao,error:e}=await sb.rpc('domo_vagas_salvar',{p_revisao:b.revisao,p_estado:novo});
    if(e){if(e.message.includes('VAGAS_CONFLITO'))return reply({error:'O espelho mudou durante a gravação. Atualize e confira novamente.',conflito:true},409);throw Error('Não foi possível salvar. Tente novamente.');}
    return reply({ok:true,revisao,estado:novo,atualizado_em:new Date().toISOString()});
}catch(e){return json(400,{erro:e.message||'Não foi possível concluir.'})}
}
