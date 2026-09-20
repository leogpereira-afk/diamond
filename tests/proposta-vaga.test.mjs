import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {source,appTools} from './helpers.mjs';
test('lista de proposta exclui ocupadas e inconsistências e não expõe dados pessoais',()=>{
 const c=vm.createContext({});vm.runInContext(source('vagas-domain.js'),c);
 const vagas=['disponivel','reservada','vendida','conferir'].map((situacao,i)=>({codigo:'V0'+(i+1),numero:i+1,situacao,alertas:[],cliente:i?'Privado':'',apartamento:i?'Apto 403':'',origem:{segredo:true}}));
 vagas.push({...vagas[0],codigo:'V05',numero:5,cliente:'Outro cliente'});
 assert.deepEqual(JSON.parse(JSON.stringify(c.DomoVagas.paraProposta({vagas}))),[{codigo:'V01',pavimento:'Térreo'}]);
 assert.throws(()=>c.DomoVagas.paraProposta({vagas,sync:{pendente:true}}),/Aguarde/);
});
test('SCP mantém vaga na proposta sem alterar o valor',()=>{
 const v={codigo:'V26',pavimento:'2º pavimento'},u={id:'u-403',unidade:'403',area:45};const a=appTools();
 const p=a.scpProposta(u,300000,{cliente:'Teste',descPct:10,vaga:v},{},{nome:'Teste'});
 assert.equal(p.neg,270000);assert.equal(p.vaga.codigo,'V26');
});
test('revalida disponibilidade antes de emitir e permite escolher depois sem consulta',async()=>{
 let chamadas=0;const c=vm.createContext({window:{},Date,Math,STORE:{api:async()=>{chamadas++;return{vagas:[]};}},document:{querySelector:()=>({classList:{add(){}},remove(){}})},setTimeout(){}});
 const code=source('app.js');vm.runInContext(code.slice(0,code.lastIndexOf("  window.addEventListener('hashchange'"))+`;toast=()=>{};globalThis.check=conferirVaga;})();`,c);
 assert.equal(await c.check({}),true);assert.equal(chamadas,0);
 assert.equal(await c.check({vaga:{codigo:'V01'}}),false);assert.equal(chamadas,1);
});
