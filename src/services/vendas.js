/**
 * Pedido de Venda (Fase 2).
 *
 *   RASCUNHO              -> livre para editar
 *   AGUARDANDO_APROVACAO  -> travado para quem nao aprova
 *   APROVADO              -> RESERVA o estoque e gera Contas a Receber
 *   PARCIALMENTE_ATENDIDO -> parte ja embarcou
 *   ATENDIDO              -> embarcou tudo
 *   CANCELADO             -> libera a reserva e cancela o titulo previsto
 *
 * Sobre a reserva, que e o ponto delicado:
 *
 * Quem reserva e o PEDIDO DE VENDA. A ordem de carregamento ligada a um
 * pedido NAO reserva de novo — ela consome um pedaco da reserva do pedido
 * no momento da expedicao. Se as duas reservassem, o mesmo grao apareceria
 * comprometido duas vezes e o "disponivel" ficaria menor do que a
 * realidade do armazem, travando vendas que poderiam ser feitas.
 *
 * Carregamento avulso (sem pedido) continua reservando por conta propria,
 * exatamente como antes.
 */
import { transacao, muitos, um } from '../db/index.js';
import { registrar, ACOES, diferenca } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { Decimal } from '../lib/decimal.js';
import { somarDias } from '../lib/formato.js';
import { paraKg } from './unidades.js';
import * as estoque from './estoque.js';
import { criarContaReceber, cancelarTituloEmTransacao } from './financeiro.js';
import config from '../config.js';

const EDITAVEIS = ['RASCUNHO', 'AGUARDANDO_APROVACAO'];

export function calcularItem(quantidadeOrigem, precoUnitario) {
  return Decimal.de(quantidadeOrigem || '0', 6)
    .vezes(Decimal.de(precoUnitario || '0', 6))
    .paraSql(2);
}

// ---------------------------------------------------------------------------
// Criacao e edicao
// ---------------------------------------------------------------------------

export async function criar(dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    if (!dados.itens?.length) throw new ErroNegocio('Informe ao menos um item no pedido de venda.');

    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.PEDIDO_VENDA);

    const { rows } = await cx.query(
      `INSERT INTO pedidos_venda (
          numero, data, cliente_id, incoterm_id, pais_destino_id, destino, moeda,
          condicao_pagamento, prazo_dias, previsao_embarque, observacoes, status, criado_por,
          operacao_id
       ) VALUES ($1,COALESCE($2,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,$10,$11,'RASCUNHO',$12,$13)
       RETURNING *`,
      [
        numero,
        dados.data ?? null,
        dados.clienteId,
        dados.incotermId ?? null,
        dados.paisDestinoId ?? null,
        dados.destino ?? null,
        dados.moeda || 'BRL',
        dados.condicaoPagamento ?? null,
        dados.prazoDias ?? null,
        dados.previsaoEmbarque ?? null,
        dados.observacoes ?? null,
        usuario.id,
        dados.operacaoId ?? null,
      ]
    );
    const pedido = rows[0];

    await gravarItens(cx, pedido, dados.itens);
    const completo = await recarregar(cx, pedido.id);

    await registrar(cx, {
      usuario,
      acao: ACOES.CRIAR,
      modulo: 'vendas',
      registroTipo: 'PEDIDO_VENDA',
      registroId: pedido.id,
      registroNumero: numero,
      descricao:
        `Pedido de venda ${numero} criado com ${dados.itens.length} item(ns), ` +
        `total ${completo.valor_total}.`,
      depois: completo,
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return completo;
  });
}

export async function atualizar(id, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const atual = await bloquear(cx, id);
    exigirEditavel(atual);
    if (!dados.itens?.length) throw new ErroNegocio('Informe ao menos um item no pedido de venda.');

    const { rows } = await cx.query(
      `UPDATE pedidos_venda SET
          data = COALESCE($1, data), cliente_id = $2, incoterm_id = $3, pais_destino_id = $4,
          destino = $5, moeda = $6, condicao_pagamento = $7, prazo_dias = $8,
          previsao_embarque = $9, observacoes = $10, atualizado_por = $11,
          operacao_id = $13
        WHERE id = $12 RETURNING *`,
      [
        dados.data ?? null,
        dados.clienteId,
        dados.incotermId ?? null,
        dados.paisDestinoId ?? null,
        dados.destino ?? null,
        dados.moeda || atual.moeda,
        dados.condicaoPagamento ?? null,
        dados.prazoDias ?? null,
        dados.previsaoEmbarque ?? null,
        dados.observacoes ?? null,
        usuario.id,
        id,
        dados.operacaoId ?? null,
      ]
    );

    await cx.query('DELETE FROM pedido_venda_itens WHERE pedido_id = $1', [id]);
    await gravarItens(cx, rows[0], dados.itens);
    const completo = await recarregar(cx, id);

    const dif = diferenca(atual, completo);
    if (dif) {
      await registrar(cx, {
        usuario,
        acao: ACOES.ALTERAR,
        modulo: 'vendas',
        registroTipo: 'PEDIDO_VENDA',
        registroId: id,
        registroNumero: atual.numero,
        descricao: `Pedido de venda ${atual.numero} alterado.`,
        antes: dif.antes,
        depois: dif.depois,
        ip: contexto.ip,
        sessao: contexto.sessao,
      });
    }

    return completo;
  });
}

// ---------------------------------------------------------------------------
// Fluxo de aprovacao
// ---------------------------------------------------------------------------

export async function enviarParaAprovacao(id, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const p = await bloquear(cx, id);
    if (p.status !== 'RASCUNHO') throw new ErroNegocio(`O pedido ${p.numero} não está em rascunho.`);
    await exigirItens(cx, p);

    await cx.query(
      `UPDATE pedidos_venda SET status = 'AGUARDANDO_APROVACAO', atualizado_por = $1 WHERE id = $2`,
      [usuario.id, id]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.ALTERAR,
      modulo: 'vendas',
      registroTipo: 'PEDIDO_VENDA',
      registroId: id,
      registroNumero: p.numero,
      descricao: `Pedido de venda ${p.numero} enviado para aprovação.`,
      antes: { status: p.status },
      depois: { status: 'AGUARDANDO_APROVACAO' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { ok: true };
  });
}

/**
 * Aprovacao: reserva o estoque item a item e lanca a previsao em Contas a
 * Receber. Se faltar estoque disponivel para qualquer item, a aprovacao
 * inteira falha — vender o que nao existe no armazem e o erro que este
 * sistema existe para impedir.
 */
export async function aprovar(id, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const p = await bloquear(cx, id);

    if (p.status === 'CANCELADO') throw new ErroNegocio(`O pedido ${p.numero} está cancelado.`);
    if (p.status !== 'RASCUNHO' && p.status !== 'AGUARDANDO_APROVACAO')
      throw new ErroNegocio(`O pedido ${p.numero} já foi aprovado.`);

    await exigirItens(cx, p);

    const itens = (
      await cx.query('SELECT * FROM pedido_venda_itens WHERE pedido_id = $1 ORDER BY id', [id])
    ).rows;

    for (const item of itens) {
      await estoque.conferirDisponivel(cx, {
        produtoId: item.produto_id,
        localId: item.local_id,
        loteId: item.lote_id,
        quantidadeKg: item.quantidade_kg,
      });
      await estoque.reservar(cx, {
        produtoId: item.produto_id,
        localId: item.local_id,
        loteId: item.lote_id,
        quantidadeKg: item.quantidade_kg,
        documentoTipo: 'PEDIDO_VENDA',
        documentoId: id,
        documentoNumero: p.numero,
        usuarioId: usuario.id,
      });
    }

    const { rows } = await cx.query(
      `UPDATE pedidos_venda
          SET status = 'APROVADO', aprovado_em = now(), aprovado_por = $1, atualizado_por = $1
        WHERE id = $2 RETURNING *`,
      [usuario.id, id]
    );
    const pedido = rows[0];

    let contaReceber = null;
    if (Decimal.de(pedido.valor_total, 2).ehPositivo()) {
      const moeda = await cx.query('SELECT id FROM moedas WHERE codigo = $1 LIMIT 1', [pedido.moeda]);
      const categoria = await cx.query(
        `SELECT id FROM categorias_financeiras
          WHERE codigo = 'VENDA_MERCADORIA' AND tipo = 'RECEITA' LIMIT 1`
      );

      contaReceber = await criarContaReceber(
        cx,
        {
          descricao: `Pedido de venda ${pedido.numero}`,
          origem: 'VENDA',
          origemTipo: 'PEDIDO_VENDA',
          origemId: pedido.id,
          origemNumero: pedido.numero,
          parceiroId: pedido.cliente_id,
          operacaoId: pedido.operacao_id,
          categoriaId: categoria.rows[0]?.id ?? null,
          emissao: pedido.data,
          vencimento: vencimentoPrevisto(pedido),
          competencia: pedido.data,
          valor: pedido.valor_total,
          moedaId: moeda.rows[0]?.id ?? null,
          observacoes:
            `Previsão gerada automaticamente pela aprovação do pedido de venda ${pedido.numero}. ` +
            'Ajuste conforme a fatura efetivamente emitida.',
        },
        usuario
      );
    }

    const totalKg = itens.reduce((s, i) => s.mais(Decimal.de(i.quantidade_kg, 3)), Decimal.de('0', 3));

    await registrar(cx, {
      usuario,
      acao: ACOES.APROVAR,
      modulo: 'vendas',
      registroTipo: 'PEDIDO_VENDA',
      registroId: id,
      registroNumero: pedido.numero,
      descricao:
        `Pedido de venda ${pedido.numero} aprovado. ${totalKg.paraSql(3)} kg reservados no estoque.` +
        (contaReceber ? ` Contas a Receber ${contaReceber.numero} gerado.` : ''),
      antes: { status: p.status },
      depois: { status: 'APROVADO' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { pedido, contaReceber };
  });
}

export async function cancelar(id, motivo, usuario, contexto = {}) {
  if (!motivo?.trim()) throw new ErroNegocio('Informe o motivo do cancelamento.');

  return transacao(async (cx) => {
    const p = await bloquear(cx, id);
    if (p.status === 'CANCELADO') throw new ErroNegocio('Este pedido já está cancelado.');

    const carregamentos = await cx.query(
      `SELECT numero FROM carregamentos
        WHERE pedido_venda_id = $1 AND status NOT IN ('CANCELADO','RASCUNHO') ORDER BY numero`,
      [id]
    );
    if (carregamentos.rows.length)
      throw new ErroNegocio(
        `O pedido ${p.numero} tem carregamento(s) em andamento ` +
          `(${carregamentos.rows.map((c) => c.numero).join(', ')}). ` +
          'Cancele o carregamento antes de cancelar o pedido.'
      );

    await estoque.liberarReserva(cx, 'PEDIDO_VENDA', id);

    const titulo = await cancelarTituloEmTransacao(
      cx,
      'CR',
      'PEDIDO_VENDA',
      id,
      `Pedido de venda ${p.numero} cancelado: ${motivo}`,
      usuario
    );

    await cx.query(
      `UPDATE pedidos_venda
          SET status = 'CANCELADO', cancelado_em = now(), cancelado_por = $1,
              motivo_cancelamento = $2, atualizado_por = $1
        WHERE id = $3`,
      [usuario.id, motivo, id]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.CANCELAR,
      modulo: 'vendas',
      registroTipo: 'PEDIDO_VENDA',
      registroId: id,
      registroNumero: p.numero,
      descricao:
        `Pedido de venda ${p.numero} cancelado. Motivo: ${motivo} Reserva de estoque liberada.` +
        (titulo ? ` Título ${titulo.numero} cancelado junto.` : ''),
      antes: { status: p.status },
      depois: { status: 'CANCELADO' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Integracao com o carregamento
// Chamadas de dentro da transacao do modulo de carregamento.
// ---------------------------------------------------------------------------

/**
 * Confere se um item de pedido de venda ainda comporta a carga informada.
 * Chamada ao vincular/alterar a ordem de carregamento — antes de expedir,
 * para o operador descobrir o problema cedo.
 */
export async function conferirSaldoItem(cx, pedidoVendaItemId, quantidadeKg, ignorarCarregamentoId) {
  const { rows } = await cx.query(
    `SELECT i.*, p.numero AS pedido_numero, p.status AS pedido_status,
            COALESCE((SELECT SUM(c.quantidade_kg) FROM carregamentos c
                       WHERE c.pedido_venda_item_id = i.id
                         AND c.status NOT IN ('CANCELADO','EXPEDIDO')
                         AND ($2::BIGINT IS NULL OR c.id <> $2)), 0) AS em_transito_kg
       FROM pedido_venda_itens i
       JOIN pedidos_venda p ON p.id = i.pedido_id
      WHERE i.id = $1`,
    [pedidoVendaItemId, ignorarCarregamentoId ?? null]
  );
  const item = rows[0];
  if (!item) throw new ErroNaoEncontrado('Item do pedido de venda não encontrado.');

  if (item.pedido_status === 'CANCELADO')
    throw new ErroNegocio(`O pedido de venda ${item.pedido_numero} está cancelado.`);
  if (['RASCUNHO', 'AGUARDANDO_APROVACAO'].includes(item.pedido_status))
    throw new ErroNegocio(
      `O pedido de venda ${item.pedido_numero} ainda não foi aprovado. ` +
        'Aprove o pedido antes de programar o carregamento.'
    );

  const saldo = Decimal.de(item.quantidade_kg, 3)
    .menos(Decimal.de(item.atendido_kg, 3))
    .menos(Decimal.de(item.em_transito_kg, 3));

  if (Decimal.de(quantidadeKg, 3).maiorQue(saldo))
    throw new ErroNegocio(
      `A quantidade excede o saldo do pedido de venda ${item.pedido_numero}. ` +
        `Pedido: ${emT(item.quantidade_kg)} t, já embarcado: ${emT(item.atendido_kg)} t, ` +
        `em ordens abertas: ${emT(item.em_transito_kg)} t, disponível: ${emT(saldo.paraSql(3))} t.`
    );

  return item;
}

/**
 * Baixa efetuada na expedicao: consome o pedaco correspondente da reserva do
 * pedido e soma o atendido. Devolve a nova situacao do pedido.
 */
export async function registrarEmbarque(cx, item, quantidadeKg, usuario) {
  const sobra = await cx.query(
    'SELECT fn_reserva_consumir_parcial($1,$2,$3,$4,$5,$6) AS sobra',
    ['PEDIDO_VENDA', item.pedido_id, item.produto_id, item.local_id, item.lote_id, quantidadeKg]
  );

  await cx.query(
    'UPDATE pedido_venda_itens SET atendido_kg = atendido_kg + $1 WHERE id = $2',
    [quantidadeKg, item.id]
  );

  const s = await cx.query('SELECT fn_pedido_venda_recalcular($1) AS status', [item.pedido_id]);

  return {
    situacao: s.rows[0].status,
    // Carga que saiu alem do que o pedido reservava: nao trava a expedicao,
    // mas fica registrado na auditoria do carregamento.
    semReserva: Number(sobra.rows[0].sobra) || 0,
  };
}

/** Devolucao ao cancelar um carregamento ja expedido. */
export async function estornarEmbarque(cx, item, quantidadeKg, usuario, motivo, pedidoNumero) {
  await cx.query(
    'UPDATE pedido_venda_itens SET atendido_kg = GREATEST(atendido_kg - $1, 0) WHERE id = $2',
    [quantidadeKg, item.id]
  );

  // Refaz a reserva: o compromisso com o cliente continua de pe.
  // Somando a reserva que ja existe, e nao criando outra linha — duas
  // reservas ativas da mesma posicao seriam duas versoes do mesmo saldo.
  const p = await cx.query(`SELECT status FROM pedidos_venda WHERE id = $1`, [item.pedido_id]);
  if (p.rows[0] && p.rows[0].status !== 'CANCELADO') {
    await estoque.reporReserva(cx, {
      produtoId: item.produto_id,
      localId: item.local_id,
      loteId: item.lote_id,
      quantidadeKg,
      documentoTipo: 'PEDIDO_VENDA',
      documentoId: item.pedido_id,
      documentoNumero: pedidoNumero ?? null,
      usuarioId: usuario?.id ?? null,
    });
  }

  const s = await cx.query('SELECT fn_pedido_venda_recalcular($1) AS status', [item.pedido_id]);
  return { situacao: s.rows[0].status };
}

/** Carrega o item de pedido de venda vinculado a um carregamento. */
export const itemDoCarregamento = (cx, itemId) =>
  cx
    .query(
      `SELECT i.*, p.numero AS pedido_numero
         FROM pedido_venda_itens i JOIN pedidos_venda p ON p.id = i.pedido_id
        WHERE i.id = $1`,
      [itemId]
    )
    .then((r) => r.rows[0] ?? null);

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

const emT = (kg) => Decimal.de(kg, 3).divididoPor('1000').paraSql(3);

async function gravarItens(cx, pedido, itens) {
  for (const item of itens) {
    const conv = await paraKg(cx, item.quantidade, item.unidadeId);
    const valor = calcularItem(conv.origem, item.precoUnitario);

    await cx.query(
      `INSERT INTO pedido_venda_itens
          (pedido_id, produto_id, local_id, lote_id, quantidade_kg, quantidade_origem,
           unidade_id, preco_unitario, valor_total, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        pedido.id,
        item.produtoId,
        item.localId,
        item.loteId ?? null,
        conv.kg,
        conv.origem,
        item.unidadeId,
        item.precoUnitario || '0',
        valor,
        item.observacoes ?? null,
      ]
    );
  }
}

async function exigirItens(cx, pedido) {
  const { rows } = await cx.query(
    'SELECT COUNT(*)::INT AS n FROM pedido_venda_itens WHERE pedido_id = $1',
    [pedido.id]
  );
  if (!rows[0].n)
    throw new ErroNegocio(`O pedido ${pedido.numero} não tem itens e não pode seguir.`);
}

function exigirEditavel(p) {
  if (!EDITAVEIS.includes(p.status))
    throw new ErroNegocio(
      `O pedido ${p.numero} está "${rotuloStatus(p.status)}" e não pode mais ser editado. ` +
        'Para mudar valores ou quantidades, cancele e emita outro pedido.'
    );
}

function vencimentoPrevisto(pedido) {
  if (pedido.prazo_dias) return somarDias(pedido.data, pedido.prazo_dias);
  if (pedido.previsao_embarque) return pedido.previsao_embarque;
  return somarDias(pedido.data, config.regras.diasVencimentoVenda);
}

async function bloquear(cx, id) {
  const { rows } = await cx.query('SELECT * FROM pedidos_venda WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new ErroNaoEncontrado('Pedido de venda não encontrado.');
  return rows[0];
}

const recarregar = (cx, id) =>
  cx.query('SELECT * FROM pedidos_venda WHERE id = $1', [id]).then((r) => r.rows[0]);

export const ROTULOS = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  APROVADO: 'Aprovado',
  PARCIALMENTE_ATENDIDO: 'Parcialmente atendido',
  ATENDIDO: 'Atendido',
  CANCELADO: 'Cancelado',
};
export const rotuloStatus = (s) => ROTULOS[s] || s;

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const SELECT_BASE = `
  SELECT p.*,
         c.razao_social AS cliente,
         op.nome        AS operacao, op.cor AS operacao_cor,
         ic.codigo      AS incoterm,
         pa.nome        AS pais_destino,
         (SELECT COALESCE(SUM(i.quantidade_kg), 0) FROM pedido_venda_itens i
           WHERE i.pedido_id = p.id)::NUMERIC(18,3) AS pedido_kg,
         (SELECT COALESCE(SUM(i.atendido_kg), 0) FROM pedido_venda_itens i
           WHERE i.pedido_id = p.id)::NUMERIC(18,3) AS atendido_kg,
         (SELECT COUNT(*)::INT FROM pedido_venda_itens i WHERE i.pedido_id = p.id) AS itens
    FROM pedidos_venda p
    JOIN parceiros c        ON c.id = p.cliente_id
    LEFT JOIN operacoes op  ON op.id = p.operacao_id
    LEFT JOIN incoterms ic  ON ic.id = p.incoterm_id
    LEFT JOIN paises pa     ON pa.id = p.pais_destino_id`;

export function listar(filtros = {}) {
  const cond = [];
  const params = [];
  if (filtros.status) {
    params.push(filtros.status);
    cond.push(`p.status = $${params.length}`);
  }
  if (filtros.clienteId) {
    params.push(filtros.clienteId);
    cond.push(`p.cliente_id = $${params.length}`);
  }
  if (filtros.de) {
    params.push(filtros.de);
    cond.push(`p.data >= $${params.length}`);
  }
  if (filtros.ate) {
    params.push(filtros.ate);
    cond.push(`p.data <= $${params.length}`);
  }
  if (filtros.busca) {
    params.push(`%${filtros.busca}%`);
    cond.push(
      `(p.numero ILIKE $${params.length} OR c.razao_social ILIKE $${params.length}
        OR p.destino ILIKE $${params.length})`
    );
  }
  params.push(Number(filtros.limite || 200));

  return muitos(
    `${SELECT_BASE}
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY p.id DESC LIMIT $${params.length}`,
    params
  );
}

export async function buscar(id) {
  const p = await um(`${SELECT_BASE} WHERE p.id = $1`, [id]);
  if (!p) return null;

  p.lista_itens = await muitos(
    `SELECT i.*, pr.codigo AS produto_codigo, pr.descricao AS produto,
            l.nome AS local, lt.codigo AS lote, u.codigo AS unidade, u.fator_kg,
            GREATEST(i.quantidade_kg - i.atendido_kg, 0)::NUMERIC(18,3) AS saldo_kg
       FROM pedido_venda_itens i
       JOIN produtos pr            ON pr.id = i.produto_id
       JOIN locais_estoque l       ON l.id = i.local_id
       LEFT JOIN lotes lt          ON lt.id = i.lote_id
       LEFT JOIN unidades_medida u ON u.id = i.unidade_id
      WHERE i.pedido_id = $1 ORDER BY i.id`,
    [id]
  );

  p.carregamentos = await muitos(
    `SELECT c.id, c.numero, c.data, c.status, c.quantidade_kg, c.destino
       FROM carregamentos c WHERE c.pedido_venda_id = $1 ORDER BY c.id`,
    [id]
  );

  p.titulo = await um(
    `SELECT id, numero, vencimento, valor, status FROM contas_receber
      WHERE origem_tipo = 'PEDIDO_VENDA' AND origem_id = $1 AND status <> 'CANCELADO'`,
    [id]
  );

  return p;
}

/** Itens com saldo a embarcar — alimenta o formulario de carregamento. */
export const itensEmAberto = () =>
  muitos(
    `SELECT i.id AS item_id, i.pedido_id, i.produto_id, i.local_id, i.lote_id,
            i.unidade_id, i.quantidade_kg, i.atendido_kg,
            (i.quantidade_kg - i.atendido_kg)::NUMERIC(18,3) AS saldo_kg,
            p.numero AS pedido_numero, p.cliente_id, p.incoterm_id,
            p.pais_destino_id, p.destino,
            cl.razao_social AS cliente,
            pr.descricao AS produto, l.nome AS local
       FROM pedido_venda_itens i
       JOIN pedidos_venda p    ON p.id = i.pedido_id
       JOIN parceiros cl       ON cl.id = p.cliente_id
       JOIN produtos pr        ON pr.id = i.produto_id
       JOIN locais_estoque l   ON l.id = i.local_id
      WHERE p.status IN ('APROVADO','PARCIALMENTE_ATENDIDO')
        AND i.quantidade_kg > i.atendido_kg
      ORDER BY p.numero, i.id`
  );

export const totaisPeriodo = (de, ate) =>
  um(
    `SELECT COUNT(*) FILTER (WHERE status NOT IN ('CANCELADO','RASCUNHO')) AS pedidos,
            COUNT(*) FILTER (WHERE status = 'AGUARDANDO_APROVACAO')        AS aguardando,
            COUNT(*) FILTER (WHERE status IN ('APROVADO','PARCIALMENTE_ATENDIDO')) AS em_aberto,
            COALESCE(SUM(valor_total) FILTER (WHERE status NOT IN ('CANCELADO','RASCUNHO')), 0) AS valor
       FROM pedidos_venda
      WHERE ($1::DATE IS NULL OR data >= $1) AND ($2::DATE IS NULL OR data <= $2)`,
    [de ?? null, ate ?? null]
  );

export default {
  criar,
  atualizar,
  enviarParaAprovacao,
  aprovar,
  cancelar,
  conferirSaldoItem,
  registrarEmbarque,
  estornarEmbarque,
  itemDoCarregamento,
  listar,
  buscar,
  itensEmAberto,
  totaisPeriodo,
  calcularItem,
  rotuloStatus,
  ROTULOS,
};
