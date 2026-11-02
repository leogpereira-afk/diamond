import './previsao-custo-schema.js';

// A previsão pertence ao empreendimento. A revisão e a identidade de cada
// operação são conferidas novamente, de forma atômica, dentro do PostgreSQL.
const schema=globalThis.DiamondPrevisaoSchema;
const result=(status,data)=>({status,data});
const unavailable=()=>result(503,{erro:'Não foi possível confirmar o salvamento no sistema. Preserve os dados e tente novamente com a mesma operação.'});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function executarPrevisaoCusto(body,usr,{getStore,sb}={}){
  if(!usr||!(usr.papel==='admin'||usr.usuario==='domo'))return result(403,{erro:'Acesso restrito à gestão Diamond.'});
  if(!['carregar','salvar'].includes(body.operacao))return result(400,{erro:'Operação inválida.'});
  if(body.operacao==='carregar'){
    try{
      const saved=await getStore('previsao_custo').get('diamond',{type:'json'});
      const registro=saved===null?schema.envelope(0,null,schema.defaults()):schema.decode(JSON.stringify(saved));
      return result(200,{ok:true,registro});
    }catch{
      return result(503,{erro:'Não foi possível carregar a previsão salva no sistema. Tente novamente antes de editar.'});
    }
  }
  let dados;
  try{
    if(!Number.isSafeInteger(body.revisao)||body.revisao<0||body.revisao>=Number.MAX_SAFE_INTEGER)throw Error('Revisão inválida. Atualize os dados antes de salvar.');
    if(typeof body.operacaoId!=='string'||!uuid.test(body.operacaoId))throw Error('Identificador da operação inválido.');
    if(!body.dados||typeof body.dados!=='object'||Array.isArray(body.dados))throw Error('Registro da previsão inválido.');
    schema.size(JSON.stringify(body.dados));
    dados=schema.validate(body.dados);
    // Inclui os metadados no limite antes de gravar, evitando um registro que
    // foi aceito pelo banco mas não possa ser lido/exportado pelo aplicativo.
    schema.size(JSON.stringify(schema.envelope(body.revisao+1,'9999-12-31T23:59:59.999Z',dados,usr.usuario)));
  }catch(error){return result(400,{erro:error.message});}
  try{
    const current=await getStore('previsao_custo').get('diamond',{type:'json'});
    if(current?.data?.coverageConsolidation&&!Object.hasOwn(dados,'coverageConsolidation'))return result(409,{erro:'Atualize a página para preservar a consolidação registrada.'});
    const {data,error}=await sb.rpc('dmd_previsao_custo_salvar',{
      p_revisao:body.revisao,p_operacao_id:body.operacaoId,p_dados:dados,p_usuario:usr.usuario,
    });
    if(error){
      if(/PREVISAO_(?:CONFLITO|OPERACAO_CONFLITO)/.test(error.message||''))return result(409,{erro:'A previsão foi alterada ou a operação já foi utilizada. Atualize os dados do sistema antes de salvar novamente.'});
      if(/PREVISAO_INVALIDA/.test(error.message||''))return result(400,{erro:'Dados da previsão inválidos. Confira o registro antes de salvar.'});
      return unavailable();
    }
    if(!data?.registro)return unavailable();
    const registro=schema.decode(JSON.stringify(data.registro));
    return result(200,{ok:true,registro,...(data.repetida?{repetida:true}:{})});
  }catch{return unavailable();}
}
