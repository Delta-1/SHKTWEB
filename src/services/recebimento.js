/**
 * Recebimento de mercadoria (Fase 2).
 *
 * Este e o unico evento de ENTRADA de grao no estoque vindo de compra.
 * O pedido nao move estoque; o recebimento move.
 *
 *   RASCUNHO   -> nada aconteceu no estoque; pode corrigir a vontade
 *   CONFIRMADO -> a mercadoria entrou: movimento de estoque gravado e o
 *                 saldo do pedido de compra atualizado
 *   CANCELADO  -> estorna a entrada e devolve o saldo ao pedido
 *
 * Recebimento parcial e a regra, nao a excecao: 500 t pedidas podem chegar
 * em tres caminhoes, em tres dias. Cada viagem e um recebimento.
 *
 * Divergencia entre o previsto e o pesado nao trava a entrada — o que
 * chegou, chegou. Ela e registrada no item para que a diferenca apareca na
 * conferencia com o fornecedor.
 */
import { transacao, muitos, um } from '../db/index.js';
import { registrar, ACOES, diferenca } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { Decimal } from '../lib/decimal.js';
import { paraKg } from './unidades.js';
import * as estoque from './estoque.js';

export async function criar(dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    if (!dados.itens?.length) throw new ErroNegocio('Informe ao menos um item recebido.');

    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.RECEBIMENTO);
    const pesos = calcularPesos(dados);

    const { rows } = await cx.query(
      `INSERT INTO recebimentos (
          numero, data, data_hora_chegada, pedido_compra_id, fornecedor_id, local_id,
          veiculo_id, placa, motorista_id, transportadora_id,
          documento_fiscal, documento_serie, documento_data,
          peso_bruto_kg, peso_tara_kg, peso_liquido_kg,
          observacoes, conferente, status, criado_por, operacao_id
       ) VALUES ($1,COALESCE($2,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                 $14,$15,$16,$17,$18,'RASCUNHO',$19,$20)
       RETURNING *`,
      [
        numero,
        dados.data ?? null,
        dados.dataHoraChegada ?? null,
        dados.pedidoCompraId ?? null,
        dados.fornecedorId,
        dados.localId,
        dados.veiculoId ?? null,
        dados.placa ?? null,
        dados.motoristaId ?? null,
        dados.transportadoraId ?? null,
        dados.documentoFiscal ?? null,
        dados.documentoSerie ?? null,
        dados.documentoData ?? null,
        pesos.bruto,
        pesos.tara,
        pesos.liquido,
        dados.observacoes ?? null,
        dados.conferente ?? usuario.nome,
        usuario.id,
        dados.operacaoId ?? null,
      ]
    );
    const rec = rows[0];

    await gravarItens(cx, rec, dados.itens);

    await registrar(cx, {
      usuario,
      acao: ACOES.CRIAR,
      modulo: 'compras',
      registroTipo: 'RECEBIMENTO',
      registroId: rec.id,
      registroNumero: numero,
      descricao: `Recebimento ${numero} lançado com ${dados.itens.length} item(ns). Ainda não confirmado.`,
      depois: rec,
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return rec;
  });
}

export async function atualizar(id, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const atual = await bloquear(cx, id);
    if (atual.status !== 'RASCUNHO')
      throw new ErroNegocio(
        `O recebimento ${atual.numero} já foi ${atual.status === 'CONFIRMADO' ? 'confirmado' : 'cancelado'} ` +
          'e não pode mais ser editado.'
      );
    if (!dados.itens?.length) throw new ErroNegocio('Informe ao menos um item recebido.');

    const pesos = calcularPesos(dados);

    const { rows } = await cx.query(
      `UPDATE recebimentos SET
          data = COALESCE($1, data), data_hora_chegada = $2, pedido_compra_id = $3,
          fornecedor_id = $4, local_id = $5, veiculo_id = $6, placa = $7,
          motorista_id = $8, transportadora_id = $9,
          documento_fiscal = $10, documento_serie = $11, documento_data = $12,
          peso_bruto_kg = $13, peso_tara_kg = $14, peso_liquido_kg = $15,
          observacoes = $16, conferente = $17, atualizado_por = $18,
          operacao_id = $20
        WHERE id = $19 RETURNING *`,
      [
        dados.data ?? null,
        dados.dataHoraChegada ?? null,
        dados.pedidoCompraId ?? null,
        dados.fornecedorId,
        dados.localId,
        dados.veiculoId ?? null,
        dados.placa ?? null,
        dados.motoristaId ?? null,
        dados.transportadoraId ?? null,
        dados.documentoFiscal ?? null,
        dados.documentoSerie ?? null,
        dados.documentoData ?? null,
        pesos.bruto,
        pesos.tara,
        pesos.liquido,
        dados.observacoes ?? null,
        dados.conferente ?? null,
        usuario.id,
        id,
        dados.operacaoId ?? null,
      ]
    );

    await cx.query('DELETE FROM recebimento_itens WHERE recebimento_id = $1', [id]);
    await gravarItens(cx, rows[0], dados.itens);

    const dif = diferenca(atual, rows[0]);
    if (dif) {
      await registrar(cx, {
        usuario,
        acao: ACOES.ALTERAR,
        modulo: 'compras',
        registroTipo: 'RECEBIMENTO',
        registroId: id,
        registroNumero: atual.numero,
        descricao: `Recebimento ${atual.numero} alterado.`,
        antes: dif.antes,
        depois: dif.depois,
        ip: contexto.ip,
        sessao: contexto.sessao,
      });
    }

    return rows[0];
  });
}

/**
 * CONFIRMACAO — a mercadoria entra no estoque de verdade.
 * Um movimento por item, e o saldo do pedido de compra atualizado na mesma
 * transacao. Ou tudo acontece, ou nada acontece.
 */
export async function confirmar(id, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const r = await bloquear(cx, id);
    if (r.status === 'CONFIRMADO') throw new ErroNegocio('Este recebimento já foi confirmado.');
    if (r.status === 'CANCELADO') throw new ErroNegocio('Este recebimento está cancelado.');

    const itens = (
      await cx.query('SELECT * FROM recebimento_itens WHERE recebimento_id = $1 ORDER BY id', [id])
    ).rows;
    if (!itens.length)
      throw new ErroNegocio(`O recebimento ${r.numero} não tem itens e não pode ser confirmado.`);

    if (r.pedido_compra_id) {
      const p = await cx.query(
        'SELECT numero, status FROM pedidos_compra WHERE id = $1 FOR UPDATE',
        [r.pedido_compra_id]
      );
      const pedido = p.rows[0];
      if (!pedido) throw new ErroNaoEncontrado('Pedido de compra vinculado não encontrado.');
      if (pedido.status === 'CANCELADO')
        throw new ErroNegocio(
          `O pedido de compra ${pedido.numero} está cancelado — não é possível receber contra ele.`
        );
      if (pedido.status === 'RASCUNHO' || pedido.status === 'AGUARDANDO_APROVACAO')
        throw new ErroNegocio(
          `O pedido de compra ${pedido.numero} ainda não foi aprovado. ` +
            'Aprove o pedido antes de confirmar o recebimento.'
        );
    }

    let totalKg = Decimal.de('0', 3);

    for (const item of itens) {
      await estoque.movimentar(cx, {
        tipo: 'RECEBIMENTO',
        produtoId: item.produto_id,
        localId: r.local_id,
        loteId: item.lote_id,
        quantidadeKg: item.quantidade_kg,
        quantidadeOrigem: item.quantidade_origem,
        unidadeId: item.unidade_id,
        dataMovimento: r.data,
        documentoTipo: 'RECEBIMENTO',
        documentoId: id,
        documentoNumero: r.numero,
        observacoes:
          `Entrada por recebimento ${r.numero}` +
          (r.documento_fiscal ? ` — NF ${r.documento_fiscal}` : ''),
        usuarioId: usuario.id,
      });

      if (item.pedido_compra_item_id) {
        await cx.query(
          `UPDATE pedido_compra_itens
              SET recebido_kg = recebido_kg + $1 WHERE id = $2`,
          [item.quantidade_kg, item.pedido_compra_item_id]
        );
      }

      totalKg = totalKg.mais(Decimal.de(item.quantidade_kg, 3));
    }

    let situacaoPedido = null;
    if (r.pedido_compra_id) {
      const s = await cx.query('SELECT fn_pedido_compra_recalcular($1) AS status', [
        r.pedido_compra_id,
      ]);
      situacaoPedido = s.rows[0].status;
    }

    const { rows } = await cx.query(
      `UPDATE recebimentos
          SET status = 'CONFIRMADO', confirmado_em = now(), confirmado_por = $1, atualizado_por = $1
        WHERE id = $2 RETURNING *`,
      [usuario.id, id]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.APROVAR,
      modulo: 'compras',
      registroTipo: 'RECEBIMENTO',
      registroId: id,
      registroNumero: r.numero,
      descricao:
        `Recebimento ${r.numero} confirmado. Entrada de ${totalKg.paraSql(3)} kg no estoque.` +
        (situacaoPedido ? ` Pedido de compra passou a "${situacaoPedido}".` : ''),
      antes: { status: r.status },
      depois: { status: 'CONFIRMADO' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { recebimento: rows[0], totalKg: totalKg.paraSql(3), situacaoPedido };
  });
}

/**
 * Cancelamento: se ja estava confirmado, estorna a entrada de estoque e
 * devolve o saldo ao pedido. O recebimento nao some do sistema — fica
 * marcado como cancelado, com motivo, e os estornos aparecem no extrato.
 */
export async function cancelar(id, motivo, usuario, contexto = {}) {
  if (!motivo?.trim()) throw new ErroNegocio('Informe o motivo do cancelamento.');

  return transacao(async (cx) => {
    const r = await bloquear(cx, id);
    if (r.status === 'CANCELADO') throw new ErroNegocio('Este recebimento já está cancelado.');

    let situacaoPedido = null;

    if (r.status === 'CONFIRMADO') {
      const itens = (
        await cx.query('SELECT * FROM recebimento_itens WHERE recebimento_id = $1 ORDER BY id', [id])
      ).rows;

      // Estorna cada movimento de entrada que ainda nao tenha sido estornado
      const movimentos = await cx.query(
        `SELECT id, produto_id, local_id, lote_id, quantidade_kg
           FROM estoque_movimentos
          WHERE documento_tipo = 'RECEBIMENTO' AND documento_id = $1 AND tipo = 'RECEBIMENTO'
            AND id NOT IN (SELECT estorno_de_id FROM estoque_movimentos WHERE estorno_de_id IS NOT NULL)
          ORDER BY id`,
        [id]
      );

      for (const m of movimentos.rows) {
        await estoque.movimentar(cx, {
          tipo: 'ESTORNO',
          produtoId: m.produto_id,
          localId: m.local_id,
          loteId: m.lote_id,
          quantidadeKg: `-${m.quantidade_kg}`,
          documentoTipo: 'RECEBIMENTO',
          documentoId: id,
          documentoNumero: r.numero,
          motivo,
          observacoes: `Estorno por cancelamento do recebimento ${r.numero}`,
          estornoDeId: m.id,
          usuarioId: usuario.id,
        });
      }

      for (const item of itens) {
        if (!item.pedido_compra_item_id) continue;
        await cx.query(
          `UPDATE pedido_compra_itens
              SET recebido_kg = GREATEST(recebido_kg - $1, 0) WHERE id = $2`,
          [item.quantidade_kg, item.pedido_compra_item_id]
        );
      }

      if (r.pedido_compra_id) {
        const s = await cx.query('SELECT fn_pedido_compra_recalcular($1) AS status', [
          r.pedido_compra_id,
        ]);
        situacaoPedido = s.rows[0].status;
      }
    }

    await cx.query(
      `UPDATE recebimentos
          SET status = 'CANCELADO', cancelado_em = now(), cancelado_por = $1,
              motivo_cancelamento = $2, atualizado_por = $1
        WHERE id = $3`,
      [usuario.id, motivo, id]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.CANCELAR,
      modulo: 'compras',
      registroTipo: 'RECEBIMENTO',
      registroId: id,
      registroNumero: r.numero,
      descricao:
        `Recebimento ${r.numero} cancelado. Motivo: ${motivo}` +
        (r.status === 'CONFIRMADO' ? ' Entrada de estoque estornada.' : '') +
        (situacaoPedido ? ` Pedido de compra voltou para "${situacaoPedido}".` : ''),
      antes: { status: r.status },
      depois: { status: 'CANCELADO' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

async function gravarItens(cx, rec, itens) {
  for (const item of itens) {
    const conv = await paraKg(cx, item.quantidade, item.unidadeId);

    // Quanto o pedido previa para este item, e a diferenca constatada
    let prevista = null;
    let divergencia = item.divergencia ?? null;

    if (item.pedidoItemId) {
      const p = await cx.query(
        `SELECT i.quantidade_kg, i.recebido_kg, i.descricao,
                (i.quantidade_kg - i.recebido_kg) AS saldo_kg
           FROM pedido_compra_itens i WHERE i.id = $1`,
        [item.pedidoItemId]
      );
      if (!p.rows[0])
        throw new ErroNaoEncontrado('Item do pedido de compra não encontrado.');

      prevista = p.rows[0].saldo_kg;
      const dif = Decimal.de(conv.kg, 3).menos(Decimal.de(prevista, 3));

      if (!divergencia && !dif.ehZero()) {
        const sinal = dif.ehPositivo() ? 'a mais' : 'a menos';
        divergencia =
          `Recebido ${sinal} que o saldo do pedido: previsto ` +
          `${Decimal.de(prevista, 3).divididoPor('1000').paraSql(3)} t, ` +
          `recebido ${Decimal.de(conv.kg, 3).divididoPor('1000').paraSql(3)} t.`;
      }
    }

    await cx.query(
      `INSERT INTO recebimento_itens
          (recebimento_id, pedido_compra_item_id, produto_id, lote_id,
           quantidade_kg, quantidade_origem, unidade_id,
           quantidade_prevista_kg, divergencia, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        rec.id,
        item.pedidoItemId ?? null,
        item.produtoId,
        item.loteId ?? null,
        conv.kg,
        conv.origem,
        item.unidadeId,
        prevista,
        divergencia,
        item.observacoes ?? null,
      ]
    );
  }
}

function calcularPesos(dados) {
  const bruto = dados.pesoBruto ? Decimal.de(dados.pesoBruto, 3) : null;
  const tara = dados.pesoTara ? Decimal.de(dados.pesoTara, 3) : null;
  let liquido = dados.pesoLiquido ? Decimal.de(dados.pesoLiquido, 3) : null;
  if (!liquido && bruto && tara) liquido = bruto.menos(tara);
  return {
    bruto: bruto?.paraSql(3) ?? null,
    tara: tara?.paraSql(3) ?? null,
    liquido: liquido?.paraSql(3) ?? null,
  };
}

async function bloquear(cx, id) {
  const { rows } = await cx.query('SELECT * FROM recebimentos WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new ErroNaoEncontrado('Recebimento não encontrado.');
  return rows[0];
}

export const ROTULOS = {
  RASCUNHO: 'Rascunho',
  CONFIRMADO: 'Confirmado',
  CANCELADO: 'Cancelado',
};
export const rotuloStatus = (s) => ROTULOS[s] || s;

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const SELECT_BASE = `
  SELECT r.*,
         f.razao_social AS fornecedor,
         op.nome        AS operacao, op.cor AS operacao_cor,
         l.nome         AS local,
         pc.numero      AS pedido_numero,
         v.placa        AS veiculo_placa,
         mo.nome        AS motorista,
         tr.razao_social AS transportadora,
         (SELECT COALESCE(SUM(i.quantidade_kg), 0) FROM recebimento_itens i
           WHERE i.recebimento_id = r.id)::NUMERIC(18,3) AS quantidade_kg,
         (SELECT COUNT(*)::INT FROM recebimento_itens i WHERE i.recebimento_id = r.id) AS itens,
         (SELECT COUNT(*)::INT FROM recebimento_itens i
           WHERE i.recebimento_id = r.id AND i.divergencia IS NOT NULL) AS divergencias
    FROM recebimentos r
    JOIN parceiros f          ON f.id = r.fornecedor_id
    LEFT JOIN operacoes op    ON op.id = r.operacao_id
    JOIN locais_estoque l     ON l.id = r.local_id
    LEFT JOIN pedidos_compra pc ON pc.id = r.pedido_compra_id
    LEFT JOIN veiculos v      ON v.id = r.veiculo_id
    LEFT JOIN motoristas mo   ON mo.id = r.motorista_id
    LEFT JOIN parceiros tr    ON tr.id = r.transportadora_id`;

export function listar(filtros = {}) {
  const cond = [];
  const params = [];
  if (filtros.status) {
    params.push(filtros.status);
    cond.push(`r.status = $${params.length}`);
  }
  if (filtros.fornecedorId) {
    params.push(filtros.fornecedorId);
    cond.push(`r.fornecedor_id = $${params.length}`);
  }
  if (filtros.pedidoId) {
    params.push(filtros.pedidoId);
    cond.push(`r.pedido_compra_id = $${params.length}`);
  }
  if (filtros.de) {
    params.push(filtros.de);
    cond.push(`r.data >= $${params.length}`);
  }
  if (filtros.ate) {
    params.push(filtros.ate);
    cond.push(`r.data <= $${params.length}`);
  }
  if (filtros.busca) {
    params.push(`%${filtros.busca}%`);
    cond.push(
      `(r.numero ILIKE $${params.length} OR r.documento_fiscal ILIKE $${params.length}
        OR r.placa ILIKE $${params.length} OR f.razao_social ILIKE $${params.length})`
    );
  }
  params.push(Number(filtros.limite || 200));

  return muitos(
    `${SELECT_BASE}
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY r.id DESC LIMIT $${params.length}`,
    params
  );
}

export async function buscar(id) {
  const r = await um(`${SELECT_BASE} WHERE r.id = $1`, [id]);
  if (!r) return null;

  r.lista_itens = await muitos(
    `SELECT i.*, pr.codigo AS produto_codigo, pr.descricao AS produto,
            lt.codigo AS lote, u.codigo AS unidade, u.fator_kg,
            pci.descricao AS item_pedido
       FROM recebimento_itens i
       JOIN produtos pr             ON pr.id = i.produto_id
       LEFT JOIN lotes lt           ON lt.id = i.lote_id
       LEFT JOIN unidades_medida u  ON u.id = i.unidade_id
       LEFT JOIN pedido_compra_itens pci ON pci.id = i.pedido_compra_item_id
      WHERE i.recebimento_id = $1 ORDER BY i.id`,
    [id]
  );

  r.movimentos = await muitos(
    `SELECT * FROM estoque_movimentos
      WHERE documento_tipo = 'RECEBIMENTO' AND documento_id = $1 ORDER BY id`,
    [id]
  );

  return r;
}

export const totaisPeriodo = (de, ate) =>
  um(
    `SELECT COUNT(*) FILTER (WHERE r.status = 'CONFIRMADO') AS confirmados,
            COUNT(*) FILTER (WHERE r.status = 'RASCUNHO')   AS pendentes,
            COALESCE((SELECT SUM(i.quantidade_kg) FROM recebimento_itens i
                       JOIN recebimentos r2 ON r2.id = i.recebimento_id
                      WHERE r2.status = 'CONFIRMADO'
                        AND ($1::DATE IS NULL OR r2.data >= $1)
                        AND ($2::DATE IS NULL OR r2.data <= $2)), 0)::NUMERIC(18,3) AS recebido_kg
       FROM recebimentos r
      WHERE ($1::DATE IS NULL OR r.data >= $1) AND ($2::DATE IS NULL OR r.data <= $2)`,
    [de ?? null, ate ?? null]
  );

export default {
  criar,
  atualizar,
  confirmar,
  cancelar,
  listar,
  buscar,
  totaisPeriodo,
  rotuloStatus,
  ROTULOS,
};
