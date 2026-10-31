/* Edição de venda: fonte única, confirmação online e composição preservada. */
(function(root){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dinheiro=v=>v==null?'Não informado':(v/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const decimal=v=>v==null?'':(v/100).toFixed(2).replace('.',',');
  function centavos(value){
    let s=String(value??'').trim();
    if(/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(s))s=s.replaceAll('.','').replace(',','.');
    if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw Error('Informe um valor válido, com até duas casas decimais.');
    const [reais,frac='']=s.split('.'),n=Number(reais)*100+Number(frac.padEnd(2,'0'));
    if(!Number.isSafeInteger(n)||n>1e12)throw Error('O valor informado excede o limite permitido.');
    return n;
  }
  function resumo(u,c){return {valor:c?.total??null,validada:!!c&&u.status==='Vendido'&&c.clienteId===u.clienteId&&c.unidadeRevisao===u.atualizadoEm,tabela:c?.tabelaVenda||null,composicaoPendente:!!c?.composicaoPendente,saldoAInformar:c?.saldoAInformar||0};}
  const tabelaNome=t=>t?[t.versao||'Tabela',t.dataTabela||'Data não informada'].join(' · '):'Tabela não informada';
  const campo=(name,label,value='',extra='')=>`<label>${label}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
  const monetario=(name,label,value,extra='')=>campo(name,label,decimal(value),`type="text" inputmode="decimal" autocomplete="off" ${extra}`);
  const bem=(p={})=>`<div class="dve-bem dve-row">${campo('descricao','Bem em permuta',p.descricao||'','required maxlength="300"')}${monetario('valor','Valor atribuído (R$)',p.valor,'required')}<button type="button" data-remove aria-label="Remover esta permuta">×</button></div>`;
  const parcela=(p={})=>`<div class="dve-parcela dve-row">${campo('descricao','Série',p.descricao||'Mensais','required maxlength="100"')}${campo('quantidade','Quantidade',p.quantidade||'','type="number" min="1" max="600" required')}${monetario('valor','Cada parcela (R$)',p.valor,'required')}${campo('primeiro','1º vencimento',p.primeiro||'','type="date" required')}${campo('intervalo','A cada (meses)',p.intervalo||1,'type="number" min="1" max="120" required')}<button type="button" data-remove aria-label="Remover esta série">×</button></div>`;
  async function abrir(id,{onSaved=()=>{}}={}){
    if(!STORE.podeVerPainel()||document.querySelector('#venda-editor'))return;
    const dlg=document.createElement('dialog'),origin=document.activeElement,route=location.hash;
    dlg.id='venda-editor';dlg.className='dve-dialog';dlg.setAttribute('aria-labelledby','dve-title');
    dlg.innerHTML='<h2 id="dve-title">Valor e tabela da venda</h2><p role="status">Conferindo os dados salvos…</p><button type="button" data-close>Fechar</button>';
    document.body.append(dlg);dlg.showModal();let dirty=false,busy=false,closed=false;
    const unload=ev=>{if(dirty||busy){ev.preventDefault();ev.returnValue='';}};
    const close=(force=false)=>{if(!force&&(busy||dirty&&!confirm('Descartar as alterações ainda não salvas desta venda?')))return false;closed=true;window.removeEventListener('beforeunload',unload);window.removeEventListener('hashchange',onRoute);dlg.close();dlg.remove();origin?.focus();return true;};
    const onRoute=()=>{if(location.hash!==route&&!close()){location.hash=route;}};
    window.addEventListener('beforeunload',unload);window.addEventListener('hashchange',onRoute);
    dlg.querySelector('[data-close]').onclick=()=>close();dlg.addEventListener('cancel',ev=>{ev.preventDefault();close();});
    try{
      const loaded=await STORE.api('vendasCondicoes',{operacao:'carregar',unidadeId:id});
      if(closed)return;
      if(!loaded.ok||!loaded.unidade)throw Error(loaded.erro||'Não foi possível consultar esta venda.');
      const u=loaded.unidade,old=loaded.condicao||{},tabelas=loaded.tabelas||[];
      if(u.status!=='Vendido')throw Error('Registre a venda da unidade antes de informar seu valor e sua tabela.');
      const nome=STORE.getLeads().find(l=>l.id===u.clienteId)?.cliente||u.clienteVinculadoNome||u.compradorNome||'Comprador ainda não vinculado';
      const option=(key,label)=>`<option value="${esc(key)}">${esc(label)}</option>`;
      dlg.innerHTML=`<form><header><div><span class="dve-kicker">UNIDADE ${esc(u.unidade)}</span><h2 id="dve-title">Valor e tabela da venda</h2><p>${esc(nome)}</p></div><button type="button" data-close aria-label="Fechar edição da venda">×</button></header>
      ${!u.clienteId?'<p class="dve-warning">Vincule o comprador na linha da unidade antes de salvar o valor da venda.</p>':''}
      ${old.revisao&&!resumo(u,old).validada?'<p class="dve-warning">A unidade ou o comprador mudou. Confira os dados abaixo para revalidar a venda.</p>':''}
      <div class="dve-main">${monetario('total','Valor vendido (R$)',old.total,'required autofocus')}${campo('data','Data da venda',old.data||'','type="date" required')}<label class="dve-wide">Tabela escolhida para a venda<select name="tabela">${option('manter',old.tabelaVenda?'Manter: '+tabelaNome(old.tabelaVenda):'Não informada')}${tabelas.map(t=>option(t.key,tabelaNome(t)+(t.origem==='atual'?' · atual':t.origem==='reconstruida'?' · reconstruída':''))).join('')}${old.tabelaVenda?option('sem-tabela','Remover vínculo da tabela'):''}</select></label></div>
      <div class="dve-table-note" data-table-note></div>
      <details class="dve-composicao"><summary>Pagamento: entrada, permutas e parcelas <span data-composition-label></span></summary><p>Valores acordados na venda. Este cadastro não registra recebimentos.</p>${monetario('entrada','Entrada em dinheiro (R$)',old.entrada??0,'required')}<section><h3>Permutas</h3><div data-bens>${(old.permutas||[]).map(bem).join('')}</div><button type="button" data-add-bem>+ Adicionar permuta</button></section><section><h3>Parcelas</h3><div data-parcelas>${(old.parcelas||[]).map(parcela).join('')}</div><button type="button" data-add-parcela>+ Adicionar série</button></section></details>
      <label class="dve-check"><input type="checkbox" name="composicaoPendente" ${!old.revisao||old.composicaoPendente?'checked':''}><span>Salvar o valor agora e completar o pagamento depois<small>O saldo não distribuído ficará indicado como pendência.</small></span></label>
      <div class="dve-balance" role="status" data-balance></div>
      <details class="dve-observacoes"><summary>Correção e observações do contrato</summary>${campo('correcao','Correção prevista',old.correcao||'','maxlength="200"')}<label>Observações<textarea name="observacoes" maxlength="2000">${esc(old.observacoes||'')}</textarea></label></details>
      <p class="dve-error" role="alert" data-error></p><footer><button type="button" data-close>Cancelar</button><button type="submit" class="dve-save" ${!u.clienteId?'disabled':''}>Salvar venda</button></footer></form>`;
      const val=(el,n)=>el.querySelector(`[name="${n}"]`).value;
      const read=()=>({total:centavos(val(dlg,'total')),data:val(dlg,'data'),entrada:centavos(val(dlg,'entrada')||'0'),composicaoPendente:dlg.querySelector('[name=composicaoPendente]').checked,permutas:[...dlg.querySelectorAll('.dve-bem')].map(row=>({descricao:val(row,'descricao'),valor:centavos(val(row,'valor'))})),parcelas:[...dlg.querySelectorAll('.dve-parcela')].map(row=>({descricao:val(row,'descricao'),quantidade:Number(val(row,'quantidade')),valor:centavos(val(row,'valor')),primeiro:val(row,'primeiro'),intervalo:Number(val(row,'intervalo'))})),correcao:val(dlg,'correcao'),observacoes:val(dlg,'observacoes')});
      const update=()=>{
        const key=val(dlg,'tabela'),t=key==='manter'?old.tabelaVenda:tabelas.find(x=>x.key===key);
        dlg.querySelector('[data-table-note]').innerHTML=t?`<span>Referência: <b>${esc(tabelaNome(t))}</b></span><span>Preço da tabela: <b>${dinheiro(Math.round(t.valorTabela*100))}</b></span>${t.desconto?`<span>Com desconto cadastrado: ${dinheiro(Math.round(t.neg*100))}</span>`:''}${t.origem==='reconstruida'?'<small>Referência reconstruída do histórico; a data original pode não estar disponível.</small>':''}`:'A tabela é uma referência. Escolhê-la não substitui o valor vendido.';
        try{const d=read(),s=d.entrada+d.permutas.reduce((n,p)=>n+p.valor,0)+d.parcelas.reduce((n,p)=>n+p.quantidade*p.valor,0),saldo=d.total-s;
          dlg.querySelector('[data-balance]').textContent=`Valor vendido: ${dinheiro(d.total)} · Pagamento informado: ${dinheiro(s)} · ${saldo<0?'Excedente':'Falta distribuir'}: ${dinheiro(Math.abs(saldo))}`;
          dlg.querySelector('[data-composition-label]').textContent=saldo===0?'Completo':`${dinheiro(Math.abs(saldo))} ${saldo<0?'a corrigir':'a informar'}`;
        }catch{dlg.querySelector('[data-balance]').textContent='Preencha os valores para conferir a composição do pagamento.';dlg.querySelector('[data-composition-label]').textContent='Conferir valores';}
      };
      dlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>close());
      dlg.addEventListener('input',()=>{dirty=true;update();});dlg.addEventListener('change',()=>{dirty=true;update();});
      dlg.querySelector('[data-add-bem]').onclick=()=>{dlg.querySelector('[data-bens]').insertAdjacentHTML('beforeend',bem());dirty=true;update();};
      dlg.querySelector('[data-add-parcela]').onclick=()=>{dlg.querySelector('[data-parcelas]').insertAdjacentHTML('beforeend',parcela());dirty=true;update();};
      dlg.addEventListener('click',ev=>{const remove=ev.target.closest('[data-remove]');if(remove){remove.closest('.dve-row').remove();dirty=true;update();}});
      dlg.querySelector('form').onsubmit=async ev=>{
        ev.preventDefault();if(busy||!u.clienteId)return;
        const error=dlg.querySelector('[data-error]');error.textContent='';
        try{
          const dados=read(),key=val(dlg,'tabela'),body={operacao:'salvar',unidadeId:id,unidadeRevisao:u.atualizadoEm||null,revisao:old.revisao||0,dados};
          if(key!=='manter')body.tabelaSelecao=key==='sem-tabela'?null:{key,esperada:tabelas.find(t=>t.key===key)};
          busy=true;dlg.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=true);
          const saved=await STORE.api('vendasCondicoes',body);if(!saved.ok)throw Error(saved.erro||'Não foi possível confirmar o salvamento.');
          dirty=false;busy=false;close(true);onSaved(saved);
        }catch(err){busy=false;error.textContent=err.message;dlg.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=false);}
      };
      update();dlg.querySelector('[name=total]').focus();
    }catch(err){if(!closed){dlg.querySelector('[role=status]').textContent=err.message;dlg.querySelector('[role=status]').setAttribute('role','alert');}}
  }
  root.DiamondVendaEditor={centavos,resumo,tabelaNome,abrir};
})(typeof window!=='undefined'?window:globalThis);
