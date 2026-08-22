import test from 'node:test';
import assert from 'node:assert/strict';
import writeXlsxFile from 'write-excel-file/node';
import { lerArquivo, modelo } from '../src/services/importacoes.js';
import { TODAS_PERMISSOES, PERFIS_PADRAO } from '../src/lib/permissoes.js';

test('importação lê cabeçalhos em português e mantém os dados para a prévia', async () => {
  const linhas=[
    ['Código','Descrição','Unidade','Controla lote','Exige fumigação'],
    ['SOJA-01','Soja em grãos','KG','Sim','Não'],
  ];
  const planilha=linhas.map(l=>l.map(value=>({value,type:String})));
  const arquivo=await lerArquivo(await writeXlsxFile(planilha,{buffer:true}),'produtos.xlsx');
  assert.equal(arquivo.linhas.length,1);
  assert.equal(arquivo.linhas[0].codigo,'SOJA-01');
  assert.equal(arquivo.linhas[0].controla_lote,'Sim');
  assert.match(arquivo.hash,/^[a-f0-9]{64}$/);
});

test('modelos oficiais existem para produtos, clientes e fornecedores', () => {
  for(const entidade of ['PRODUTOS','CLIENTES','FORNECEDORES']) {
    const linhas=modelo(entidade);
    assert.equal(linhas.length,2);
    assert.ok(linhas[0].includes('codigo'));
  }
});

test('catálogo RBAC inclui módulos finais e perfis operacionais do prompt', () => {
  for(const permissao of ['rh.aprovar','impostos.aprovar','importacoes.aprovar'])
    assert.ok(TODAS_PERMISSOES.includes(permissao));
  for(const perfil of ['COMPRAS','VENDAS','RH'])
    assert.ok(PERFIS_PADRAO.some(x=>x.codigo===perfil));
});
