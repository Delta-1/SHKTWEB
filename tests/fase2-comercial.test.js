/**
 * Teste de aceite da FASE 2 — ciclo comercial completo.
 *
 * O que precisa ficar provado aqui, e nao apenas afirmado na documentacao:
 *
 *   1. o pedido de compra NAO move estoque; o recebimento move;
 *   2. recebimento parcial deixa saldo em aberto e a situacao correta;
 *   3. o pedido aprovado nao pode ter preco nem quantidade reescritos;
 *   4. o pedido de venda reserva sem tirar do estoque fisico;
 *   5. venda acima do disponivel e recusada;
 *   6. carregamento ligado ao pedido NAO reserva de novo (reserva dupla);
 *   7. cancelar desfaz tudo — estoque, saldo do pedido e titulo.
 */
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
  t,
} from './ambiente.js';

const estoque = await import('../src/services/estoque.js');
const compras = await import('../src/services/compras.js');
const recebimento = await import('../src/services/recebimento.js');
const vendas = await import('../src/services/vendas.js');
const carregamentoSvc = await import('../src/services/carregamento.js');

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

// ---------------------------------------------------------------------------
// Auxiliares do roteiro
// ---------------------------------------------------------------------------

const pedidoDeCompra = (extra = {}) =>
  compras.criar(
    {
      data: '2026-08-16',
      fornecedorId: ref.fornecedorId,
      tipo: 'MERCADORIA',
      localEntregaId: ref.localId,
      previsaoEntrega: '2026-08-30',
      prazoDias: 30,
      moeda: 'BRL',
      itens: [
        {
          produtoId: ref.produtoId,
          descricao: 'Milho Amarelo Duro safra 2026',
          quantidade: '500',
          unidadeId: ref.tonId,
          precoUnitario: '1200.00',
        },
      ],
      ...extra,
    },
    usuario
  );

const pedidoDeVenda = (quantidade = '300', extra = {}) =>
  vendas.criar(
    {
      data: '2026-08-21',
      clienteId: ref.clienteId,
      destino: 'Lima, Peru',
      prazoDias: 15,
      moeda: 'BRL',
      itens: [
        {
          produtoId: ref.produtoId,
          localId: ref.localId,
          quantidade,
          unidadeId: ref.tonId,
          precoUnitario: '1500.00',
        },
      ],
      ...extra,
    },
    usuario
  );

const itemDoPedido = (tabela, pedidoId) =>
  um(`SELECT * FROM ${tabela} WHERE pedido_id = $1 ORDER BY id LIMIT 1`, [pedidoId]);

const posicao = () =>
  um(
    `SELECT COALESCE(SUM(fisico_kg),0)::NUMERIC(18,3)     AS fisico,
            COALESCE(SUM(reservado_kg),0)::NUMERIC(18,3)  AS reservado,
            COALESCE(SUM(disponivel_kg),0)::NUMERIC(18,3) AS disponivel
       FROM vw_estoque_posicao`
  );

async function estoqueInicial(toneladas) {
  await estoque.ajustar(
    {
      tipo: 'SALDO_INICIAL',
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: String(toneladas),
      unidadeId: ref.tonId,
      motivo: 'Carga inicial para o teste da Fase 2',
    },
    usuario
  );
}

// ---------------------------------------------------------------------------
// COMPRAS E RECEBIMENTO
// ---------------------------------------------------------------------------

test('pedido de compra não move estoque; quem move é o recebimento', async () => {
  const pedido = await pedidoDeCompra();

  assert.equal(pedido.status, 'RASCUNHO');
  // O total do cabecalho vem do banco, somado a partir dos itens
  assert.equal(pedido.valor_total, '600000.00');

  let pos = await posicao();
  assert.equal(pos.fisico, '0.000', 'criar pedido não pode mexer no estoque');

  const { pedido: aprovado, contaPagar } = await compras.aprovar(pedido.id, usuario);
  assert.equal(aprovado.status, 'APROVADO');

  pos = await posicao();
  assert.equal(pos.fisico, '0.000', 'aprovar pedido também não move estoque');

  // A obrigacao de pagar nasce da aprovacao
  assert.ok(contaPagar, 'aprovação deve gerar o título a pagar');
  assert.equal(contaPagar.valor, '600000.0000');
  assert.equal(contaPagar.origem_tipo, 'PEDIDO_COMPRA');
  assert.equal(String(contaPagar.vencimento).slice(0, 15), 'Tue Sep 15 2026');
});

test('recebimento parcial deixa saldo em aberto e registra a divergência', async () => {
  const pedido = await pedidoDeCompra();
  await compras.aprovar(pedido.id, usuario);
  const item = await itemDoPedido('pedido_compra_itens', pedido.id);

  const rec = await recebimento.criar(
    {
      data: '2026-08-17',
      pedidoCompraId: pedido.id,
      fornecedorId: ref.fornecedorId,
      localId: ref.localId,
      documentoFiscal: '12345',
      itens: [
        {
          pedidoItemId: item.id,
          produtoId: ref.produtoId,
          quantidade: '320',
          unidadeId: ref.tonId,
        },
      ],
    },
    usuario
  );

  // Rascunho ainda nao mexeu em nada
  assert.equal(rec.status, 'RASCUNHO');
  assert.equal((await posicao()).fisico, '0.000');

  const r = await recebimento.confirmar(rec.id, usuario);
  assert.equal(r.situacaoPedido, 'PARCIALMENTE_RECEBIDO');

  const pos = await posicao();
  assert.equal(pos.fisico, t(320), 'a confirmação é que dá entrada no estoque');

  const itemDepois = await itemDoPedido('pedido_compra_itens', pedido.id);
  assert.equal(itemDepois.recebido_kg, t(320));
  assert.equal(
    (Number(itemDepois.quantidade_kg) - Number(itemDepois.recebido_kg)).toFixed(3),
    t(180),
    'sobram 180 t em aberto com o fornecedor'
  );

  // Chegou menos do que o pedido previa: a diferenca fica registrada
  const recItem = await um('SELECT * FROM recebimento_itens WHERE recebimento_id = $1', [rec.id]);
  assert.ok(recItem.divergencia, 'a diferença entre previsto e recebido precisa ficar registrada');
  assert.equal(recItem.quantidade_prevista_kg, t(500));

  // Completando a carga, o pedido fecha
  const rec2 = await recebimento.criar(
    {
      data: '2026-08-20',
      pedidoCompraId: pedido.id,
      fornecedorId: ref.fornecedorId,
      localId: ref.localId,
      itens: [
        { pedidoItemId: item.id, produtoId: ref.produtoId, quantidade: '180', unidadeId: ref.tonId },
      ],
    },
    usuario
  );
  const r2 = await recebimento.confirmar(rec2.id, usuario);

  assert.equal(r2.situacaoPedido, 'RECEBIDO');
  assert.equal((await posicao()).fisico, t(500));

  const semDivergencia = await um('SELECT * FROM recebimento_itens WHERE recebimento_id = $1', [rec2.id]);
  assert.equal(semDivergencia.divergencia, null, 'batendo exato, não há divergência a registrar');
});

test('recebimento contra pedido não aprovado é recusado', async () => {
  const pedido = await pedidoDeCompra();
  const item = await itemDoPedido('pedido_compra_itens', pedido.id);

  const rec = await recebimento.criar(
    {
      data: '2026-08-17',
      pedidoCompraId: pedido.id,
      fornecedorId: ref.fornecedorId,
      localId: ref.localId,
      itens: [
        { pedidoItemId: item.id, produtoId: ref.produtoId, quantidade: '100', unidadeId: ref.tonId },
      ],
    },
    usuario
  );

  await assert.rejects(
    () => recebimento.confirmar(rec.id, usuario),
    /ainda não foi aprovado/,
    'não se recebe contra um pedido que ninguém aprovou'
  );
  assert.equal((await posicao()).fisico, '0.000');
});

test('itens de pedido aprovado não podem ser reescritos, nem por UPDATE direto', async () => {
  const pedido = await pedidoDeCompra();
  await compras.aprovar(pedido.id, usuario);
  const item = await itemDoPedido('pedido_compra_itens', pedido.id);

  await assert.rejects(
    () =>
      compras.atualizar(
        pedido.id,
        {
          data: '2026-08-16',
          fornecedorId: ref.fornecedorId,
          tipo: 'MERCADORIA',
          localEntregaId: ref.localId,
          itens: [
            {
              produtoId: ref.produtoId,
              descricao: 'tentando trocar',
              quantidade: '999',
              unidadeId: ref.tonId,
              precoUnitario: '1.00',
            },
          ],
        },
        usuario
      ),
    /não pode mais ser editado/
  );

  // A barreira real é o banco: mesmo por SQL direto o preço não muda
  await assert.rejects(
    () => um('UPDATE pedido_compra_itens SET preco_unitario = 1 WHERE id = $1 RETURNING id', [item.id]),
    /nao podem ser alterados/
  );

  const depois = await um('SELECT valor_total FROM pedidos_compra WHERE id = $1', [pedido.id]);
  assert.equal(depois.valor_total, '600000.00');
});

test('pedido de compra com recebimento confirmado não pode ser cancelado', async () => {
  const pedido = await pedidoDeCompra();
  await compras.aprovar(pedido.id, usuario);
  const item = await itemDoPedido('pedido_compra_itens', pedido.id);

  const rec = await recebimento.criar(
    {
      data: '2026-08-17',
      pedidoCompraId: pedido.id,
      fornecedorId: ref.fornecedorId,
      localId: ref.localId,
      itens: [
        { pedidoItemId: item.id, produtoId: ref.produtoId, quantidade: '100', unidadeId: ref.tonId },
      ],
    },
    usuario
  );
  await recebimento.confirmar(rec.id, usuario);

  await assert.rejects(
    () => compras.cancelar(pedido.id, 'quero desfazer tudo', usuario),
    /Cancele o recebimento primeiro/
  );
});

test('cancelar recebimento confirmado estorna o estoque e devolve o saldo ao pedido', async () => {
  const pedido = await pedidoDeCompra();
  await compras.aprovar(pedido.id, usuario);
  const item = await itemDoPedido('pedido_compra_itens', pedido.id);

  const rec = await recebimento.criar(
    {
      data: '2026-08-17',
      pedidoCompraId: pedido.id,
      fornecedorId: ref.fornecedorId,
      localId: ref.localId,
      itens: [
        { pedidoItemId: item.id, produtoId: ref.produtoId, quantidade: '200', unidadeId: ref.tonId },
      ],
    },
    usuario
  );
  await recebimento.confirmar(rec.id, usuario);
  assert.equal((await posicao()).fisico, t(200));

  await recebimento.cancelar(rec.id, 'nota fiscal errada, refazer', usuario);

  assert.equal((await posicao()).fisico, '0.000', 'a entrada precisa ser estornada');
  const itemDepois = await itemDoPedido('pedido_compra_itens', pedido.id);
  assert.equal(itemDepois.recebido_kg, '0.000');
  const pc = await um('SELECT status FROM pedidos_compra WHERE id = $1', [pedido.id]);
  assert.equal(pc.status, 'APROVADO', 'sem recebimento, o pedido volta a apenas aprovado');

  // O estorno aparece no histórico: nada é apagado
  const movimentos = await muitos(
    `SELECT tipo FROM estoque_movimentos
      WHERE documento_tipo = 'RECEBIMENTO' AND documento_id = $1 ORDER BY id`,
    [rec.id]
  );
  assert.deepEqual(
    movimentos.map((m) => m.tipo),
    ['RECEBIMENTO', 'ESTORNO']
  );
});

test('cancelar pedido de compra aprovado cancela o título previsto', async () => {
  const pedido = await pedidoDeCompra();
  const { contaPagar } = await compras.aprovar(pedido.id, usuario);

  await compras.cancelar(pedido.id, 'fornecedor não conseguiu entregar', usuario);

  const cp = await um('SELECT status FROM contas_pagar WHERE id = $1', [contaPagar.id]);
  assert.equal(cp.status, 'CANCELADO');
  const pc = await um('SELECT status FROM pedidos_compra WHERE id = $1', [pedido.id]);
  assert.equal(pc.status, 'CANCELADO');
});

// ---------------------------------------------------------------------------
// VENDAS
// ---------------------------------------------------------------------------

test('pedido de venda aprovado reserva sem tirar do estoque físico', async () => {
  await estoqueInicial(500);

  const pedido = await pedidoDeVenda('300');
  assert.equal(pedido.valor_total, '450000.00');
  assert.equal((await posicao()).reservado, '0.000', 'rascunho não reserva');

  const { contaReceber } = await vendas.aprovar(pedido.id, usuario);

  const pos = await posicao();
  assert.equal(pos.fisico, t(500), 'reservar não é dar baixa');
  assert.equal(pos.reservado, t(300));
  assert.equal(pos.disponivel, t(200));

  assert.ok(contaReceber);
  assert.equal(contaReceber.valor, '450000.0000');
  assert.equal(contaReceber.origem_tipo, 'PEDIDO_VENDA');
});

test('vender mais do que existe disponível é recusado', async () => {
  await estoqueInicial(500);

  const primeiro = await pedidoDeVenda('300');
  await vendas.aprovar(primeiro.id, usuario);

  const segundo = await pedidoDeVenda('400');
  await assert.rejects(
    () => vendas.aprovar(segundo.id, usuario),
    /Estoque disponível insuficiente/,
    'as 300 t já reservadas não podem ser vendidas de novo'
  );

  const pos = await posicao();
  assert.equal(pos.reservado, t(300), 'a recusa não pode deixar reserva pela metade');
  const pv = await um('SELECT status FROM pedidos_venda WHERE id = $1', [segundo.id]);
  assert.equal(pv.status, 'RASCUNHO');
});

test('carregamento ligado ao pedido não reserva de novo, e consome a reserva ao expedir', async () => {
  await estoqueInicial(500);
  const pedido = await pedidoDeVenda('300');
  await vendas.aprovar(pedido.id, usuario);
  const item = await itemDoPedido('pedido_venda_itens', pedido.id);

  const cg = await carregamentoSvc.criar(
    {
      tipoOperacao: 'VENDA_INTERNA',
      data: '2026-08-22',
      clienteId: ref.clienteId,
      pedidoVendaItemId: item.id,
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: '120',
      unidadeId: ref.tonId,
      destino: 'Lima, Peru',
    },
    usuario
  );

  await carregamentoSvc.programar(cg.id, usuario);

  let pos = await posicao();
  assert.equal(pos.reservado, t(300), 'programar não pode reservar em cima da reserva do pedido');
  assert.equal(pos.disponivel, t(200));

  await carregamentoSvc.expedir(cg.id, { data: '2026-08-22' }, usuario);

  pos = await posicao();
  assert.equal(pos.fisico, t(380), 'a expedição é que dá a baixa física');
  assert.equal(pos.reservado, t(180), 'a reserva do pedido diminui na medida do embarcado');
  assert.equal(pos.disponivel, t(200), 'o disponível não muda: saiu o que já estava comprometido');

  const pv = await um('SELECT status FROM pedidos_venda WHERE id = $1', [pedido.id]);
  assert.equal(pv.status, 'PARCIALMENTE_ATENDIDO');
  const itemDepois = await um('SELECT atendido_kg FROM pedido_venda_itens WHERE id = $1', [item.id]);
  assert.equal(itemDepois.atendido_kg, t(120));
});

test('carregamento acima do saldo do pedido de venda é recusado', async () => {
  await estoqueInicial(500);
  const pedido = await pedidoDeVenda('300');
  await vendas.aprovar(pedido.id, usuario);
  const item = await itemDoPedido('pedido_venda_itens', pedido.id);

  await assert.rejects(
    () =>
      carregamentoSvc.criar(
        {
          tipoOperacao: 'VENDA_INTERNA',
          data: '2026-08-22',
          pedidoVendaItemId: item.id,
          produtoId: ref.produtoId,
          localId: ref.localId,
          quantidade: '400',
          unidadeId: ref.tonId,
        },
        usuario
      ),
    /excede o saldo do pedido de venda/
  );
});

test('cancelar carregamento expedido devolve estoque, saldo e reserva do pedido', async () => {
  await estoqueInicial(500);
  const pedido = await pedidoDeVenda('300');
  await vendas.aprovar(pedido.id, usuario);
  const item = await itemDoPedido('pedido_venda_itens', pedido.id);

  const cg = await carregamentoSvc.criar(
    {
      tipoOperacao: 'VENDA_INTERNA',
      data: '2026-08-22',
      pedidoVendaItemId: item.id,
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: '120',
      unidadeId: ref.tonId,
    },
    usuario
  );
  await carregamentoSvc.programar(cg.id, usuario);
  await carregamentoSvc.expedir(cg.id, { data: '2026-08-22' }, usuario);

  await carregamentoSvc.cancelar(cg.id, 'caminhão quebrou no caminho', usuario);

  const pos = await posicao();
  assert.equal(pos.fisico, t(500), 'a mercadoria volta ao armazém');
  assert.equal(pos.reservado, t(300), 'o compromisso com o cliente continua de pé');
  assert.equal(pos.disponivel, t(200));

  const pv = await um('SELECT status FROM pedidos_venda WHERE id = $1', [pedido.id]);
  assert.equal(pv.status, 'APROVADO');
  const itemDepois = await um('SELECT atendido_kg FROM pedido_venda_itens WHERE id = $1', [item.id]);
  assert.equal(itemDepois.atendido_kg, '0.000');

  // Uma reserva ativa por posição, nunca duas versões do mesmo saldo
  const reservas = await muitos(
    `SELECT quantidade_kg FROM estoque_reservas
      WHERE documento_tipo = 'PEDIDO_VENDA' AND documento_id = $1 AND status = 'ATIVA'`,
    [pedido.id]
  );
  assert.equal(reservas.length, 1);
  assert.equal(reservas[0].quantidade_kg, t(300));
});

test('cancelar pedido de venda libera a reserva e o título a receber', async () => {
  await estoqueInicial(500);
  const pedido = await pedidoDeVenda('300');
  const { contaReceber } = await vendas.aprovar(pedido.id, usuario);

  await vendas.cancelar(pedido.id, 'cliente desistiu da compra', usuario);

  const pos = await posicao();
  assert.equal(pos.reservado, '0.000');
  assert.equal(pos.disponivel, t(500), 'a mercadoria volta a ficar vendável');

  const cr = await um('SELECT status FROM contas_receber WHERE id = $1', [contaReceber.id]);
  assert.equal(cr.status, 'CANCELADO');
});

test('pedido de venda com carregamento em andamento não pode ser cancelado', async () => {
  await estoqueInicial(500);
  const pedido = await pedidoDeVenda('300');
  await vendas.aprovar(pedido.id, usuario);
  const item = await itemDoPedido('pedido_venda_itens', pedido.id);

  const cg = await carregamentoSvc.criar(
    {
      tipoOperacao: 'VENDA_INTERNA',
      data: '2026-08-22',
      pedidoVendaItemId: item.id,
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: '120',
      unidadeId: ref.tonId,
    },
    usuario
  );
  await carregamentoSvc.programar(cg.id, usuario);

  await assert.rejects(
    () => vendas.cancelar(pedido.id, 'cliente desistiu', usuario),
    /Cancele o carregamento antes/
  );
});

test('carregamento avulso continua reservando por conta própria', async () => {
  await estoqueInicial(500);

  const cg = await carregamentoSvc.criar(
    {
      tipoOperacao: 'VENDA_INTERNA',
      data: '2026-08-22',
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: '100',
      unidadeId: ref.tonId,
    },
    usuario
  );
  await carregamentoSvc.programar(cg.id, usuario);

  const pos = await posicao();
  assert.equal(pos.reservado, t(100), 'sem pedido de venda, quem reserva é a própria ordem');
  assert.equal(pos.disponivel, t(400));
});

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

test('todo o ciclo comercial deixa rastro na auditoria', async () => {
  await estoqueInicial(500);

  const compra = await pedidoDeCompra();
  await compras.aprovar(compra.id, usuario);

  const venda = await pedidoDeVenda('100');
  await vendas.aprovar(venda.id, usuario);

  const registros = await muitos(
    `SELECT modulo, acao, registro_tipo FROM auditoria
      WHERE modulo IN ('compras','vendas','financeiro') ORDER BY id`
  );

  const tem = (modulo, acao, tipo) =>
    registros.some((r) => r.modulo === modulo && r.acao === acao && r.registro_tipo === tipo);

  assert.ok(tem('compras', 'CRIAR', 'PEDIDO_COMPRA'), 'criação do pedido de compra');
  assert.ok(tem('compras', 'APROVAR', 'PEDIDO_COMPRA'), 'aprovação do pedido de compra');
  assert.ok(tem('vendas', 'CRIAR', 'PEDIDO_VENDA'), 'criação do pedido de venda');
  assert.ok(tem('vendas', 'APROVAR', 'PEDIDO_VENDA'), 'aprovação do pedido de venda');
  assert.ok(tem('financeiro', 'CRIAR', 'CONTA_PAGAR'), 'título a pagar gerado');
  assert.ok(tem('financeiro', 'CRIAR', 'CONTA_RECEBER'), 'título a receber gerado');
});
