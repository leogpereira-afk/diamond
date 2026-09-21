const test=require('node:test'),assert=require('node:assert/strict'),V=require('./vagas-domain.js');
function fonte(){const vinculos=[['Apartamento','Tipologia / Área','Cliente / Proprietário','Vaga Vinculada','Confirmação (V/R)','Pavimento da Vaga','Status','Contratos']];const gestao=[['Vaga','Pavimento','Apartamento','Cliente / Proprietário','Status','Data da Reserva','Prazo de Expiração','Observações']];for(let i=1;i<=82;i++){vinculos.push(['Apto '+(400+i),'40 m²','','','','','Disponível','']);gestao.push([V.codigo(i),V.PISOS[V.piso(i)].nome,'','','Disponível','','','']);}return{vinculos,gestao};}
const st=()=>V.importar(fonte());
test('82 vagas, únicas, na ordem e pavimentos da planta',()=>{const s=st();assert.equal(s.vagas.length,82);assert.equal(s.vagas[25].piso,1);assert.equal(s.vagas[51].piso,2);const nums=V.LINHAS.flat(2).filter(Boolean);assert.equal(nums.length,82);assert.equal(new Set(nums).size,82);for(let i=1;i<=82;i++)assert.ok(nums.includes(i));});
test('divergência não vira disponível e ambas as fontes são preservadas',()=>{const f=fonte();f.vinculos[8][2]='Cliente teste';f.vinculos[8][3]='V08';f.vinculos[8][4]='V';f.gestao[8][2]='Apto 408';f.gestao[8][3]='Cliente teste';const v=V.importar(f).vagas[7];assert.equal(v.situacao,'conferir');assert.ok(v.alertas.length);assert.equal(v.origem.gestao.Status,undefined);assert.equal(v.origem.vinculos[0]['confirmacao (v/r)'],'V');});
test('venda sem vínculo exige conferência',()=>{const f=fonte();f.gestao[1][4]='Vendida';assert.equal(V.importar(f).vagas[0].situacao,'conferir');});
test('vínculo duplicado não passa como venda válida',()=>{const f=fonte();for(const n of[1,2]){f.vinculos[n][3]='V01';f.vinculos[n][4]='V';}f.gestao[1][4]='Vendida';assert.equal(V.importar(f).vagas[0].situacao,'conferir');});
test('pavimento segue PDF e alerta diferença sem mudar fonte',()=>{const f=fonte();f.gestao[26][1]='Térreo';const v=V.importar(f).vagas[25];assert.equal(v.piso,1);assert.equal(v.avisos.length,1);assert.equal(v.origem.gestao.pavimento,'Térreo');});
test('importação incompleta ou repetida é recusada',()=>{let f=fonte();f.gestao.pop();assert.throws(()=>V.importar(f),/82/);f=fonte();f.gestao[2][0]='V01';assert.throws(()=>V.importar(f),/uma vez/);});
test('reserva vencida continua reservada',()=>{const s=st();s.ajustes={V01:{assinatura:s.vagas[0].assinatura,situacao:'reservada',reserva:'2026-09-01',expiracao:'2026-09-05',cliente:'Teste'}};const v=V.efetivas(s,'2026-09-19')[0];assert.equal(v.situacao,'reservada');assert.equal(v.vencida,true);assert.equal(v.alertas.length,0);});
test('nova origem reabre alerta de decisão anterior',()=>{const s=st();s.ajustes={V01:{assinatura:'origem anterior',situacao:'vendida',cliente:'Teste'}};const v=V.efetivas(s)[0];assert.equal(v.situacao,'conferir');assert.equal(v.cliente,'Teste');});
test('gravação valida cliente, motivo, vínculo e reserva',()=>{const s=st();assert.throws(()=>V.validarAjuste('V01',{situacao:'vendida',motivo:'Teste'},s),/cliente/);assert.throws(()=>V.validarAjuste('V01',{situacao:'disponivel'},s),/motivo/);assert.throws(()=>V.validarAjuste('V01',{situacao:'disponivel',cliente:'Teste',motivo:'Teste'},s),/manter/);assert.throws(()=>V.validarAjuste('V01',{situacao:'reservada',cliente:'Teste',motivo:'Teste',reserva:'2026-09-20',expiracao:'2026-09-19'},s),/anterior/);});
test('não permite duplicar o apartamento nem trocar o número da vaga',()=>{const s=st();s.ajustes={V02:{assinatura:s.vagas[1].assinatura,situacao:'vendida',cliente:'Teste',apartamento:'Apto 402'}};assert.throws(()=>V.validarAjuste('V01',{situacao:'vendida',cliente:'Teste',apartamento:'Apto 402',motivo:'Teste'},s),/outra vaga/);const a=V.validarAjuste('V01',{situacao:'vendida',cliente:'Teste',apartamento:'Apto 401',motivo:'Teste',piso:2,codigo:'V05'},s);assert.equal(a.piso,undefined);assert.equal(a.codigo,undefined);});
test('CSV preserva vírgulas, aspas, quebras de linha e acentos',()=>{assert.deepEqual(V.parseCSV('a,b\r\n"João, Silva","linha 1\nlinha ""2"""'),[['a','b'],['João, Silva','linha 1\nlinha "2"']]);assert.deepEqual(V.parseCSV('a;b\n1;2'),[['a','b'],['1','2']]);});
test('datas impossíveis são recusadas',()=>{assert.throws(()=>V.data('2026-02-30'),/inválida/);assert.equal(V.data('03/01/2027'),'2027-01-03');});
test('troca move o vínculo inteiro e libera a vaga antiga',()=>{const s=st();s.ajustes={V01:{assinatura:s.vagas[0].assinatura,situacao:'vendida',cliente:'Jean Malta',apartamento:'Apto 401',contrato:'Assinaturas',observacoes:'Pago à vista',reserva:'',expiracao:''}};
 const t=V.validarTroca('V01','V07',{motivo:'Cliente pediu térreo'},s);
 assert.equal(t.destino.apartamento,'Apto 401');assert.equal(t.destino.cliente,'Jean Malta');assert.equal(t.destino.contrato,'Assinaturas');assert.equal(t.destino.observacoes,'Pago à vista');assert.equal(t.destino.situacao,'vendida');
 assert.equal(t.origem.situacao,'disponivel');assert.equal(t.origem.apartamento,'');assert.equal(t.origem.cliente,'');
 assert.equal(t.destino.assinatura,s.vagas[6].assinatura);assert.equal(t.origem.assinatura,s.vagas[0].assinatura);
 const depois=V.efetivas({...s,ajustes:{...s.ajustes,V01:t.origem,V07:t.destino}});
 assert.equal(depois[0].situacao,'disponivel');assert.equal(depois[6].apartamento,'Apto 401');
 assert.equal(depois.filter(v=>v.apartamento==='Apto 401').length,1); // o apartamento não fica em duas vagas
 V.validarAjuste('V07',{...t.destino},{...s,ajustes:{...s.ajustes,V01:t.origem}}); // o resultado passa na régua normal
});
test('troca recusa destino ocupado, mesma vaga, sem motivo e origem sem vínculo',()=>{const s=st();
 s.ajustes={V01:{assinatura:s.vagas[0].assinatura,situacao:'vendida',cliente:'A',apartamento:'Apto 401'},
            V07:{assinatura:s.vagas[6].assinatura,situacao:'reservada',cliente:'B',apartamento:'Apto 407',reserva:'2026-09-01',expiracao:'2026-12-01'}};
 assert.throws(()=>V.validarTroca('V01','V07',{motivo:'x'},s),/não está disponível/);
 assert.throws(()=>V.validarTroca('V01','V01',{motivo:'x'},s),/diferente/);
 assert.throws(()=>V.validarTroca('V01','V08',{},s),/motivo/);
 assert.throws(()=>V.validarTroca('V02','V08',{motivo:'x'},s),/disponível: não há vínculo/);
 assert.throws(()=>V.validarTroca('V01','V99',{motivo:'x'},s),/destino/);
});
test('troca exige conferência antes: vaga com alerta ou situação pendente não troca',()=>{const f=fonte();f.gestao[1][4]='Vendida';const s=V.importar(f); // venda sem vínculo = alerta
 assert.throws(()=>V.validarTroca('V01','V08',{motivo:'x'},s),/pendências|reservada ou vendida/);
 assert.ok(!V.livres(s).some(v=>v.codigo==='V01'));
});
