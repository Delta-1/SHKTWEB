/**
 * Servico de Estoque.
 *
 * Regras (secao 8):
 *  - saldo nunca e digitado, sempre resulta de movimentacoes;
 *  - toda movimentacao guarda origem, documento, data/hora, usuario e local;
 *  - saldo negativo e bloqueado no banco (fn_estoque_movimentar);
 *  - correcao se faz por estorno, nunca apagando o historico.
 */
import { transacao, muitos, um } from '../db/index.js';
import { registrar, ACOES } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { paraKg } from './unidades.js';

/**
 * Movimenta estoque dentro de uma transacao ja aberta.
 * Use esta funcao a partir de outros servicos (carregamento, recebimento).
 *
 * @param {import('pg').PoolClient} cx
 * @param {object} m
 * @param {string} m.tipo RECEBIMENTO | AJUSTE_ENTRADA | AJUSTE_SAIDA | CARREGAMENTO | ...
 * @param {number} m.produtoId
 * @param {number} m.localId
 * @param {number|null} m.loteId
 * @param {string} m.quantidadeKg positivo = entrada, negativo = saida
 */
export async function movimentar(cx, m) {
  const { rows } = await cx.query(
    `SELECT fn_estoque_movimentar(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
     ) AS id`,
    [
      m.tipo,
      m.produtoId,
      m.localId,
      m.loteId ?? null,
      m.quantidadeKg,
      m.documentoTipo ?? null,
      m.documentoId ?? null,
      m.documentoNumero ?? null,
      m.usuarioId ?? null,
      m.quantidadeOrigem ?? null,
      m.unidadeId ?? null,
      m.dataMovimento ?? null,
      m.motivo ?? null,
      m.observacoes ?? null,
      m.permiteNegativo ?? false,
      m.estornoDeId ?? null,
    ]
  );
  return rows[0].id;
}

/**
 * Ajuste manual autorizado de estoque (entrada ou saida).
 * Exige motivo - ajuste sem justificativa e o caminho mais rapido para
 * o estoque perder credibilidade.
 */
export async function ajustar(dados, usuario, contexto = {}) {
  const {
    tipo, // 'AJUSTE_ENTRADA' | 'AJUSTE_SAIDA' | 'SALDO_INICIAL'
    produtoId,
    localId,
    loteId,
    quantidade,
    unidadeId,
    dataMovimento,
    motivo,
    observacoes,
  } = dados;

  if (!motivo || !String(motivo).trim())
    throw new ErroNegocio('Informe o motivo do ajuste de estoque.');

  return transacao(async (cx) => {
    const conv = await paraKg(cx, quantidade, unidadeId);
    const entrada = tipo === 'AJUSTE_ENTRADA' || tipo === 'SALDO_INICIAL';
    const quantidadeKg = entrada ? conv.kg : `-${conv.kg}`;

    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.AJUSTE_ESTOQUE);

    const movId = await movimentar(cx, {
      tipo,
      produtoId,
      localId,
      loteId,
      quantidadeKg,
      quantidadeOrigem: conv.origem,
      unidadeId,
      dataMovimento,
      documentoTipo: 'AJUSTE',
      documentoNumero: numero,
      motivo,
      observacoes,
      usuarioId: usuario.id,
    });

    await registrar(cx, {
      usuario,
      acao: ACOES.CRIAR,
      modulo: 'estoque',
      registroTipo: 'ESTOQUE_MOVIMENTO',
      registroId: movId,
      registroNumero: numero,
      descricao: `${tipo === 'AJUSTE_SAIDA' ? 'Saída' : 'Entrada'} manual de ${conv.kg} kg. Motivo: ${motivo}`,
      depois: { tipo, produtoId, localId, loteId, quantidadeKg, motivo },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { id: movId, numero, quantidadeKg };
  });
}

/**
 * Transferencia entre locais: uma saida e uma entrada, na mesma transacao.
 * Nunca deixa quantidade "no ar" entre os dois armazens.
 */
export async function transferir(dados, usuario, contexto = {}) {
  const { produtoId, localOrigemId, localDestinoId, loteId, quantidade, unidadeId, dataMovimento, observacoes } =
    dados;

  if (Number(localOrigemId) === Number(localDestinoId))
    throw new ErroNegocio('O local de origem e o de destino devem ser diferentes.');

  return transacao(async (cx) => {
    const conv = await paraKg(cx, quantidade, unidadeId);
    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.AJUSTE_ESTOQUE);

    const saidaId = await movimentar(cx, {
      tipo: 'TRANSFERENCIA_SAIDA',
      produtoId,
      localId: localOrigemId,
      loteId,
      quantidadeKg: `-${conv.kg}`,
      quantidadeOrigem: conv.origem,
      unidadeId,
      dataMovimento,
      documentoTipo: 'TRANSFERENCIA',
      documentoNumero: numero,
      observacoes,
      usuarioId: usuario.id,
    });

    const entradaId = await movimentar(cx, {
      tipo: 'TRANSFERENCIA_ENTRADA',
      produtoId,
      localId: localDestinoId,
      loteId,
      quantidadeKg: conv.kg,
      quantidadeOrigem: conv.origem,
      unidadeId,
      dataMovimento,
      documentoTipo: 'TRANSFERENCIA',
      documentoNumero: numero,
      observacoes,
      usuarioId: usuario.id,
    });

    await registrar(cx, {
      usuario,
      acao: ACOES.CRIAR,
      modulo: 'estoque',
      registroTipo: 'TRANSFERENCIA',
      registroId: saidaId,
      registroNumero: numero,
      descricao: `Transferência de ${conv.kg} kg entre locais.`,
      depois: { produtoId, localOrigemId, localDestinoId, quantidadeKg: conv.kg },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { numero, saidaId, entradaId };
  });
}

/**
 * Estorna um movimento existente, gerando o movimento inverso.
 * O movimento original permanece no historico (secao 24).
 */
export async function estornar(movimentoId, motivo, usuario, contexto = {}) {
  if (!motivo || !String(motivo).trim())
    throw new ErroNegocio('Informe o motivo do estorno.');

  return transacao(async (cx) => {
    const { rows } = await cx.query('SELECT * FROM estoque_movimentos WHERE id = $1', [movimentoId]);
    const orig = rows[0];
    if (!orig) throw new ErroNaoEncontrado('Movimento de estoque não encontrado.');

    const jaEstornado = await cx.query(
      'SELECT 1 FROM estoque_movimentos WHERE estorno_de_id = $1',
      [movimentoId]
    );
    if (jaEstornado.rowCount) throw new ErroNegocio('Este movimento já foi estornado.');

    const inverso = String(orig.quantidade_kg).startsWith('-')
      ? String(orig.quantidade_kg).slice(1)
      : `-${orig.quantidade_kg}`;

    const novoId = await movimentar(cx, {
      tipo: 'ESTORNO',
      produtoId: orig.produto_id,
      localId: orig.local_id,
      loteId: orig.lote_id,
      quantidadeKg: inverso,
      quantidadeOrigem: orig.quantidade_origem,
      unidadeId: orig.unidade_id,
      documentoTipo: orig.documento_tipo,
      documentoId: orig.documento_id,
      documentoNumero: orig.documento_numero,
      motivo,
      observacoes: `Estorno do movimento #${movimentoId}`,
      estornoDeId: movimentoId,
      usuarioId: usuario.id,
    });

    await registrar(cx, {
      usuario,
      acao: ACOES.ESTORNAR,
      modulo: 'estoque',
      registroTipo: 'ESTOQUE_MOVIMENTO',
      registroId: novoId,
      registroNumero: orig.documento_numero,
      descricao: `Estorno do movimento #${movimentoId}. Motivo: ${motivo}`,
      antes: { quantidade_kg: orig.quantidade_kg },
      depois: { quantidade_kg: inverso },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { id: novoId };
  });
}

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------

/** Cria uma reserva (estoque comprometido) para um documento. */
export async function reservar(cx, r) {
  const { rows } = await cx.query(
    `INSERT INTO estoque_reservas
        (produto_id, local_id, lote_id, quantidade_kg,
         documento_tipo, documento_id, documento_numero, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      r.produtoId,
      r.localId,
      r.loteId ?? null,
      r.quantidadeKg,
      r.documentoTipo,
      r.documentoId,
      r.documentoNumero ?? null,
      r.usuarioId ?? null,
    ]
  );
  return rows[0].id;
}

/** Marca a reserva como consumida (a mercadoria saiu de verdade). */
export async function consumirReserva(cx, documentoTipo, documentoId) {
  await cx.query(
    `UPDATE estoque_reservas
        SET status = 'CONSUMIDA', baixado_em = now()
      WHERE documento_tipo = $1 AND documento_id = $2 AND status = 'ATIVA'`,
    [documentoTipo, documentoId]
  );
}

/** Libera a reserva (documento cancelado). */
export async function liberarReserva(cx, documentoTipo, documentoId) {
  await cx.query(
    `UPDATE estoque_reservas
        SET status = 'CANCELADA', baixado_em = now()
      WHERE documento_tipo = $1 AND documento_id = $2 AND status = 'ATIVA'`,
    [documentoTipo, documentoId]
  );
}

/**
 * Confere se ha estoque DISPONIVEL (fisico - reservado) suficiente.
 * Usada antes de reservar, para dar mensagem clara ao usuario.
 */
export async function conferirDisponivel(cx, { produtoId, localId, loteId, quantidadeKg }) {
  const { rows } = await cx.query(
    `SELECT COALESCE(s.quantidade_kg, 0) AS fisico,
            COALESCE((SELECT SUM(quantidade_kg) FROM estoque_reservas r
                       WHERE r.produto_id = $1 AND r.local_id = $2
                         AND COALESCE(r.lote_id,0) = COALESCE($3::BIGINT,0)
                         AND r.status = 'ATIVA'), 0) AS reservado
       FROM (SELECT 1) x
       LEFT JOIN estoque_saldos s
              ON s.produto_id = $1 AND s.local_id = $2
             AND s.lote_key = COALESCE($3::BIGINT, 0)`,
    [produtoId, localId, loteId ?? null]
  );

  const fisico = Number(rows[0]?.fisico || 0);
  const reservado = Number(rows[0]?.reservado || 0);
  const disponivel = fisico - reservado;

  if (Number(quantidadeKg) > disponivel) {
    throw new ErroNegocio(
      `Estoque disponível insuficiente. Físico: ${fmt(fisico)} kg, ` +
        `reservado: ${fmt(reservado)} kg, disponível: ${fmt(disponivel)} kg, ` +
        `solicitado: ${fmt(Number(quantidadeKg))} kg.`
    );
  }
  return { fisico, reservado, disponivel };
}

const fmt = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export function posicao(filtros = {}) {
  const cond = [];
  const params = [];
  if (filtros.produtoId) {
    params.push(filtros.produtoId);
    cond.push(`produto_id = $${params.length}`);
  }
  if (filtros.localId) {
    params.push(filtros.localId);
    cond.push(`local_id = $${params.length}`);
  }
  if (!filtros.incluirZerados) cond.push('(fisico_kg <> 0 OR fumigado_saldo_kg <> 0)');

  return muitos(
    `SELECT * FROM vw_estoque_posicao
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY produto_descricao, local_nome, lote_codigo NULLS FIRST`,
    params
  );
}

export function totais() {
  return um(
    `SELECT COALESCE(SUM(fisico_kg),0)          AS fisico_kg,
            COALESCE(SUM(reservado_kg),0)       AS reservado_kg,
            COALESCE(SUM(disponivel_kg),0)      AS disponivel_kg,
            COALESCE(SUM(fumigado_saldo_kg),0)  AS fumigado_saldo_kg,
            COALESCE(SUM(expedido_kg),0)        AS expedido_kg
       FROM vw_estoque_posicao`
  );
}

export function movimentos(filtros = {}) {
  const cond = [];
  const params = [];
  if (filtros.produtoId) {
    params.push(filtros.produtoId);
    cond.push(`m.produto_id = $${params.length}`);
  }
  if (filtros.localId) {
    params.push(filtros.localId);
    cond.push(`m.local_id = $${params.length}`);
  }
  if (filtros.tipo) {
    params.push(filtros.tipo);
    cond.push(`m.tipo = $${params.length}`);
  }
  if (filtros.de) {
    params.push(filtros.de);
    cond.push(`m.data_movimento >= $${params.length}`);
  }
  if (filtros.ate) {
    params.push(filtros.ate);
    cond.push(`m.data_movimento <= $${params.length}`);
  }
  params.push(Number(filtros.limite || 300));

  return muitos(
    `SELECT m.*, p.descricao AS produto, p.codigo AS produto_codigo,
            l.nome AS local, lt.codigo AS lote, u.nome AS usuario,
            un.codigo AS unidade
       FROM estoque_movimentos m
       JOIN produtos p       ON p.id = m.produto_id
       JOIN locais_estoque l ON l.id = m.local_id
       LEFT JOIN lotes lt    ON lt.id = m.lote_id
       LEFT JOIN usuarios u  ON u.id = m.usuario_id
       LEFT JOIN unidades_medida un ON un.id = m.unidade_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY m.data_movimento DESC, m.id DESC
      LIMIT $${params.length}`,
    params
  );
}

export default {
  movimentar,
  ajustar,
  transferir,
  estornar,
  reservar,
  consumirReserva,
  liberarReserva,
  conferirDisponivel,
  posicao,
  totais,
  movimentos,
};
