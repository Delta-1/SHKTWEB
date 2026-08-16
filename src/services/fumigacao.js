/**
 * Servico de Fumigacao (secoes 9 e 10) - modulo critico do ERP.
 *
 * Regra obrigatoria: o numero do Comunicado de Fumigacao e indispensavel para
 * validar a fumigacao. Sem ele, a fumigacao nunca assume status VALIDADA e,
 * consequentemente, nao gera saldo fumigado nem permite emissao de certificado.
 *
 * Conta-corrente de fumigacao:
 *    Entrada = quantidade validamente fumigada
 *    Saida   = quantidade consumida por certificados validados
 *    Saldo   = entrada - saida  (nunca pode ficar negativo)
 */
import { transacao, muitos, um } from '../db/index.js';
import { registrar, ACOES, diferenca } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { paraKg } from './unidades.js';

const EDITAVEIS = ['RASCUNHO', 'EM_ANDAMENTO', 'AGUARDANDO_COMUNICADO'];

export async function criar(dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const conv = await paraKg(cx, dados.quantidade, dados.unidadeId);
    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.FUMIGACAO);

    const fumigadora = await cx.query(
      'SELECT id, is_fumigadora, custo_tonelada, razao_social FROM parceiros WHERE id = $1',
      [dados.fumigadoraId]
    );
    if (!fumigadora.rows[0]) throw new ErroNaoEncontrado('Empresa fumigadora não encontrada.');
    if (!fumigadora.rows[0].is_fumigadora)
      throw new ErroNegocio(
        `${fumigadora.rows[0].razao_social} não está marcada como empresa fumigadora no cadastro.`
      );

    const status = dados.numeroComunicado ? 'EM_ANDAMENTO' : 'RASCUNHO';

    const { rows } = await cx.query(
      `INSERT INTO fumigacoes (
          numero, numero_comunicado, fumigadora_id, produto_id, local_id, lote_id,
          quantidade_kg, quantidade_origem, unidade_id,
          data_hora_inicio, data_hora_termino, custo_tonelada, moeda_id,
          responsavel, observacoes, status, criado_por
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        numero,
        dados.numeroComunicado ?? null,
        dados.fumigadoraId,
        dados.produtoId,
        dados.localId,
        dados.loteId ?? null,
        conv.kg,
        conv.origem,
        dados.unidadeId,
        dados.inicio ?? null,
        dados.termino ?? null,
        dados.custoTonelada ?? fumigadora.rows[0].custo_tonelada ?? null,
        dados.moedaId,
        dados.responsavel ?? usuario.nome,
        dados.observacoes ?? null,
        status,
        usuario.id,
      ]
    );
    const fumigacao = rows[0];

    await registrar(cx, {
      usuario,
      acao: ACOES.CRIAR,
      modulo: 'fumigacao',
      registroTipo: 'FUMIGACAO',
      registroId: fumigacao.id,
      registroNumero: numero,
      descricao: `Pedido de fumigação ${numero} criado com ${conv.kg} kg.`,
      depois: fumigacao,
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return fumigacao;
  });
}

export async function atualizar(id, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const atual = await bloquear(cx, id);

    if (!EDITAVEIS.includes(atual.status))
      throw new ErroNegocio(
        `A fumigação ${atual.numero} está com status "${atual.status}" e não pode mais ser editada. ` +
          'Para corrigir, cancele e emita um novo pedido de fumigação.'
      );

    const conv = await paraKg(cx, dados.quantidade, dados.unidadeId);

    const { rows } = await cx.query(
      `UPDATE fumigacoes SET
          numero_comunicado = $1::TEXT, fumigadora_id = $2, produto_id = $3, local_id = $4,
          lote_id = $5, quantidade_kg = $6, quantidade_origem = $7, unidade_id = $8,
          data_hora_inicio = $9, data_hora_termino = $10, custo_tonelada = $11,
          moeda_id = $12, responsavel = $13, observacoes = $14,
          -- Informar o Comunicado tira a fumigação do rascunho sozinho: é o
          -- passo que faz o pedido virar operação de verdade.
          status = CASE WHEN btrim(COALESCE($1::TEXT, '')) <> '' AND status = 'RASCUNHO'
                        THEN 'EM_ANDAMENTO' ELSE status END,
          atualizado_por = $15
        WHERE id = $16
        RETURNING *`,
      [
        dados.numeroComunicado ?? null,
        dados.fumigadoraId,
        dados.produtoId,
        dados.localId,
        dados.loteId ?? null,
        conv.kg,
        conv.origem,
        dados.unidadeId,
        dados.inicio ?? null,
        dados.termino ?? null,
        dados.custoTonelada ?? null,
        dados.moedaId,
        dados.responsavel ?? null,
        dados.observacoes ?? null,
        usuario.id,
        id,
      ]
    );

    const dif = diferenca(atual, rows[0]);
    if (dif) {
      await registrar(cx, {
        usuario,
        acao: ACOES.ALTERAR,
        modulo: 'fumigacao',
        registroTipo: 'FUMIGACAO',
        registroId: id,
        registroNumero: atual.numero,
        descricao: `Fumigação ${atual.numero} alterada.`,
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
 * VALIDACAO DA FUMIGACAO - regra central do modulo.
 *
 * 1. exige numero do Comunicado de Fumigacao;
 * 2. exige data/hora de inicio e termino (exaustao);
 * 3. muda o status para VALIDADA;
 * 4. lanca a ENTRADA na conta-corrente de fumigacao;
 * 5. registra auditoria.
 * Tudo em uma unica transacao.
 */
export async function validar(id, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const f = await bloquear(cx, id);

    if (f.status === 'VALIDADA') throw new ErroNegocio('Esta fumigação já está validada.');
    if (f.status === 'CANCELADA') throw new ErroNegocio('Esta fumigação está cancelada.');

    const comunicado = (dados.numeroComunicado ?? f.numero_comunicado ?? '').trim();
    if (!comunicado)
      throw new ErroNegocio(
        'O número do Comunicado de Fumigação é obrigatório para validar a fumigação. ' +
          'Informe o comunicado emitido pela empresa fumigadora.'
      );

    const termino = dados.termino ?? f.data_hora_termino;
    if (!termino)
      throw new ErroNegocio(
        'Informe a data/hora de término (exaustão) antes de validar a fumigação.'
      );

    const inicio = dados.inicio ?? f.data_hora_inicio;
    if (inicio && new Date(termino) < new Date(inicio))
      throw new ErroNegocio('A data/hora de término não pode ser anterior à de início.');

    const { rows } = await cx.query(
      `UPDATE fumigacoes SET
          numero_comunicado = $1,
          data_hora_inicio  = COALESCE($2, data_hora_inicio),
          data_hora_termino = $3,
          status = 'VALIDADA',
          validada_em = now(),
          validada_por = $4,
          atualizado_por = $4
        WHERE id = $5
        RETURNING *`,
      [comunicado, inicio, termino, usuario.id, id]
    );
    const fumigacao = rows[0];

    // Entrada na conta-corrente de fumigacao
    await cx.query(
      `INSERT INTO fumigacao_movimentos
          (fumigacao_id, tipo, quantidade_kg, saldo_apos_kg,
           documento_tipo, documento_id, documento_numero, historico, usuario_id)
       VALUES ($1,'ENTRADA',$2,$3,'FUMIGACAO',$1,$4,$5,$6)`,
      [
        id,
        fumigacao.quantidade_kg,
        fumigacao.quantidade_kg,
        fumigacao.numero,
        `Fumigação validada - Comunicado ${comunicado}`,
        usuario.id,
      ]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.VALIDAR,
      modulo: 'fumigacao',
      registroTipo: 'FUMIGACAO',
      registroId: id,
      registroNumero: fumigacao.numero,
      descricao:
        `Fumigação ${fumigacao.numero} validada com Comunicado ${comunicado}. ` +
        `Saldo fumigado disponível: ${fumigacao.quantidade_kg} kg.`,
      antes: { status: f.status, numero_comunicado: f.numero_comunicado },
      depois: { status: 'VALIDADA', numero_comunicado: comunicado },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return fumigacao;
  });
}

export async function cancelar(id, motivo, usuario, contexto = {}) {
  if (!motivo?.trim()) throw new ErroNegocio('Informe o motivo do cancelamento.');

  return transacao(async (cx) => {
    const f = await bloquear(cx, id);
    if (f.status === 'CANCELADA') throw new ErroNegocio('Esta fumigação já está cancelada.');

    const certificados = await cx.query(
      `SELECT numero FROM certificados_fumigacao
        WHERE fumigacao_id = $1 AND status <> 'CANCELADO'`,
      [id]
    );
    if (certificados.rowCount)
      throw new ErroNegocio(
        `Esta fumigação possui ${certificados.rowCount} certificado(s) ativo(s) ` +
          `(${certificados.rows.map((c) => c.numero).join(', ')}). ` +
          'Cancele os certificados antes de cancelar a fumigação.'
      );

    await cx.query(
      `UPDATE fumigacoes
          SET status = 'CANCELADA', cancelada_em = now(), cancelada_por = $1,
              motivo_cancelamento = $2, atualizado_por = $1
        WHERE id = $3`,
      [usuario.id, motivo, id]
    );

    if (f.status === 'VALIDADA') {
      await cx.query(
        `INSERT INTO fumigacao_movimentos
            (fumigacao_id, tipo, quantidade_kg, saldo_apos_kg,
             documento_tipo, documento_id, documento_numero, historico, usuario_id)
         VALUES ($1,'ESTORNO',$2,0,'FUMIGACAO',$1,$3,$4,$5)`,
        [id, `-${f.quantidade_kg}`, f.numero, `Cancelamento: ${motivo}`, usuario.id]
      );
    }

    await registrar(cx, {
      usuario,
      acao: ACOES.CANCELAR,
      modulo: 'fumigacao',
      registroTipo: 'FUMIGACAO',
      registroId: id,
      registroNumero: f.numero,
      descricao: `Fumigação ${f.numero} cancelada. Motivo: ${motivo}`,
      antes: { status: f.status },
      depois: { status: 'CANCELADA' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { ok: true };
  });
}

async function bloquear(cx, id) {
  const { rows } = await cx.query('SELECT * FROM fumigacoes WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new ErroNaoEncontrado('Fumigação não encontrada.');
  return rows[0];
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const SELECT_BASE = `
  SELECT f.*,
         f.quantidade_kg - f.quantidade_certificada_kg AS saldo_kg,
         pf.razao_social AS fumigadora,
         p.descricao AS produto, p.codigo AS produto_codigo,
         l.nome AS local, lt.codigo AS lote,
         un.codigo AS unidade, un.fator_kg,
         m.codigo AS moeda, m.simbolo AS moeda_simbolo,
         uv.nome AS validada_por_nome
    FROM fumigacoes f
    JOIN parceiros pf      ON pf.id = f.fumigadora_id
    JOIN produtos p        ON p.id = f.produto_id
    JOIN locais_estoque l  ON l.id = f.local_id
    LEFT JOIN lotes lt     ON lt.id = f.lote_id
    LEFT JOIN unidades_medida un ON un.id = f.unidade_id
    LEFT JOIN moedas m     ON m.id = f.moeda_id
    LEFT JOIN usuarios uv  ON uv.id = f.validada_por`;

export function listar(filtros = {}) {
  const cond = [];
  const params = [];
  if (filtros.status) {
    params.push(filtros.status);
    cond.push(`f.status = $${params.length}`);
  }
  if (filtros.produtoId) {
    params.push(filtros.produtoId);
    cond.push(`f.produto_id = $${params.length}`);
  }
  if (filtros.fumigadoraId) {
    params.push(filtros.fumigadoraId);
    cond.push(`f.fumigadora_id = $${params.length}`);
  }
  if (filtros.de) {
    params.push(filtros.de);
    cond.push(`f.data_hora_inicio >= $${params.length}`);
  }
  if (filtros.ate) {
    params.push(filtros.ate);
    cond.push(`f.data_hora_inicio <= ($${params.length}::DATE + 1)`);
  }
  if (filtros.comSaldo) cond.push(`f.status = 'VALIDADA' AND f.quantidade_kg > f.quantidade_certificada_kg`);
  if (filtros.busca) {
    params.push(`%${filtros.busca}%`);
    cond.push(`(f.numero ILIKE $${params.length} OR f.numero_comunicado ILIKE $${params.length})`);
  }
  params.push(Number(filtros.limite || 200));

  return muitos(
    `${SELECT_BASE}
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY f.id DESC
      LIMIT $${params.length}`,
    params
  );
}

export async function buscar(id) {
  const f = await um(`${SELECT_BASE} WHERE f.id = $1`, [id]);
  if (!f) return null;

  f.movimentos = await muitos(
    `SELECT fm.*, u.nome AS usuario
       FROM fumigacao_movimentos fm
       LEFT JOIN usuarios u ON u.id = fm.usuario_id
      WHERE fm.fumigacao_id = $1
      ORDER BY fm.id`,
    [id]
  );

  f.certificados = await muitos(
    `SELECT c.*, cp.numero AS conta_pagar_numero, cp.status AS conta_pagar_status
       FROM certificados_fumigacao c
       LEFT JOIN contas_pagar cp ON cp.id = c.conta_pagar_id
      WHERE c.fumigacao_id = $1
      ORDER BY c.id`,
    [id]
  );

  return f;
}

/** Fumigacoes validadas com saldo disponivel - alimenta a tela de certificado. */
export const comSaldo = (produtoId = null) =>
  muitos(
    `${SELECT_BASE}
      WHERE f.status = 'VALIDADA'
        AND f.quantidade_kg > f.quantidade_certificada_kg
        ${produtoId ? 'AND f.produto_id = $1' : ''}
      ORDER BY f.data_hora_termino NULLS LAST, f.id`,
    produtoId ? [produtoId] : []
  );

export const saldoTotal = () =>
  um(
    `SELECT COALESCE(SUM(quantidade_kg - quantidade_certificada_kg), 0) AS saldo_kg,
            COALESCE(SUM(quantidade_kg), 0) AS total_kg,
            COUNT(*) AS quantidade
       FROM fumigacoes WHERE status = 'VALIDADA'`
  );

/** Fumigacoes pendentes de comunicado - alerta do dashboard. */
export const semComunicado = () =>
  muitos(
    `SELECT f.id, f.numero, f.quantidade_kg, p.descricao AS produto, f.criado_em
       FROM fumigacoes f
       JOIN produtos p ON p.id = f.produto_id
      WHERE f.status IN ('RASCUNHO','EM_ANDAMENTO','AGUARDANDO_COMUNICADO')
        AND (f.numero_comunicado IS NULL OR btrim(f.numero_comunicado) = '')
      ORDER BY f.criado_em`
  );

export default { criar, atualizar, validar, cancelar, listar, buscar, comSaldo, saldoTotal, semComunicado };
