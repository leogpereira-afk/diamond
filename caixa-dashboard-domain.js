/* Dashboards de leitura: mesma competência, filtros e centavos do Caixa. */
(function(root){
  'use strict';
  const base=()=>root.DiamondCaixaDomain||(typeof require==='function'?require('./caixa-domain.js'):null);
  const centavos=n=>Number.isSafeInteger(n)&&n>=0;
  function ranking(modelo){
    const total=modelo.resumo.aReceber;
    const disponivel=centavos(total)&&modelo.filtradas.every(l=>!l.conferir&&centavos(l.saldo)&&centavos(l.recebido));
    if(!disponivel)return {disponivel:false,total:null,clientes:[]};
    const grupos=new Map();
    for(const linha of modelo.filtradas){
      if(linha.saldo===0)continue;
      const id=linha.clienteId;
      if(!id)return {disponivel:false,total:null,clientes:[]};
      let cliente=grupos.get(id);
      if(!cliente){
        cliente={id,nome:String(linha.cliente||'Comprador não identificado'),unidades:new Set(),previsto:0,recebido:0,aReceber:0,parcelas:0};
        grupos.set(id,cliente);
      }
      cliente.unidades.add(String(linha.unidade??linha.unidadeId));
      cliente.previsto+=linha.valor;cliente.recebido+=linha.recebido;cliente.aReceber+=linha.saldo;cliente.parcelas++;
    }
    const clientes=[...grupos.values()].map(c=>({...c,unidades:[...c.unidades].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true})),participacao:total>0?c.aReceber/total:0}));
    // Um total inválido ou que não reconcilia nunca vira percentual aparente.
    if(clientes.some(c=>![c.previsto,c.recebido,c.aReceber].every(centavos)||c.participacao<0||c.participacao>1)
      ||clientes.reduce((s,c)=>s+c.aReceber,0)!==total)return {disponivel:false,total:null,clientes:[]};
    clientes.sort((a,b)=>b.aReceber-a.aReceber||a.nome.localeCompare(b.nome,'pt-BR')||String(a.id).localeCompare(String(b.id)));
    return {disponivel:true,total,clientes};
  }
  function build(source={},modeloAtualOpcional){
    const D=base();
    if(!D||typeof D.build!=='function')throw Error('O motor do Caixa não está disponível. Atualize a página.');
    // A fonte é sempre recalculada: um modelo anterior não pode misturar mês,
    // busca ou situação antigos aos filtros que o usuário está vendo agora.
    void modeloAtualOpcional;
    const atual=D.build(source),mensal=[];
    if(atual.mes!=='sem-data'){
      let mes=atual.mes;
      for(let i=0;i<6;i++){
        const modelo=i===0?atual:D.build({...source,hoje:atual.hoje,mes});
        const r=modelo.resumo;
        mensal.push({mes,previsto:r.previsto,recebido:r.recebidoParcelas,aReceber:r.aReceber,parcelas:modelo.filtradas.length,conferir:r.recebidoParcelas===null||r.aReceber===null,semParcelas:modelo.filtradas.length===0});
        if(mes==='2199-12')break;
        mes=D.somarMeses(mes+'-01',1).slice(0,7);
      }
    }
    const porCliente=ranking(atual),pendencias=atual.pendencias.map(p=>({...p}));
    return {mes:atual.mes,periodo:mensal.length?{inicio:mensal[0].mes,fim:mensal.at(-1).mes,quantidade:mensal.length}:null,mensal,ranking:porCliente,
      cobertura:{pendencias,incompleta:pendencias.length>0||atual.ledgerInvalido||mensal.some(m=>m.conferir)||!porCliente.disponivel}};
  }
  const api={build};root.DiamondCaixaDashboardDomain=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
