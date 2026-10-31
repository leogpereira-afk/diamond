import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({Intl});
const path=new URL('../vendas-editor.js',import.meta.url);
if(fs.existsSync(path))vm.runInContext(fs.readFileSync(path,'utf8'),context);
test('valor digitado preserva centavos brasileiros sem transformar centavos em milhares',()=>{
  assert.equal(typeof context.DiamondVendaEditor?.centavos,'function');
  const parse=context.DiamondVendaEditor.centavos;
  assert.equal(parse('340.859,37'),34085937);
  assert.equal(parse('340859.37'),34085937);
  assert.equal(parse('0,01'),1);
  assert.equal(parse('1000'),100000);
  for(const text of ['1.234','12.34,56','1,234','-5','Infinity','1e3','abc'])assert.throws(()=>parse(text));
});
test('valor vendido nunca é inferido da tabela e revisão divergente pede conferência',()=>{
  assert.equal(typeof context.DiamondVendaEditor?.resumo,'function');
  const resumo=context.DiamondVendaEditor.resumo;
  const unidade={id:'u',status:'Vendido',clienteId:'c',atualizadoEm:'r1',precoBase:999999};
  assert.equal(resumo(unidade,null).valor,null);
  const contrato={unidadeId:'u',clienteId:'c',unidadeRevisao:'r1',total:30000001,tabelaVenda:{versao:'v2',dataTabela:'05/10/2026'}};
  assert.equal(resumo(unidade,contrato).valor,30000001);
  assert.equal(resumo(unidade,contrato).validada,true);
  assert.equal(resumo({...unidade,atualizadoEm:'r2'},contrato).validada,false);
  assert.equal(resumo({...unidade,clienteId:'outro'},contrato).validada,false);
  assert.equal(resumo({...unidade,status:'Disponível'},contrato).validada,false);
});
