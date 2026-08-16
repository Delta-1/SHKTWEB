/**
 * Panorama do grupo — o que entra e o que sai, por operação.
 *
 * É a tela inicial e a razão de o sistema existir. O que precisa ficar
 * provado aqui:
 *
 *   1. mercadoria só conta quando o movimento acontece de verdade
 *      (recebimento CONFIRMADO, carregamento EXPEDIDO) — rascunho não entra;
 *   2. dinheiro só conta quando passa pelo caixa (baixa de título) —
 *      título em aberto é compromisso, e aparece separado;
 *   3. cada número cai na operação certa, e uma não contamina a outra;
 *   4. o extrato reconstrói linha a linha de onde o total veio.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  prepararBanco,
  limparOperacional,
  usuarioTeste,
  referencias,
  um,
  query,
  encerrar,
  t,
} from './ambiente.js';

const estoque = await import('../src/services/estoque.js');
const compras = await import('../src/services/compras.js');
const recebimento = await import('../src/services/recebimento.js');
const vendas = await import('../src/services/vendas.js');
const carregamentoSvc = await import('../src/services/carregamento.js');
const financeiro = await import('../src/services/financeiro.js');
const panorama = await import('../src/services/panorama.js');

const DE = '2026-08-01';
const ATE = '2026-08-31';

let usuario;
let ref;
let SHKT;
let TRANSP;
let conta;

before(async () => {
  await prepararBanco();
  usuario = await usuarioTeste();
  ref = await referencias();
  SHKT = (await um(`SELECT id FROM operacoes WHERE codigo = 'SHKT'`)).id;
  TRANSP = (await um(`SELECT id FROM operacoes WHERE codigo = 'SHKT-TRANSP'`)).id;
  conta = (await um('SELECT id FROM contas_bancarias ORDER BY id LIMIT 1')).id;
});

beforeEach(async () => {
  await limparOperacional();
});

after(async () => {
  await encerrar();
});

/** Atalho: pedido de compra aprovado, na operação indicada. */
async function compraAprovada(operacaoId, toneladas, precoTonelada) {
  const pedido = await compras.criar(
    {
      data: '2026-08-05',
      operacaoId,
      fornecedorId: ref.fornecedorId,
      tipo: 'MERCADORIA',
      localEntregaId: ref.localId,
      prazoDias: 30,
      itens: [
        {
          produtoId: ref.produtoId,
          descricao: 'Milho',
          quantidade: String(toneladas),
          unidadeId: ref.tonId,
          precoUnitario: String(precoTonelada),
        },
      ],
    },
    usuario
  );
  const { contaPagar } = await compras.aprovar(pedido.id, usuario);
  return { pedido, contaPagar };
}

const buscarOperacao = (res, id) => res.operacoes.find((o) => Number(o.id) === Number(id));

// ---------------------------------------------------------------------------

test('mercadoria só entra no panorama depois de confirmada', async () => {
  const { pedido } = await compraAprovada(SHKT, 500, '1200.00');
  const item = await um('SELECT id FROM pedido_compra_itens WHERE pedido_id = $1', [pedido.id]);

  const rec = await recebimento.criar(
    {
      data: '2026-08-10',
      operacaoId: SHKT,
      pedidoCompraId: pedido.id,
      fornecedorId: ref.fornecedorId,
      localId: ref.localId,
      itens: [
        { pedidoItemId: item.id, produtoId: ref.produtoId, quantidade: '500', unidadeId: ref.tonId },
      ],
    },
    usuario
  );

  // Rascunho: lançado, mas nada aconteceu ainda
  let res = await panorama.porOperacao(DE, ATE);
  assert.equal(buscarOperacao(res, SHKT).mercadoria.entrou_kg, '0.000');

  await recebimento.confirmar(rec.id, usuario);

  res = await panorama.porOperacao(DE, ATE);
  const shkt = buscarOperacao(res, SHKT);
  assert.equal(shkt.mercadoria.entrou_kg, t(500), 'confirmar é o que faz o grão existir');
  assert.equal(shkt.mercadoria.entradas, 1);
  assert.equal(shkt.mercadoria.saiu_kg, '0.000');
});

test('a expedição aparece como saída, e o saldo do período fecha', async () => {
  const { pedido } = await compraAprovada(SHKT, 500, '1200.00');
  const item = await um('SELECT id FROM pedido_compra_itens WHERE pedido_id = $1', [pedido.id]);
  const rec = await recebimento.criar(
    {
      data: '2026-08-10',
      operacaoId: SHKT,
      pedidoCompraId: pedido.id,
      fornecedorId: ref.fornecedorId,
      localId: ref.localId,
      itens: [
        { pedidoItemId: item.id, produtoId: ref.produtoId, quantidade: '500', unidadeId: ref.tonId },
      ],
    },
    usuario
  );
  await recebimento.confirmar(rec.id, usuario);

  const cg = await carregamentoSvc.criar(
    {
      tipoOperacao: 'VENDA_INTERNA',
      data: '2026-08-12',
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: '180',
      unidadeId: ref.tonId,
    },
    usuario
  );
  await carregamentoSvc.programar(cg.id, usuario);
  await carregamentoSvc.expedir(cg.id, { data: '2026-08-12' }, usuario);
  await query('UPDATE carregamentos SET operacao_id = $1 WHERE id = $2', [SHKT, cg.id]);

  const res = await panorama.porOperacao(DE, ATE);
  const shkt = buscarOperacao(res, SHKT);
  assert.equal(shkt.mercadoria.entrou_kg, t(500));
  assert.equal(shkt.mercadoria.saiu_kg, t(180));
  assert.equal(shkt.mercadoria.saldo_kg, t(320), 'entrou menos saiu');
  assert.equal(shkt.estoque.fisico_kg, t(320), 'e bate com o que está no armazém');
});

test('dinheiro só conta quando passa pelo caixa', async () => {
  const { contaPagar } = await compraAprovada(SHKT, 100, '1000.00');

  // Título aprovado, ainda não pago: é compromisso, não saída de caixa
  let res = await panorama.porOperacao(DE, ATE);
  let shkt = buscarOperacao(res, SHKT);
  assert.equal(shkt.dinheiro.saiu, '0.0000', 'título em aberto não é dinheiro que saiu');
  assert.equal(shkt.aberto.pagar, '100000.0000', 'ele aparece como compromisso, com esse nome');

  await financeiro.baixar(
    'CP',
    contaPagar.id,
    { data: '2026-08-20', valor: '40000.00', contaBancariaId: conta },
    usuario
  );

  res = await panorama.porOperacao(DE, ATE);
  shkt = buscarOperacao(res, SHKT);
  assert.equal(shkt.dinheiro.saiu, '40000.0000', 'a baixa é que vira saída');
  assert.equal(shkt.aberto.pagar, '60000.0000', 'e o compromisso diminui na mesma medida');
  assert.equal(shkt.dinheiro.resultado, '-40000.0000');
});

test('uma operação não contamina a outra', async () => {
  // Grão: compra de mercadoria paga
  const grao = await compraAprovada(SHKT, 100, '1000.00');
  await financeiro.baixar(
    'CP', grao.contaPagar.id,
    { data: '2026-08-20', valor: '100000.00', contaBancariaId: conta },
    usuario
  );

  // Transportadora: frete pago
  const frete = await compras.criar(
    {
      data: '2026-08-06',
      operacaoId: TRANSP,
      fornecedorId: ref.fornecedorId,
      tipo: 'FRETE',
      prazoDias: 15,
      itens: [
        { descricao: 'Frete rodoviário', quantidade: '1', unidadeId: ref.kgId, precoUnitario: '25000.00' },
      ],
    },
    usuario
  );
  const aprovado = await compras.aprovar(frete.id, usuario);
  await financeiro.baixar(
    'CP', aprovado.contaPagar.id,
    { data: '2026-08-21', valor: '25000.00', contaBancariaId: conta },
    usuario
  );

  const res = await panorama.porOperacao(DE, ATE);
  const shkt = buscarOperacao(res, SHKT);
  const transp = buscarOperacao(res, TRANSP);

  assert.equal(shkt.dinheiro.saiu, '100000.0000', 'o grão pagou só o que é dele');
  assert.equal(transp.dinheiro.saiu, '25000.0000', 'e a transportadora, só o dela');
  assert.equal(res.total.saiu, '125000.0000', 'o grupo soma as duas');

  // A transportadora não guarda mercadoria
  assert.equal(transp.estoque, null);
  assert.equal(transp.mercadoria.entrou_kg, '0.000');
});

test('o extrato reconstrói de onde cada número veio', async () => {
  const { pedido, contaPagar } = await compraAprovada(SHKT, 300, '1000.00');
  const item = await um('SELECT id FROM pedido_compra_itens WHERE pedido_id = $1', [pedido.id]);
  const rec = await recebimento.criar(
    {
      data: '2026-08-10',
      operacaoId: SHKT,
      pedidoCompraId: pedido.id,
      fornecedorId: ref.fornecedorId,
      localId: ref.localId,
      itens: [
        { pedidoItemId: item.id, produtoId: ref.produtoId, quantidade: '300', unidadeId: ref.tonId },
      ],
    },
    usuario
  );
  await recebimento.confirmar(rec.id, usuario);
  await financeiro.baixar(
    'CP', contaPagar.id,
    { data: '2026-08-22', valor: '300000.00', contaBancariaId: conta },
    usuario
  );

  const linhas = await panorama.movimento(DE, ATE);
  assert.equal(linhas.length, 2, 'uma linha de mercadoria e uma de dinheiro');

  const entrada = linhas.find((l) => l.origem === 'RECEBIMENTO');
  assert.ok(entrada, 'a entrada de mercadoria aparece no extrato');
  assert.equal(entrada.sentido, 'ENTRADA');
  assert.equal(entrada.quantidade_kg, t(300));
  assert.equal(entrada.documento_numero, rec.numero, 'apontando para o documento que a gerou');
  assert.equal(entrada.operacao, 'SHKT');

  const pagamento = linhas.find((l) => l.origem === 'PAGAMENTO_TITULO');
  assert.ok(pagamento);
  assert.equal(pagamento.sentido, 'SAIDA');
  assert.equal(pagamento.valor, '300000.0000');
  assert.equal(pagamento.documento_numero, contaPagar.numero);
});

test('o período recorta: o que está fora não entra na conta', async () => {
  const { contaPagar } = await compraAprovada(SHKT, 100, '1000.00');
  await financeiro.baixar(
    'CP', contaPagar.id,
    { data: '2026-08-20', valor: '50000.00', contaBancariaId: conta },
    usuario
  );

  const dentro = await panorama.porOperacao('2026-08-01', '2026-08-31');
  assert.equal(buscarOperacao(dentro, SHKT).dinheiro.saiu, '50000.0000');

  const fora = await panorama.porOperacao('2026-09-01', '2026-09-30');
  assert.equal(buscarOperacao(fora, SHKT).dinheiro.saiu, '0.0000');

  // O compromisso em aberto NÃO é recortado por período: ele é uma dívida
  // que existe hoje, independentemente do mês que se está olhando.
  assert.equal(buscarOperacao(fora, SHKT).aberto.pagar, '50000.0000');
});
