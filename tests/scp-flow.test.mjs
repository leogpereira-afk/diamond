import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import {source} from './helpers.mjs';
test('envio SCP aponta para a proposta salva e mostra o mesmo preco negociado',async()=>{
 const nodes=new Map();const element=()=>({style:{},classList:{add(){},remove(){}},textContent:'',innerHTML:'',remove(){}});const get=k=>{if(!nodes.has(k))nodes.set(k,element());return nodes.get(k);};let saved,meta;
 const u={id:'u-1',unidade:'1',area:40,andar:4,status:'Disponível',precoBase:300000};const usr={usuario:'domo',nome:'Domo',papel:'corretor',empresa:'Domo',corretorAtivo:{nome:'Teste',telefone:''}};
 const S={getCfg:()=>({}),getUnidades:()=>[u],unidadePorId:()=>u,getUser:()=>usr,salvarProposta:p=>{saved=p;return p;},enviarPropostaPdf:async(_,m)=>{meta=m;return'https://example.invalid/proposta';}};
 const c=vm.createContext({Date,Math,STORE:S,window:{open:()=>({location:{},close(){}})},document:{querySelector:get,querySelectorAll:()=>[],createElement:element,body:{appendChild(){}}},setTimeout:()=>0});
 const code=process.env.DMD_TEST_APP?fs.readFileSync(process.env.DMD_TEST_APP,'utf8'):source('app.js');
 vm.runInContext(code.slice(0,code.lastIndexOf("  window.addEventListener('hashchange'"))+`\n gerarPdfScp = async () => ({doc:{output:()=> 'data:application/pdf;base64,JVBERi0='}});crmRegistrar=async()=>({id:'lead-1'});_scp={unidadeId:'u-1',cliente:'Cliente Teste',tel:'11999999999',desc10:true,p12:true,p2412:false,corr:0};vScp();globalThis.submit=()=>document.querySelector('#scp-whats').onclick();})();`,c);
 await c.submit();assert.ok(saved);assert.ok(meta);assert.equal(saved.neg,270000);assert.equal(meta.valor,270000);assert.equal(meta.propostaId,saved.id);assert.equal(meta.leadId,'lead-1');
});
