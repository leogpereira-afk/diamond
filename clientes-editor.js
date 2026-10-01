/* Editor do cadastro canônico; escolher alguém existente é sempre explícito. */
(function(){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 async function abrir({unidadeId='',clienteId='',onSaved=()=>{}}={}){
  if(!STORE.podeVerPainel()||document.querySelector('#cliente-editor'))return;
  const focusBefore=document.activeElement,dialog=document.createElement('dialog');dialog.id='cliente-editor';dialog.className='cliente-editor';dialog.setAttribute('aria-labelledby','cc-titulo');
  dialog.innerHTML='<div class="cc-head"><h2 id="cc-titulo">Dados do cliente</h2><button type="button" class="cc-close" aria-label="Fechar cadastro">×</button></div><p class="cc-loading" role="status">Consultando cadastros…</p>';
  document.body.append(dialog);dialog.showModal();let dirty=false,saving=false;
  const close=()=>{if(saving)return;if(dirty&&!confirm('Descartar as alterações ainda não salvas neste cadastro?'))return;dialog.close();dialog.remove();focusBefore?.focus();};
  dialog.querySelector('.cc-close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  let result;
  try{result=await STORE.api('clienteCadastro',{operacao:'carregar',unidadeId});if(!result.ok||!Array.isArray(result.leads))throw Error('Não foi possível consultar os cadastros.');}
  catch(e){if(dialog.isConnected)dialog.querySelector('.cc-loading').textContent=e.message;return;}
  if(!dialog.isConnected)return;
  const u=result.unidade,leads=result.leads.slice().sort((a,b)=>String(a.cliente||'').localeCompare(String(b.cliente||''),'pt-BR'));
  let selected=clienteId||u?.clienteId||'',newId='lead-'+crypto.randomUUID();
  if(selected&&!leads.some(l=>l.id===selected)){dialog.querySelector('.cc-loading').textContent='O cliente vinculado não foi localizado. Confira o cadastro antes de substituir o vínculo.';return;}
  const seed=u?.status==='Reservado'?u.reserva?.cliente:(u?.compradorNome||u?.comprador||u?.clienteNome||u?.cliente||'');
  dialog.innerHTML=`<div class="cc-head"><div><span>CADASTRO DE CLIENTE${u?' · UNIDADE '+esc(u.unidade):''}</span><h2 id="cc-titulo">${u?'Cliente da unidade':'Dados do cliente'}</h2></div><button type="button" class="cc-close" aria-label="Fechar cadastro">×</button></div><form id="cc-form"><div class="cc-body">${u?'<p class="cc-info">Inclua um novo cliente ou escolha um cadastro existente. O salvamento mantém a situação, o preço e o prazo da unidade.</p>':'<p class="cc-info">Dados do cadastro compartilhados com a ficha do cliente. Propostas já emitidas mantêm as informações originais.</p>'}
   <section class="cc-picker"><label>Buscar cadastro existente<input id="cc-busca" type="search" placeholder="Nome ou telefone" autocomplete="off"></label><label>Cliente<select id="cc-existente"><option value="">+ Criar novo cadastro</option>${leads.map(l=>`<option value="${esc(l.id)}" ${l.id===selected?'selected':''}>${esc(l.cliente||'Sem nome')}${l.clienteTel?' · '+esc(l.clienteTel):''}</option>`).join('')}</select></label><p id="cc-link-note" class="nota"></p></section>
   <div class="cc-grid"><label class="cc-wide">Nome completo / razão social *<input id="cc-nome" maxlength="80" autocomplete="name" required minlength="2"></label><label>Telefone / WhatsApp<input id="cc-tel" type="tel" maxlength="30" autocomplete="tel"></label><label>E-mail<input id="cc-email" type="email" maxlength="160" autocomplete="email"></label><label>Tipo de pessoa<select id="cc-tipo"><option value="pf">Pessoa física</option><option value="pj">Pessoa jurídica</option></select></label><label>CPF / CNPJ (opcional)<input id="cc-doc" maxlength="24" autocomplete="off"></label></div>
   <details class="cc-address"><summary>Endereço e observações</summary><div class="cc-grid"><label class="cc-wide">Endereço completo<input id="cc-endereco" maxlength="250" autocomplete="street-address" placeholder="Rua, número, complemento e bairro"></label><label>Cidade<input id="cc-cidade" maxlength="80" autocomplete="address-level2"></label><label>UF<input id="cc-uf" maxlength="2" autocomplete="address-level1" placeholder="MG"></label><label>CEP<input id="cc-cep" maxlength="10" autocomplete="postal-code"></label><label class="cc-wide">Observações do cadastro<textarea id="cc-obs" rows="3" maxlength="2000"></textarea></label></div></details>
   <div id="cc-duplicados" class="cc-duplicate" hidden><p>Há cadastro com nome ou contato igual. Confira a lista acima antes de criar outro.</p><label><input id="cc-pessoa-diferente" type="checkbox"> Conferi e são pessoas diferentes</label></div><p id="cc-erro" role="alert" hidden></p></div><footer class="cc-footer"><span id="cc-state" role="status">Nome obrigatório. Os demais dados são opcionais.</span><button type="button" class="btn-mini" id="cc-cancelar">Cancelar</button><button type="submit" class="btn-lime" id="cc-salvar">${u?'Salvar e vincular':'Salvar cadastro'}</button></footer></form>`;
  const $=s=>dialog.querySelector(s),form=$('#cc-form');
  const fields={nome:'cliente',tel:'clienteTel'};
  const populate=()=>{const l=leads.find(l=>l.id===selected),c=l?.cadastro||{};for(const [key,prop] of Object.entries(fields))$('#cc-'+key).value=l?.[prop]||(key==='nome'?seed||'':'');for(const [key,prop] of Object.entries({email:'email',tipo:'tipoPessoa',doc:'documento',endereco:'endereco',cidade:'cidade',uf:'uf',cep:'cep',obs:'observacoes'}))$('#cc-'+key).value=c[prop]||(key==='tipo'?'pf':'');$('#cc-link-note').textContent=l?'Editando o cadastro existente. Responsável e histórico de atendimento serão preservados.':'Novo cadastro. Se a pessoa já existe, selecione-a acima.';$('#cc-pessoa-diferente').checked=false;$('#cc-erro').hidden=true;};
  const duplicates=()=>{const name=norm($('#cc-nome').value),tel=$('#cc-tel').value.replace(/\D/g,''),email=norm($('#cc-email').value);const exists=!selected&&leads.some(l=>(name&&norm(l.cliente)===name)||(tel.length>=8&&String(l.clienteTel||'').replace(/\D/g,'')===tel)||(email&&norm(l.cadastro?.email)===email));$('#cc-duplicados').hidden=!exists;return exists;};
  populate();duplicates();if(clienteId&&!unidadeId)$('.cc-picker').hidden=true;
  $('.cc-close').onclick=close;$('#cc-cancelar').onclick=close;
  $('#cc-busca').oninput=()=>{const q=norm($('#cc-busca').value);for(const o of $('#cc-existente').options)o.hidden=!!o.value&&o.value!==selected&&q&&!norm(o.textContent).includes(q);};
  $('#cc-existente').onchange=()=>{const next=$('#cc-existente').value;if(dirty&&!confirm('Trocar de cliente e descartar os dados ainda não salvos?')){$('#cc-existente').value=selected;return;}selected=next;populate();duplicates();dirty=true;};
  form.addEventListener('input',e=>{if(!['cc-busca','cc-existente'].includes(e.target.id)){dirty=true;duplicates();}});
  form.onsubmit=async e=>{e.preventDefault();if(saving||!form.reportValidity())return;if(duplicates()&&!$('#cc-pessoa-diferente').checked){$('#cc-erro').hidden=false;$('#cc-erro').textContent='Selecione o cadastro existente ou confirme que são pessoas diferentes.';return;}
   saving=true;$('#cc-salvar').disabled=true;$('#cc-cancelar').disabled=true;$('.cc-close').disabled=true;$('#cc-state').textContent='Salvando cadastro…';$('#cc-erro').hidden=true;
   const l=leads.find(l=>l.id===selected),dados={cliente:$('#cc-nome').value,clienteTel:$('#cc-tel').value,cadastro:{tipoPessoa:$('#cc-tipo').value,email:$('#cc-email').value,documento:$('#cc-doc').value,endereco:$('#cc-endereco').value,cidade:$('#cc-cidade').value,uf:$('#cc-uf').value,cep:$('#cc-cep').value,observacoes:$('#cc-obs').value}};
   try{const saved=await STORE.salvarCadastroCliente({id:selected||newId,unidadeId,clienteAtualizadoEm:l?.atualizadoEm||null,unidadeAtualizadaEm:u?.atualizadoEm||null,dados,confirmarPessoaDiferente:$('#cc-pessoa-diferente').checked});dirty=false;saving=false;close();onSaved(saved);}
   catch(err){$('#cc-erro').hidden=false;$('#cc-erro').textContent=err.message;$('#cc-state').textContent='Cadastro não confirmado. Os dados digitados permanecem aqui.';}
   finally{saving=false;if(dialog.isConnected){$('#cc-salvar').disabled=false;$('#cc-cancelar').disabled=false;$('.cc-close').disabled=false;}}
  };
  $('#cc-nome').focus();
 }
 window.DiamondClienteEditor={abrir};
})();
