import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepararBanco,
  limparOperacional,
  usuarioTeste,
  referencias,
  um,
  muitos,
  encerrar,
} from './ambiente.js';

const financeiro = await import('../src/services/financeiro.js');
const caixa = await import('../src/services/caixa.js');

let usuario;
let ref;

before(async () => {
  await prepararBanco();
  usuario = await usuarioTeste();
  ref = await referencias();
});

beforeEach(async () => {
  await limparOperacional();
});

after(async () => {
  await encerrar();
});

test('baixa na conta física abre e alimenta o caixa automaticamente uma única vez', async () => {
  const conta = await um(`SELECT id FROM contas_bancarias WHERE codigo='CAIXA'`);
  const forma = await um(`SELECT id FROM formas_pagamento WHERE codigo='PIX'`);
  const titulo = await financeiro.criarTituloManual('CR', {
    descricao: 'Recebimento automático no caixa',
    vencimento: '2026-12-31',
    valor: '250.50',
    moedaId: ref.brlId,
  }, usuario);

  await financeiro.baixar('CR', titulo.id, {
    valor: '250.50',
    contaBancariaId: conta.id,
    formaPagamentoId: forma.id,
  }, usuario);

  const aberto = await um(`SELECT * FROM caixas WHERE conta_bancaria_id=$1`, [conta.id]);
  assert.equal(aberto.status, 'ABERTO');
  assert.equal(aberto.abertura_automatica, true);
  assert.equal(aberto.saldo_inicial, '0.0000');

  const movimentos = await muitos(`SELECT * FROM caixa_movimentos WHERE caixa_id=$1`, [aberto.id]);
  assert.equal(movimentos.length, 1, 'a baixa não pode gerar lançamento duplicado');
  assert.equal(movimentos[0].origem_tipo, 'CONTA_RECEBER');
  assert.equal(movimentos[0].forma_pagamento_id, forma.id);
  assert.equal(movimentos[0].valor, '250.5000');
});

test('abertura, suprimento, sangria e fechamento congelam a conferência por meio', async () => {
  const conta = await um(`SELECT id FROM contas_bancarias WHERE codigo='CAIXA'`);
  const aberto = await caixa.abrirCaixa({
    contaBancariaId: conta.id,
    saldoInicial: '100',
    observacoes: 'Troco inicial do teste',
  }, usuario);

  await caixa.registrarMovimentoManual(aberto.id, 'SUPRIMENTO', {
    valor: '50', motivo: 'Reforço para troco',
  }, usuario);
  await caixa.registrarMovimentoManual(aberto.id, 'SANGRIA', {
    valor: '20', motivo: 'Retirada preventiva',
  }, usuario);

  await assert.rejects(
    () => caixa.registrarMovimentoManual(aberto.id, 'SANGRIA', {
      valor: '131', motivo: 'Retirada acima do disponível',
    }, usuario),
    /não pode ser maior/
  );

  const antes = await caixa.buscarCaixa(aberto.id);
  assert.equal(antes.resumo.saldoFinal, '130.0000');
  const dinheiro = antes.formas.find((f) => f.codigo === 'DINHEIRO');
  assert.equal(dinheiro.valor_sistema, '130.0000');

  const fechado = await caixa.fecharCaixa(
    aberto.id,
    { [dinheiro.id]: '128' },
    'Diferença conferida pelo operador',
    usuario
  );
  assert.equal(fechado.status, 'FECHADO');
  assert.equal(fechado.total_sistema, '130.0000');
  assert.equal(fechado.total_informado, '128.0000');
  assert.equal(fechado.diferenca, '-2.0000');

  const conferencia = await um(`SELECT * FROM caixa_conferencias WHERE caixa_id=$1`, [aberto.id]);
  assert.equal(conferencia.diferenca, '-2.0000');
});
