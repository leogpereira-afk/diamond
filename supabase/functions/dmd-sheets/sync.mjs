// Compare meaningful cells; ignore blank CSV headers and the calculated day counter.
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).filter(k=>k&&k!=='contador de dias').sort().map(k=>[k,canonical(x[k])])):x;
const signature=s=>{try{return JSON.stringify(canonical(JSON.parse(s)));}catch{return s;}};
const fields=['situacao','apartamento','cliente','contrato','reserva','expiracao','observacoes'];
const shape=v=>Object.fromEntries(fields.map(k=>[k,v?.[k]||'']));
const same=(a,b)=>JSON.stringify(shape(a))===JSON.stringify(shape(b));
const date=s=>s?s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4):'';
const num=s=>String(s||'').trim().replace(/^V0*/i,'');
export function reconcile(V,old,fonte,now,id,spreadsheetId){
  if(!spreadsheetId||fonte.spreadsheetId!==spreadsheetId)throw Error('Planilha não autorizada.');
  old=structuredClone(old);
  for(const v of old.vagas){const a=old.ajustes?.[v.codigo];if(a&&signature(a.assinatura)===signature(v.assinatura))a.assinatura=v.assinatura;}
  const imp=V.importar({...fonte,lidoEm:now});
  const novo={...old,...imp,historico:old.historico||[],ajustes:{...(old.ajustes||{})},sync:{...(old.sync||{}),ultimaConsulta:now}};
  const locais=V.efetivas(old),patches=[],codigos=[],conflitos=[];
  function patch(aba,rows,row,col,value){
    const antes=String(rows[row][col]||'');const depois=String(value||'');
    if(antes!==depois)patches.push({aba,celula:String.fromCharCode(66+col)+(row+8),antes,depois});
  }
  for(const raw of imp.vagas){
    const cod=raw.codigo,anterior=old.vagas.find(v=>v.codigo===cod),local=locais.find(v=>v.codigo===cod),ajuste=novo.ajustes[cod];
    if(!ajuste)continue;
    const mudou=signature(raw.assinatura)!==signature(anterior?.assinatura);
    if(mudou){
      if(old.sync?.confirmados?.[cod]&&same(local,old.sync.confirmados[cod])){
        delete novo.ajustes[cod];continue; // só a planilha mudou desde a última confirmação
      }
      if(!raw.alertas.length&&same(local,raw)){
        novo.ajustes[cod]={...ajuste,assinatura:raw.assinatura};continue;
      }
      conflitos.push(cod);continue;
    }
    if(local.alertas.length||local.situacao==='conferir'){conflitos.push(cod);continue;}
    novo.ajustes[cod]={...ajuste,assinatura:raw.assinatura};
    if(local.situacao!=='disponivel'&&!local.apartamento){conflitos.push(cod);continue;}
    const gr=fonte.gestao?.findIndex((r,i)=>i>0&&num(r[0])===String(raw.numero));
    const ur=local.apartamento?fonte.vinculos.findIndex((r,i)=>i>0&&r[0]===local.apartamento):-1;
    // Do not move another occupied slot automatically; require an explicit review.
    if(ur>0&&fonte.vinculos[ur][3]&&num(fonte.vinculos[ur][3])!==String(raw.numero)){
      conflitos.push(cod);continue;
    }
    const start=patches.length;
    if(fonte.gestao)for(const [col,val] of [[2,local.apartamento],[3,local.cliente],[4,V.STATUS[local.situacao]],[5,date(local.reserva)],[6,date(local.expiracao)],[7,local.observacoes]])patch('Gestão de Vagas',fonte.gestao,gr,col,val);
    // Free only the parking link on the old apartment. Apartment sale/owner are independent.
    fonte.vinculos.forEach((r,i)=>{if(i>0&&num(r[3])===String(raw.numero)&&i!==ur){patch('Vagas de Garagem',fonte.vinculos,i,3,'');patch('Vagas de Garagem',fonte.vinculos,i,4,'');}});
    if(ur>0){
      for(const [col,val] of [[2,local.cliente],[3,cod],[4,local.situacao==='vendida'?'V':'R'],[6,V.STATUS[local.situacao]],[7,local.contrato],[8,date(local.reserva)],[9,date(local.expiracao)],...(!fonte.gestao&&fonte.vinculos[0][11]==='Observações'?[[11,local.observacoes]]:[])])patch('Vagas de Garagem',fonte.vinculos,ur,col,val);
    }
    if(patches.length>start)codigos.push(cod);
  }
  const seen=new Set();for(const p of patches){const k=p.aba+p.celula;if(seen.has(k))throw Error('Mais de uma alteração para a mesma célula. Confira os vínculos.');seen.add(k);}
  novo.sync.conflitos=conflitos;
  if(patches.length)novo.sync.pendente={id,em:now,patches,codigos};
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
  const ajustes={...old.ajustes},confirmados={...old.sync.confirmados};
  for(const cod of p.codigos){const raw=imp.vagas.find(v=>v.codigo===cod);if(raw.alertas.length)throw Error('A planilha ficou divergente em '+cod+'. Confira antes de concluir.');ajustes[cod]={...ajustes[cod],assinatura:raw.assinatura};confirmados[cod]=shape(ajustes[cod]);}
  return {...old,...imp,ajustes,historico:[...old.historico,{id,em:now,por:'Google Sheets',acao:'sincronizar',motivo:'Alterações do Diamond confirmadas na planilha',vagasAlteradas:p.codigos}],sync:{...old.sync,pendente:null,confirmados,ultimaConclusao:now}};
}
