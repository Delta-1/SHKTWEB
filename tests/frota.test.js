/** Regras integradas da SHKT Transportes. */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  prepararBanco, limparOperacional, usuarioTeste,
  referencias, um, query, encerrar,
} from './ambiente.js';

const frota = await import('../src/services/frota.js');

let usuario;
let ref;
let operacao;
let centro;
let combustivel;

before(async () => {
  await prepararBanco();
  usuario = await usuarioTeste();
  ref = await referencias();
  operacao = await um(`SELECT id FROM operacoes WHERE codigo='SHKT-TRANSP'`);
  centro = await um(`SELECT id FROM centros_custo WHERE codigo='FROTA'`);
  combustivel = await um(`SELECT id FROM tipos_combustivel WHERE codigo='DIESEL_S10'`);
});

beforeEach(async () => {
  await limparOperacional();
  await query(`DELETE FROM motoristas WHERE nome LIKE 'TESTE-MOTORISTA%'`);
  await query(`DELETE FROM veiculos WHERE placa LIKE 'TST%'`);
});

after(async () => encerrar());

test('uma viagem gera uma receita e cada abastecimento gera um único custo', async () => {
  const veiculo = await um(
    `INSERT INTO veiculos (placa, marca_modelo, combustivel_id, centro_custo_id)
     VALUES ('TST0A00','Caminhão de teste',$1,$2) RETURNING id`,
    [combustivel.id, centro.id]
  );
  const motorista = await um(
    `INSERT INTO motoristas (nome, vinculo) VALUES ('TESTE-MOTORISTA','FUNCIONARIO') RETURNING id`
  );

  const viagem = await frota.criarViagem({
    operacaoId: operacao.id,
    clienteId: ref.clienteId,
    veiculoId: veiculo.id,
    motoristaId: motorista.id,
    origem: 'Brasileia - AC',
    destino: 'Puerto Maldonado - PE',
    dataSaidaPrevista: '2026-08-22',
    kmInicial: '1000',
    valorFrete: '1000',
    moedaId: ref.brlId,
    centroCustoId: centro.id,
  }, usuario);

  await frota.programar(viagem.id, usuario);
  assert.equal(
    Number((await um(`SELECT COUNT(*) AS n FROM contas_receber WHERE origem_tipo='VIAGEM' AND origem_id=$1`, [viagem.id])).n),
    1
  );
  await assert.rejects(() => frota.programar(viagem.id, usuario), /já foi programada/);

  await frota.iniciar(viagem.id, { kmInicial: '1000' }, usuario);
  const abastecimento = await frota.criarAbastecimento({
    viagemId: viagem.id,
    operacaoId: operacao.id,
    veiculoId: veiculo.id,
    motoristaId: motorista.id,
    combustivelId: combustivel.id,
    fornecedorId: ref.fornecedorId,
    quantidadeLitros: '40',
    precoLitro: '8',
    quilometragem: '1200',
    centroCustoId: centro.id,
  }, usuario);
  await frota.confirmarAbastecimento(abastecimento.id, usuario);
  await assert.rejects(
    () => frota.confirmarAbastecimento(abastecimento.id, usuario),
    /já foi confirmado/
  );

  await frota.concluir(viagem.id, { kmFinal: '1400' }, usuario);
  const resultado = await um(`SELECT * FROM vw_viagens_resultado WHERE id=$1`, [viagem.id]);
  assert.equal(resultado.receita_prevista, '1000.0000');
  assert.equal(resultado.combustivel, '320.0000');
  assert.equal(resultado.margem_prevista, '680.0000');
  assert.equal(resultado.km_litro, '10.00');

  const custos = await um(
    `SELECT COUNT(*) AS n FROM contas_pagar WHERE origem_tipo='ABASTECIMENTO' AND origem_id=$1`,
    [abastecimento.id]
  );
  assert.equal(Number(custos.n), 1);

  await query('SELECT 1');
});
