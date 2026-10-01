// Cadastro canônico e vínculo explícito. O chamador já validou acesso Domo/admin.
import {getStore,sb} from '../_shared/blobs-shim.mjs';
import crypto from 'node:crypto';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const doc=s=>String(s||'').replace(/[^a-z0-9]/gi,'').toUpperCase();
const text=(v,max)=>String(v??'').trim().slice(0,max);
export async function executarClienteCadastro(body,usr,json){
 const leads=getStore('leads'),unidades=getStore('unidades');
 const unidadeId=text(body.unidadeId,80),id=text(body.id,80);
 const unidade=unidadeId?await unidades.get(unidadeId,{type:'json'}):null;
 if(unidadeId&&!unidade)return json(404,{erro:'Unidade não encontrada. Atualize a lista.'});
 if(body.operacao==='carregar'){
  const rows=(await leads.listJSON()).map(x=>x.valor).filter(Boolean);
  return json(200,{ok:true,unidade,leads:rows});
 }
 if(body.operacao!=='salvar')return json(400,{erro:'Operação de cadastro inválida.'});
 if(!/^lead-[a-z0-9-]+$/i.test(id))return json(400,{erro:'Identificador do cliente inválido.'});
 const antigo=await leads.get(id,{type:'json'});
 if((antigo?.atualizadoEm||null)!==(body.clienteAtualizadoEm||null))return json(409,{erro:'Este cliente foi alterado em outro acesso. Reabra o cadastro antes de salvar.'});
 if(unidade&&(unidade.atualizadoEm||null)!==(body.unidadeAtualizadaEm||null))return json(409,{erro:'A unidade mudou em outro acesso. Reabra o cadastro antes de vincular.'});
 const d=body.dados||{},c=d.cadastro||{};
 const cliente=text(d.cliente,80),clienteTel=text(d.clienteTel,30);
 const cadastro={tipoPessoa:c.tipoPessoa==='pj'?'pj':'pf',email:text(c.email,160),documento:text(c.documento,24),endereco:text(c.endereco,250),cidade:text(c.cidade,80),uf:text(c.uf,2).toUpperCase(),cep:text(c.cep,10),observacoes:text(c.observacoes,2000)};
 if(cliente.length<2)return json(400,{erro:'Informe o nome ou a razão social do cliente.'});
 if(cadastro.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cadastro.email))return json(400,{erro:'Confira o e-mail informado.'});
 if(cadastro.uf&&!/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(cadastro.uf))return json(400,{erro:'Informe uma UF válida.'});
 const rows=(await leads.listJSON()).map(x=>x.valor).filter(x=>x&&x.id!==id);
 if(doc(cadastro.documento)&&rows.some(x=>doc(x.cadastro?.documento)===doc(cadastro.documento)))return json(409,{erro:'Já existe um cadastro com esse CPF/CNPJ. Selecione o cliente existente.'});
 const duplicados=!antigo&&rows.filter(x=>norm(x.cliente)===norm(cliente)||(clienteTel.replace(/\D/g,'').length>=8&&x.clienteTel?.replace(/\D/g,'')===clienteTel.replace(/\D/g,''))||(cadastro.email&&norm(x.cadastro?.email)===norm(cadastro.email)));
 if(duplicados?.length&&!body.confirmarPessoaDiferente)return json(409,{erro:'Encontramos um cadastro com nome ou contato igual. Selecione o cliente existente ou confirme que são pessoas diferentes.',duplicados:duplicados.map(x=>({id:x.id,cliente:x.cliente}))});
 const stamp=new Date().toISOString();
 const lead={...(antigo||{id,empresaUsuario:usr.usuario,empresaNome:usr.nome||'Domo',corretorNome:text(body.comoCorretor||usr.nome,60),corretorTel:'',criadoEm:stamp,estagio:'novo',temp:'morno',unidade:unidade?.unidade||'',primeiroContato:stamp.slice(0,10),proximoContato:'',obs:''}),cliente,clienteTel,cadastro,atualizadoEm:stamp};
 const novaUnidade=unidade?{...unidade,clienteId:id,clienteVinculadoNome:cliente,atualizadoEm:stamp,atualizadoPor:usr.usuario}:null;
 if(novaUnidade?.status==='Vendido')novaUnidade.compradorNome=cliente;
 if(novaUnidade?.status==='Reservado'&&novaUnidade.reserva)novaUnidade.reserva={...novaUnidade.reserva,cliente,telefone:clienteTel};
 const evento={id:crypto.randomUUID(),clienteId:id,unidadeId:unidadeId||null,acao:antigo?'editar_cliente':'cadastrar_cliente',vinculoAnterior:unidade?.clienteId||null,em:stamp,por:usr.usuario};
 const {data,error}=await sb.rpc('dmd_cliente_salvar',{p_id:id,p_antes:antigo||null,p_depois:lead,p_unidade_id:unidadeId||null,p_unidade_antes:unidade,p_unidade_depois:novaUnidade,p_evento:evento});
 if(error)return json(409,{erro:String(error.message||'').includes('DOCUMENTO_DUPLICADO')?'Já existe um cadastro com esse CPF/CNPJ. Selecione o cliente existente.':'O cadastro ou a unidade mudou durante a gravação. Reabra para conferir antes de salvar.'});
 return json(200,{ok:true,lead,unidade:novaUnidade,unidades:data?.unidades||[]});
}
