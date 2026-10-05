// Compare meaningful cells; ignore blank CSV headers and the calculated day counter.
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).filter(k=>k&&k!=='contador de dias').sort().map(k=>[k,canonical(x[k])])):x;
const signature=s=>{try{return JSON.stringify(canonical(JSON.parse(s)));}catch{return s;}};
const fields=['situacao','apartamento','cliente','contrato','reserva','expiracao','observacoes'];
const shape=v=>Object.fromEntries(fields.map(k=>[k,v?.[k]||'']));
const same=(a,b)=>JSON.stringify(shape(a))===JSON.stringify(shape(b));
const date=s=>s?s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4):'';
const num=s=>String(s||'').trim().replace(/^V0*/i,'');
const unidadeCols={'cliente / proprietario':2,'confirmacao (v/r)':4,status:6,contratos:7,inicio:8,termino:9};
const unidadeIgual=(raw,depois)=>!!raw&&Object.keys(unidadeCols).every(k=>String(raw[k]||'')===String(depois[k]||''));
export function reconcile(V,old,fonte,now,id,spreadsheetId){
  if(!spreadsheetId||fonte.spreadsheetId!==spreadsheetId)throw Error('Planilha não autorizada.');
  old=structuredClone(old);
  for(const v of old.vagas){const a=old.ajustes?.[v.codigo];if(a&&signature(a.assinatura)===signature(v.assinatura))a.assinatura=v.assinatura;}
  const imp=V.importar({...fonte,lidoEm:now});
  const novo={...old,...imp,historico:old.historico||[],ajustes:{...(old.ajustes||{})},ajustesUnidades:{...(old.ajustesUnidades||{})},sync:{...(old.sync||{}),ultimaConsulta:now}};
  const locais=V.efetivas(old),patches=[],codigos=[],conflitos=new Set(),planos=[];
  const conflitosUnidades=new Set(),planosUnidades=[],unidades=[],celulas=new Map();
  // A transfer is one operation, even though it has adjustments for two slots.
  // Connect both the previous and desired apartments before validating either end.
  const grupos=new Map(Object.keys(novo.ajustes).map(cod=>[cod,cod])),apartamentos=new Map();
  const grupo=cod=>{while(grupos.get(cod)!==cod)cod=grupos.get(cod);return cod;};
  for(const cod of grupos.keys())for(const lista of [old.vagas,imp.vagas,locais]){
    const apto=lista.find(v=>v.codigo===cod)?.apartamento;if(!apto)continue;
    if(apartamentos.has(apto))grupos.set(grupo(cod),grupo(apartamentos.get(apto)));
    else apartamentos.set(apto,cod);
  }
  // Successive edits can change the apartment before a slot transfer reaches the
  // sheet. Preserve the explicitly recorded pair when the raw row no longer
  // reveals the apartment shared by the two local adjustments.
  const transferencias=old.sync?.transferenciasPendentes||[];
  for(const {de,para} of transferencias)if(grupos.has(de)&&grupos.has(para))grupos.set(grupo(de),grupo(para));
  const grupoUnidade=apto=>apartamentos.has(apto)?grupo(apartamentos.get(apto)):'apartamento:'+apto;
  function patch(aba,rows,row,col,value){
    const antes=String(rows[row][col]||'');const depois=String(value||'');
    if(antes===depois)return;
    const celula=String.fromCharCode(66+col)+(row+8),chave=aba+celula,anterior=celulas.get(chave);
    if(anterior){if(anterior.antes!==antes||anterior.depois!==depois)throw Error('Mais de uma alteração para a mesma célula. Confira os vínculos.');return;}
    const p={aba,celula,antes,depois};celulas.set(chave,p);patches.push(p);
  }
  for(const raw of imp.vagas){
    const cod=raw.codigo,anterior=old.vagas.find(v=>v.codigo===cod),local=locais.find(v=>v.codigo===cod),ajuste=novo.ajustes[cod];
    if(!ajuste)continue;
    const mudou=signature(raw.assinatura)!==signature(anterior?.assinatura);
    if(mudou){
      if(old.sync?.confirmados?.[cod]&&same(local,old.sync.confirmados[cod])){
        delete novo.ajustes[cod];continue; // só a planilha mudou desde a última confirmação
      }
      if(raw.alertas.length||!same(local,raw)){conflitos.add(cod);continue;}
    }
    if(!raw.alertas.length&&same(local,raw)){
      novo.ajustes[cod]={...ajuste,assinatura:raw.assinatura};
      delete novo.ajustes[cod].somenteVinculo;continue;
    }
    if(local.alertas.length||local.situacao==='conferir'){conflitos.add(cod);continue;}
    novo.ajustes[cod]={...ajuste,assinatura:raw.assinatura};
    if(local.situacao!=='disponivel'&&!local.apartamento){conflitos.add(cod);continue;}
    const gr=fonte.gestao?.findIndex((r,i)=>i>0&&num(r[0])===String(raw.numero));
    const ur=local.apartamento?fonte.vinculos.findIndex((r,i)=>i>0&&r[0]===local.apartamento):-1;
    if(local.apartamento&&ur<1){conflitos.add(cod);continue;}
    // An unlinked apartment is absent from the slot signature. Its original row
    // must also be current before inheriting its sale/owner data for the first link.
    if(ajuste.somenteVinculo&&signature(JSON.stringify(old.unidades.find(u=>u.apartamento===local.apartamento)))!==signature(JSON.stringify(imp.unidades.find(u=>u.apartamento===local.apartamento)))){
      conflitos.add(cod);continue;
    }
    // A previous link may move only when its own adjustment releases this row.
    if(ur>0&&fonte.vinculos[ur][3]&&num(fonte.vinculos[ur][3])!==String(raw.numero)){
      const origem=locais.find(v=>String(v.numero)===num(fonte.vinculos[ur][3]));
      if(!origem||!novo.ajustes[origem.codigo]||origem.apartamento===local.apartamento){conflitos.add(cod);continue;}
    }
    planos.push({raw,local,ajuste,cod,gr,ur});
  }
  for(const [apartamento,ajuste] of Object.entries(novo.ajustesUnidades)){
    const raw=imp.unidades.find(u=>u.apartamento===apartamento);
    if(unidadeIgual(raw,ajuste.depois)){delete novo.ajustesUnidades[apartamento];continue;}
    if(!raw||signature(JSON.stringify(raw))!==signature(JSON.stringify(ajuste.antes))){conflitosUnidades.add(apartamento);continue;}
    const ur=fonte.vinculos.findIndex((r,i)=>i>0&&r[0]===apartamento);
    if(ur<1){conflitosUnidades.add(apartamento);continue;}
    planosUnidades.push({apartamento,ajuste,ur});
  }
  const bloqueados=new Set([...conflitos].map(grupo));
  for(const apto of conflitosUnidades)bloqueados.add(grupoUnidade(apto));
  for(const cod of grupos.keys())if(bloqueados.has(grupo(cod))){
    conflitos.add(cod);novo.ajustes[cod]=old.ajustes[cod];
  }
  for(const apto of Object.keys(old.ajustesUnidades||{}))if(bloqueados.has(grupoUnidade(apto))){
    conflitosUnidades.add(apto);novo.ajustesUnidades[apto]=old.ajustesUnidades[apto];
  }
  novo.sync.transferenciasPendentes=transferencias.filter(({de,para})=>![de,para].every(cod=>{
    const raw=imp.vagas.find(v=>v.codigo===cod),local=locais.find(v=>v.codigo===cod);
    return raw&&local&&!raw.alertas.length&&!bloqueados.has(grupo(cod))&&same(raw,local);
  }));
  const seguros=planos.filter(p=>!bloqueados.has(grupo(p.cod)));
  const destinos=new Set(seguros.filter(p=>p.ur>0).map(p=>p.ur)),alterados=new Set();
  for(const {raw,local,ajuste,cod,gr,ur} of seguros){
    const start=patches.length;
    if(fonte.gestao)for(const [col,val] of [[2,local.apartamento],[3,local.cliente],[4,V.STATUS[local.situacao]],[5,date(local.reserva)],[6,date(local.expiracao)],[7,local.observacoes]])patch('Gestão de Vagas',fonte.gestao,gr,col,val);
    // Free only the parking link on the old apartment. Apartment sale/owner are independent.
    // A transfer writes V01 -> V02 directly, never a separate intermediate unlink.
    fonte.vinculos.forEach((r,i)=>{if(i>0&&num(r[3])===String(raw.numero)&&i!==ur&&!destinos.has(i)){patch('Vagas de Garagem',fonte.vinculos,i,3,'');patch('Vagas de Garagem',fonte.vinculos,i,4,'');}});
    if(ur>0){
      const valores=ajuste.somenteVinculo?[[3,cod]]:[[2,local.cliente],[3,cod],[4,local.situacao==='vendida'?'V':local.situacao==='reservada'?'R':''],[6,V.STATUS[local.situacao]],[7,local.contrato],[8,date(local.reserva)],[9,date(local.expiracao)],...(!fonte.gestao&&fonte.vinculos[0][11]==='Observações'?[[11,local.observacoes]]:[])];
      for(const [col,val] of valores)patch('Vagas de Garagem',fonte.vinculos,ur,col,val);
    }
    if(patches.length>start)alterados.add(grupo(cod));
  }
  // The old slot can have no cell of its own in the single-sheet format, but it
  // still needs its signature confirmed as part of the same transfer.
  for(const cod of grupos.keys())if(alterados.has(grupo(cod)))codigos.push(cod);
  for(const {apartamento,ajuste,ur} of planosUnidades)if(!bloqueados.has(grupoUnidade(apartamento))){
    for(const [campo,col] of Object.entries(unidadeCols))patch('Vagas de Garagem',fonte.vinculos,ur,col,ajuste.depois[campo]);
    unidades.push({apartamento,id:ajuste.id});
  }
  novo.sync.conflitos=[...grupos.keys()].filter(cod=>conflitos.has(cod));
  novo.sync.conflitosUnidades=[...conflitosUnidades];
  if(patches.length)novo.sync.pendente={id,em:now,patches,codigos,unidades};
  else{novo.sync.pendente=null;novo.sync.ultimaConclusao=now;}
  const alteradas=imp.vagas.filter(v=>v.assinatura!==old.vagas.find(x=>x.codigo===v.codigo)?.assinatura).map(v=>v.codigo);
  if(alteradas.length)novo.historico.push({id,em:now,por:'Google Sheets',acao:'sincronizar',motivo:'Atualização automática da planilha',vagasAlteradas:alteradas});
  return novo;
}
export function confirm(V,old,fonte,id,now,spreadsheetId){
  const p=old.sync?.pendente;if(!p||p.id!==id)throw Error('Operação já finalizada ou expirada.');
  if(!spreadsheetId||fonte.spreadsheetId!==spreadsheetId)throw Error('Planilha não autorizada.');
  for(const x of p.patches){const rows=x.aba==='Gestão de Vagas'?fonte.gestao:fonte.vinculos;const m=x.celula.match(/^([B-M])(\d+)$/);if(!m||String(rows[+m[2]-8]?.[m[1].charCodeAt(0)-66]||'')!==x.depois)throw Error('A planilha ainda não confirmou todas as alterações.');}
  const imp=V.importar({...fonte,lidoEm:now});
  const ajustes={...old.ajustes},ajustesUnidades={...old.ajustesUnidades},confirmados={...old.sync.confirmados};
  for(const cod of p.codigos){const raw=imp.vagas.find(v=>v.codigo===cod);if(raw.alertas.length||(ajustes[cod]?.somenteVinculo&&!same(raw,ajustes[cod])))throw Error('A planilha ficou divergente em '+cod+'. Confira antes de concluir.');ajustes[cod]={...ajustes[cod],assinatura:raw.assinatura};delete ajustes[cod].somenteVinculo;confirmados[cod]=shape(ajustes[cod]);}
  for(const {apartamento,id:ajusteId} of p.unidades||[]){
    const ajuste=ajustesUnidades[apartamento],raw=imp.unidades.find(u=>u.apartamento===apartamento);
    if(!ajuste||ajuste.id!==ajusteId||!unidadeIgual(raw,ajuste.depois))throw Error('A planilha ficou divergente em '+apartamento+'. Confira antes de concluir.');
    delete ajustesUnidades[apartamento];
  }
  const transferenciasPendentes=(old.sync.transferenciasPendentes||[]).filter(({de,para})=>!p.codigos.includes(de)||!p.codigos.includes(para));
  return {...old,...imp,ajustes,ajustesUnidades,historico:[...old.historico,{id,em:now,por:'Google Sheets',acao:'sincronizar',motivo:'Alterações do Diamond confirmadas na planilha',vagasAlteradas:p.codigos,unidadesAlteradas:(p.unidades||[]).map(u=>u.apartamento)}],sync:{...old.sync,pendente:null,confirmados,transferenciasPendentes,ultimaConclusao:now}};
}
