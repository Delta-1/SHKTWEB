/**
 * Pedido de Compra (Fase 2).
 *
 * A regra que organiza tudo aqui:
 *
 *   O PEDIDO NAO MOVE ESTOQUE.
 *
 * O pedido registra um compromisso com o fornecedor e a previsao de
 * desembolso. Quem coloca grao no armazem e o RECEBIMENTO. Confundir os dois
 * e o jeito mais rapido de ter estoque no sistema que nao existe no patio.
 *
 *   RASCUNHO              -> livre para editar
 *   AGUARDANDO_APROVACAO  -> travado para quem nao aprova
 *   APROVADO              -> gera a previsao em Contas a Pagar; itens travados
 *   PARCIALMENTE_RECEBIDO -> chegou parte da carga (saldo em aberto)
 *   RECEBIDO              -> chegou tudo
 *   CANCELADO             -> encerra o compromisso e o titulo previsto
 */
import { transacao, muitos, um } from '../db/index.js';
import { registrar, ACOES, diferenca } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { Decimal } from '../lib/decimal.js';
import { somarDias } from '../lib/formato.js';
import { paraKg } from './unidades.js';
import { criarContaPagar, cancelarTituloEmTransacao } from './financeiro.js';
import config from '../config.js';

const EDITAVEIS = ['RASCUNHO', 'AGUARDANDO_APROVACAO'];

/** valor do item = quantidade digitada x preco unitario da unidade escolhida */
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
    conferirCabecalho(dados);

    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.PEDIDO_COMPRA);

    const { rows } = await cx.query(
      `INSERT INTO pedidos_compra (
          numero, data, fornecedor_id, tipo, incoterm_id, moeda,
          condicao_pagamento, prazo_dias, previsao_entrega, local_entrega_id,
          observacoes, status, criado_por
       ) VALUES ($1,COALESCE($2,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,$10,$11,'RASCUNHO',$12)
       RETURNING *`,
      [
        numero,
        dados.data ?? null,
        dados.fornecedorId,
        dados.tipo || 'MERCADORIA',
        dados.incotermId ?? null,
        dados.moeda || 'BRL',
        dados.condicaoPagamento ?? null,
        dados.prazoDias ?? null,
        dados.previsaoEntrega ?? null,
        dados.localEntregaId ?? null,
        dados.observacoes ?? null,
        usuario.id,
      ]
    );
    const pedido = rows[0];

    await gravarItens(cx, pedido, dados.itens);
    const completo = await recarregar(cx, pedido.id);

    await registrar(cx, {
      usuario,
      acao: ACOES.CRIAR,
      modulo: 'compras',
      registroTipo: 'PEDIDO_COMPRA',
      registroId: pedido.id,
      registroNumero: numero,
      descricao:
        `Pedido de compra ${numero} criado para ${dados.itens.length} item(ns), ` +
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
    conferirCabecalho(dados);

    const { rows } = await cx.query(
      `UPDATE pedidos_compra SET
          data = COALESCE($1, data), fornecedor_id = $2, tipo = $3, incoterm_id = $4,
          moeda = $5, condicao_pagamento = $6, prazo_dias = $7, previsao_entrega = $8,
          local_entrega_id = $9, observacoes = $10, atualizado_por = $11
        WHERE id = $12 RETURNING *`,
      [
        dados.data ?? null,
        dados.fornecedorId,
        dados.tipo || atual.tipo,
        dados.incotermId ?? null,
        dados.moeda || atual.moeda,
        dados.condicaoPagamento ?? null,
        dados.prazoDias ?? null,
        dados.previsaoEntrega ?? null,
        dados.localEntregaId ?? null,
        dados.observacoes ?? null,
        usuario.id,
        id,
      ]
    );

    await cx.query('DELETE FROM pedido_compra_itens WHERE pedido_id = $1', [id]);
    await gravarItens(cx, rows[0], dados.itens);
    const completo = await recarregar(cx, id);

    const dif = diferenca(atual, completo);
    if (dif) {
      await registrar(cx, {
        usuario,
        acao: ACOES.ALTERAR,
        modulo: 'compras',
        registroTipo: 'PEDIDO_COMPRA',
        registroId: id,
        registroNumero: atual.numero,
        descricao: `Pedido de compra ${atual.numero} alterado.`,
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
    if (p.status !== 'RASCUNHO')
      throw new ErroNegocio(`O pedido ${p.numero} não está em rascunho.`);
    await exigirItens(cx, p);

    await cx.query(
      `UPDATE pedidos_compra SET status = 'AGUARDANDO_APROVACAO', atualizado_por = $1 WHERE id = $2`,
      [usuario.id, id]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.ALTERAR,
      modulo: 'compras',
      registroTipo: 'PEDIDO_COMPRA',
      registroId: id,
      registroNumero: p.numero,
      descricao: `Pedido de compra ${p.numero} enviado para aprovação.`,
      antes: { status: p.status },
      depois: { status: 'AGUARDANDO_APROVACAO' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { ok: true };
  });
}

/**
 * Aprovacao: fecha o compromisso e lanca a PREVISAO em Contas a Pagar.
 * O titulo nasce aqui, e nao no recebimento, porque a obrigacao de pagar
 * nasce do pedido aprovado - mesmo que a mercadoria chegue em tres viagens.
 */
export async function aprovar(id, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const p = await bloquear(cx, id);

    if (p.status === 'CANCELADO')
      throw new ErroNegocio(`O pedido ${p.numero} está cancelado.`);
    if (p.status !== 'RASCUNHO' && p.status !== 'AGUARDANDO_APROVACAO')
      throw new ErroNegocio(`O pedido ${p.numero} já foi aprovado.`);

    await exigirItens(cx, p);

    const { rows } = await cx.query(
      `UPDATE pedidos_compra
          SET status = 'APROVADO', aprovado_em = now(), aprovado_por = $1, atualizado_por = $1
        WHERE id = $2 RETURNING *`,
      [usuario.id, id]
    );
    const pedido = rows[0];

    let contaPagar = null;
    if (Decimal.de(pedido.valor_total, 2).ehPositivo()) {
      const moeda = await cx.query('SELECT id FROM moedas WHERE codigo = $1 LIMIT 1', [pedido.moeda]);
      const categoria = await cx.query(
        `SELECT id FROM categorias_financeiras
          WHERE codigo = $1 AND tipo = 'DESPESA' LIMIT 1`,
        [
          pedido.tipo === 'FRETE'
            ? 'FRETE'
            : pedido.tipo === 'SERVICO'
              ? 'CUSTO_OPERACIONAL'
              : 'COMPRA_MERCADORIA',
        ]
      );

      contaPagar = await criarContaPagar(
        cx,
        {
          descricao: `Pedido de compra ${pedido.numero}`,
          origem: 'COMPRA',
          origemTipo: 'PEDIDO_COMPRA',
          origemId: pedido.id,
          origemNumero: pedido.numero,
          parceiroId: pedido.fornecedor_id,
          categoriaId: categoria.rows[0]?.id ?? null,
          emissao: pedido.data,
          vencimento: vencimentoPrevisto(pedido),
          competencia: pedido.data,
          valor: pedido.valor_total,
          moedaId: moeda.rows[0]?.id ?? null,
          observacoes:
            `Previsão gerada automaticamente pela aprovação do pedido de compra ${pedido.numero}. ` +
            'Ajuste o vencimento e o valor conforme a nota fiscal quando ela chegar.',
        },
        usuario
      );
    }

    await registrar(cx, {
      usuario,
      acao: ACOES.APROVAR,
      modulo: 'compras',
      registroTipo: 'PEDIDO_COMPRA',
      registroId: id,
      registroNumero: pedido.numero,
      descricao:
        `Pedido de compra ${pedido.numero} aprovado no valor de ${pedido.valor_total}.` +
        (contaPagar ? ` Contas a Pagar ${contaPagar.numero} gerado.` : ''),
      antes: { status: p.status },
      depois: { status: 'APROVADO' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { pedido, contaPagar };
  });
}

export async function cancelar(id, motivo, usuario, contexto = {}) {
  if (!motivo?.trim()) throw new ErroNegocio('Informe o motivo do cancelamento.');

  return transacao(async (cx) => {
    const p = await bloquear(cx, id);
    if (p.status === 'CANCELADO') throw new ErroNegocio('Este pedido já está cancelado.');

    // Mercadoria que ja entrou nao volta por cancelamento de pedido: o
    // caminho correto e cancelar o recebimento, que estorna o estoque.
    const recebidos = await cx.query(
      `SELECT numero FROM recebimentos
        WHERE pedido_compra_id = $1 AND status = 'CONFIRMADO' ORDER BY numero`,
      [id]
    );
    if (recebidos.rows.length)
      throw new ErroNegocio(
        `O pedido ${p.numero} já tem recebimento confirmado ` +
          `(${recebidos.rows.map((r) => r.numero).join(', ')}). ` +
          'Cancele o recebimento primeiro — é ele que devolve o estoque.'
      );

    const titulo = await cancelarTituloEmTransacao(
      cx,
      'CP',
      'PEDIDO_COMPRA',
      id,
      `Pedido de compra ${p.numero} cancelado: ${motivo}`,
      usuario
    );

    await cx.query(
      `UPDATE pedidos_compra
          SET status = 'CANCELADO', cancelado_em = now(), cancelado_por = $1,
              motivo_cancelamento = $2, atualizado_por = $1
        WHERE id = $3`,
      [usuario.id, motivo, id]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.CANCELAR,
      modulo: 'compras',
      registroTipo: 'PEDIDO_COMPRA',
      registroId: id,
      registroNumero: p.numero,
      descricao:
        `Pedido de compra ${p.numero} cancelado. Motivo: ${motivo}` +
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
// Auxiliares
// ---------------------------------------------------------------------------

function conferirCabecalho(dados) {
  if (!dados.itens?.length)
    throw new ErroNegocio('Informe ao menos um item no pedido de compra.');

  if (dados.tipo === 'MERCADORIA' || !dados.tipo) {
    if (!dados.localEntregaId)
      throw new ErroNegocio(
        'Pedido de mercadoria precisa do local de entrega — é para lá que o estoque vai entrar.'
      );
    for (const item of dados.itens) {
      if (!item.produtoId)
        throw new ErroNegocio('Todo item de um pedido de mercadoria precisa de um produto.');
    }
  }
}

async function gravarItens(cx, pedido, itens) {
  for (const item of itens) {
    const conv = await paraKg(cx, item.quantidade, item.unidadeId);
    const valor = calcularItem(conv.origem, item.precoUnitario);

    await cx.query(
      `INSERT INTO pedido_compra_itens
          (pedido_id, produto_id, descricao, quantidade_kg, quantidade_origem,
           unidade_id, preco_unitario, valor_total, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        pedido.id,
        item.produtoId ?? null,
        item.descricao,
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
    'SELECT COUNT(*)::INT AS n FROM pedido_compra_itens WHERE pedido_id = $1',
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
  if (pedido.previsao_entrega) return pedido.previsao_entrega;
  return somarDias(pedido.data, config.regras.diasVencimentoCompra);
}

async function bloquear(cx, id) {
  const { rows } = await cx.query('SELECT * FROM pedidos_compra WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new ErroNaoEncontrado('Pedido de compra não encontrado.');
  return rows[0];
}

const recarregar = (cx, id) =>
  cx.query('SELECT * FROM pedidos_compra WHERE id = $1', [id]).then((r) => r.rows[0]);

export const ROTULOS = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  APROVADO: 'Aprovado',
  PARCIALMENTE_RECEBIDO: 'Parcialmente recebido',
  RECEBIDO: 'Recebido',
  CANCELADO: 'Cancelado',
};
export const rotuloStatus = (s) => ROTULOS[s] || s;

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const SELECT_BASE = `
  SELECT p.*,
         f.razao_social AS fornecedor,
         ic.codigo      AS incoterm,
         le.nome        AS local_entrega,
         (SELECT COALESCE(SUM(i.quantidade_kg), 0) FROM pedido_compra_itens i
           WHERE i.pedido_id = p.id)::NUMERIC(18,3) AS pedido_kg,
         (SELECT COALESCE(SUM(i.recebido_kg), 0) FROM pedido_compra_itens i
           WHERE i.pedido_id = p.id)::NUMERIC(18,3) AS recebido_kg,
         (SELECT COUNT(*)::INT FROM pedido_compra_itens i WHERE i.pedido_id = p.id) AS itens
    FROM pedidos_compra p
    JOIN parceiros f            ON f.id = p.fornecedor_id
    LEFT JOIN incoterms ic      ON ic.id = p.incoterm_id
    LEFT JOIN locais_estoque le ON le.id = p.local_entrega_id`;

export function listar(filtros = {}) {
  const cond = [];
  const params = [];
  if (filtros.status) {
    params.push(filtros.status);
    cond.push(`p.status = $${params.length}`);
  }
  if (filtros.fornecedorId) {
    params.push(filtros.fornecedorId);
    cond.push(`p.fornecedor_id = $${params.length}`);
  }
  if (filtros.tipo) {
    params.push(filtros.tipo);
    cond.push(`p.tipo = $${params.length}`);
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
    cond.push(`(p.numero ILIKE $${params.length} OR f.razao_social ILIKE $${params.length})`);
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
    `SELECT i.*,
            pr.codigo AS produto_codigo, pr.descricao AS produto,
            u.codigo AS unidade, u.fator_kg,
            GREATEST(i.quantidade_kg - i.recebido_kg, 0)::NUMERIC(18,3) AS saldo_kg
       FROM pedido_compra_itens i
       LEFT JOIN produtos pr        ON pr.id = i.produto_id
       LEFT JOIN unidades_medida u  ON u.id = i.unidade_id
      WHERE i.pedido_id = $1 ORDER BY i.id`,
    [id]
  );

  p.recebimentos = await muitos(
    `SELECT r.id, r.numero, r.data, r.status, r.documento_fiscal,
            (SELECT COALESCE(SUM(ri.quantidade_kg),0) FROM recebimento_itens ri
              WHERE ri.recebimento_id = r.id)::NUMERIC(18,3) AS quantidade_kg
       FROM recebimentos r WHERE r.pedido_compra_id = $1 ORDER BY r.id`,
    [id]
  );

  p.titulo = await um(
    `SELECT id, numero, vencimento, valor, status FROM contas_pagar
      WHERE origem_tipo = 'PEDIDO_COMPRA' AND origem_id = $1 AND status <> 'CANCELADO'`,
    [id]
  );

  return p;
}

/** Itens ainda com saldo a receber, para montar a tela de recebimento. */
export const itensEmAberto = (pedidoId) =>
  muitos(
    `SELECT i.*, pr.codigo AS produto_codigo, pr.descricao AS produto,
            u.codigo AS unidade, u.fator_kg,
            (i.quantidade_kg - i.recebido_kg)::NUMERIC(18,3) AS saldo_kg
       FROM pedido_compra_itens i
       LEFT JOIN produtos pr       ON pr.id = i.produto_id
       LEFT JOIN unidades_medida u ON u.id = i.unidade_id
      WHERE i.pedido_id = $1 AND i.produto_id IS NOT NULL
      ORDER BY i.id`,
    [pedidoId]
  );

/** Pedidos que ainda esperam mercadoria — alimenta a tela de recebimento. */
export const aguardandoEntrega = () =>
  muitos(
    `SELECT p.id, p.numero, p.data, p.previsao_entrega, p.status,
            p.fornecedor_id, p.local_entrega_id, f.razao_social AS fornecedor,
            (SELECT COALESCE(SUM(i.quantidade_kg - i.recebido_kg), 0)
               FROM pedido_compra_itens i WHERE i.pedido_id = p.id)::NUMERIC(18,3) AS saldo_kg
       FROM pedidos_compra p
       JOIN parceiros f ON f.id = p.fornecedor_id
      WHERE p.status IN ('APROVADO','PARCIALMENTE_RECEBIDO') AND p.tipo = 'MERCADORIA'
      ORDER BY p.previsao_entrega NULLS LAST, p.numero`
  );

export const totaisPeriodo = (de, ate) =>
  um(
    `SELECT COUNT(*) FILTER (WHERE status NOT IN ('CANCELADO','RASCUNHO')) AS pedidos,
            COUNT(*) FILTER (WHERE status = 'AGUARDANDO_APROVACAO')        AS aguardando,
            COUNT(*) FILTER (WHERE status IN ('APROVADO','PARCIALMENTE_RECEBIDO')) AS em_aberto,
            COALESCE(SUM(valor_total) FILTER (WHERE status NOT IN ('CANCELADO','RASCUNHO')), 0) AS valor
       FROM pedidos_compra
      WHERE ($1::DATE IS NULL OR data >= $1) AND ($2::DATE IS NULL OR data <= $2)`,
    [de ?? null, ate ?? null]
  );

export default {
  criar,
  atualizar,
  enviarParaAprovacao,
  aprovar,
  cancelar,
  listar,
  buscar,
  itensEmAberto,
  aguardandoEntrega,
  totaisPeriodo,
  calcularItem,
  rotuloStatus,
  ROTULOS,
};
