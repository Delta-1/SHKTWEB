/**
 * Ordem de Carregamento / Expedicao / Exportacao (secao 13).
 *
 * Definicao clara de qual evento move o estoque, para nunca duplicar baixa:
 *
 *   RASCUNHO         -> nao toca no estoque
 *   PROGRAMADO       -> RESERVA a quantidade (estoque comprometido)
 *   EM_CARREGAMENTO  -> mantem a reserva
 *   EXPEDIDO         -> consome a reserva e da a BAIXA FISICA no estoque
 *   CANCELADO        -> libera a reserva; se ja expedido, estorna a baixa
 *
 * A baixa fisica acontece uma unica vez, na confirmacao da expedicao.
 */
import { transacao, muitos, um } from '../db/index.js';
import { registrar, ACOES, diferenca } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { Decimal } from '../lib/decimal.js';
import { paraKg } from './unidades.js';
import * as estoque from './estoque.js';

const EDITAVEIS = ['RASCUNHO', 'PROGRAMADO', 'EM_CARREGAMENTO'];

export async function criar(dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const conv = await paraKg(cx, dados.quantidade, dados.unidadeId);
    await conferirCertificado(cx, dados, conv.kg, null);

    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.CARREGAMENTO);
    const pesos = calcularPesos(dados);

    const { rows } = await cx.query(
      `INSERT INTO carregamentos (
          numero, data, data_hora_carga, cliente_id, produto_id, local_id, lote_id,
          quantidade_kg, quantidade_origem, unidade_id,
          peso_bruto_kg, peso_tara_kg, peso_liquido_kg,
          veiculo_id, placa, placa_reboque, motorista_id, transportadora_id,
          origem, destino, pais_destino_id, incoterm_id, certificado_id,
          tipo_operacao, observacoes, responsavel, status, criado_por
       ) VALUES ($1,COALESCE($2,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                 $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'RASCUNHO',$27)
       RETURNING *`,
      [
        numero,
        dados.data ?? null,
        dados.dataHoraCarga ?? null,
        dados.clienteId ?? null,
        dados.produtoId,
        dados.localId,
        dados.loteId ?? null,
        conv.kg,
        conv.origem,
        dados.unidadeId,
        pesos.bruto,
        pesos.tara,
        pesos.liquido,
        dados.veiculoId ?? null,
        dados.placa ?? null,
        dados.placaReboque ?? null,
        dados.motoristaId ?? null,
        dados.transportadoraId ?? null,
        dados.origem ?? null,
        dados.destino ?? null,
        dados.paisDestinoId ?? null,
        dados.incotermId ?? null,
        dados.certificadoId ?? null,
        dados.tipoOperacao || 'EXPORTACAO',
        dados.observacoes ?? null,
        dados.responsavel ?? usuario.nome,
        usuario.id,
      ]
    );
    const carregamento = rows[0];

    await registrar(cx, {
      usuario,
      acao: ACOES.CRIAR,
      modulo: 'carregamento',
      registroTipo: 'CARREGAMENTO',
      registroId: carregamento.id,
      registroNumero: numero,
      descricao: `Ordem de carregamento ${numero} criada com ${conv.kg} kg.`,
      depois: carregamento,
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return carregamento;
  });
}

export async function atualizar(id, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const atual = await bloquear(cx, id);
    if (!EDITAVEIS.includes(atual.status))
      throw new ErroNegocio(
        `O carregamento ${atual.numero} está "${atual.status}" e não pode mais ser editado. ` +
          'Para corrigir, cancele e emita uma nova ordem.'
      );

    const conv = await paraKg(cx, dados.quantidade, dados.unidadeId);
    await conferirCertificado(cx, dados, conv.kg, id);
    const pesos = calcularPesos(dados);

    const { rows } = await cx.query(
      `UPDATE carregamentos SET
          data = COALESCE($1, data), data_hora_carga = $2, cliente_id = $3,
          produto_id = $4, local_id = $5, lote_id = $6,
          quantidade_kg = $7, quantidade_origem = $8, unidade_id = $9,
          peso_bruto_kg = $10, peso_tara_kg = $11, peso_liquido_kg = $12,
          veiculo_id = $13, placa = $14, placa_reboque = $15, motorista_id = $16,
          transportadora_id = $17, origem = $18, destino = $19, pais_destino_id = $20,
          incoterm_id = $21, certificado_id = $22, tipo_operacao = $23,
          observacoes = $24, responsavel = $25, atualizado_por = $26
        WHERE id = $27
        RETURNING *`,
      [
        dados.data ?? null,
        dados.dataHoraCarga ?? null,
        dados.clienteId ?? null,
        dados.produtoId,
        dados.localId,
        dados.loteId ?? null,
        conv.kg,
        conv.origem,
        dados.unidadeId,
        pesos.bruto,
        pesos.tara,
        pesos.liquido,
        dados.veiculoId ?? null,
        dados.placa ?? null,
        dados.placaReboque ?? null,
        dados.motoristaId ?? null,
        dados.transportadoraId ?? null,
        dados.origem ?? null,
        dados.destino ?? null,
        dados.paisDestinoId ?? null,
        dados.incotermId ?? null,
        dados.certificadoId ?? null,
        dados.tipoOperacao || atual.tipo_operacao,
        dados.observacoes ?? null,
        dados.responsavel ?? null,
        usuario.id,
        id,
      ]
    );

    // Se ja estava reservado, ajusta a reserva para a nova quantidade
    if (atual.status !== 'RASCUNHO') {
      await estoque.liberarReserva(cx, 'CARREGAMENTO', id);
      await estoque.conferirDisponivel(cx, {
        produtoId: dados.produtoId,
        localId: dados.localId,
        loteId: dados.loteId ?? null,
        quantidadeKg: conv.kg,
      });
      await estoque.reservar(cx, {
        produtoId: dados.produtoId,
        localId: dados.localId,
        loteId: dados.loteId ?? null,
        quantidadeKg: conv.kg,
        documentoTipo: 'CARREGAMENTO',
        documentoId: id,
        documentoNumero: atual.numero,
        usuarioId: usuario.id,
      });
    }

    const dif = diferenca(atual, rows[0]);
    if (dif) {
      await registrar(cx, {
        usuario,
        acao: ACOES.ALTERAR,
        modulo: 'carregamento',
        registroTipo: 'CARREGAMENTO',
        registroId: id,
        registroNumero: atual.numero,
        descricao: `Carregamento ${atual.numero} alterado.`,
        antes: dif.antes,
        depois: dif.depois,
        ip: contexto.ip,
        sessao: contexto.sessao,
      });
    }

    return rows[0];
  });
}

/** RASCUNHO -> PROGRAMADO: reserva o estoque. */
export async function programar(id, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const c = await bloquear(cx, id);
    if (c.status !== 'RASCUNHO')
      throw new ErroNegocio(`O carregamento ${c.numero} já foi programado.`);

    await estoque.conferirDisponivel(cx, {
      produtoId: c.produto_id,
      localId: c.local_id,
      loteId: c.lote_id,
      quantidadeKg: c.quantidade_kg,
    });

    await estoque.reservar(cx, {
      produtoId: c.produto_id,
      localId: c.local_id,
      loteId: c.lote_id,
      quantidadeKg: c.quantidade_kg,
      documentoTipo: 'CARREGAMENTO',
      documentoId: id,
      documentoNumero: c.numero,
      usuarioId: usuario.id,
    });

    await cx.query(`UPDATE carregamentos SET status = 'PROGRAMADO', atualizado_por = $1 WHERE id = $2`, [
      usuario.id,
      id,
    ]);

    await registrar(cx, {
      usuario,
      acao: ACOES.APROVAR,
      modulo: 'carregamento',
      registroTipo: 'CARREGAMENTO',
      registroId: id,
      registroNumero: c.numero,
      descricao: `Carregamento ${c.numero} programado. ${c.quantidade_kg} kg reservados no estoque.`,
      antes: { status: c.status },
      depois: { status: 'PROGRAMADO' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { ok: true };
  });
}

/**
 * CONFIRMACAO DA EXPEDICAO - da a baixa fisica no estoque.
 * A quantidade efetivamente expedida pode diferir da programada (pesagem);
 * neste caso o documento e ajustado antes da baixa.
 */
export async function expedir(id, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const c = await bloquear(cx, id);

    if (c.status === 'EXPEDIDO') throw new ErroNegocio('Este carregamento já foi expedido.');
    if (c.status === 'CANCELADO') throw new ErroNegocio('Este carregamento está cancelado.');

    // Quantidade final: peso liquido pesado, se informado
    let quantidadeKg = c.quantidade_kg;
    if (dados?.quantidade) {
      const conv = await paraKg(cx, dados.quantidade, dados.unidadeId || c.unidade_id);
      quantidadeKg = conv.kg;
    }

    const produto = await cx.query(
      'SELECT descricao, exige_fumigacao FROM produtos WHERE id = $1',
      [c.produto_id]
    );
    if (
      produto.rows[0]?.exige_fumigacao &&
      c.tipo_operacao === 'EXPORTACAO' &&
      !c.certificado_id
    )
      throw new ErroNegocio(
        `O produto ${produto.rows[0].descricao} exige certificado de fumigação para exportação. ` +
          'Vincule um certificado válido antes de confirmar a expedição.'
      );

    if (c.certificado_id) {
      const cert = await cx.query(
        'SELECT numero, status FROM certificados_fumigacao WHERE id = $1',
        [c.certificado_id]
      );
      if (cert.rows[0]?.status !== 'VALIDADO')
        throw new ErroNegocio(
          `O certificado ${cert.rows[0]?.numero} vinculado não está validado.`
        );
    }

    // Libera a reserva e da a baixa fisica (uma unica movimentacao de estoque)
    await estoque.consumirReserva(cx, 'CARREGAMENTO', id);

    const movId = await estoque.movimentar(cx, {
      tipo: 'CARREGAMENTO',
      produtoId: c.produto_id,
      localId: c.local_id,
      loteId: c.lote_id,
      quantidadeKg: `-${quantidadeKg}`,
      quantidadeOrigem: c.quantidade_origem,
      unidadeId: c.unidade_id,
      dataMovimento: dados?.data || c.data,
      documentoTipo: 'CARREGAMENTO',
      documentoId: id,
      documentoNumero: c.numero,
      observacoes: `Expedição para ${c.destino || 'destino não informado'}`,
      usuarioId: usuario.id,
    });

    const pesos = calcularPesos(dados || {});

    const { rows } = await cx.query(
      `UPDATE carregamentos SET
          status = 'EXPEDIDO',
          quantidade_kg = $1,
          data_hora_carga = COALESCE($2, data_hora_carga, now()),
          peso_bruto_kg = COALESCE($3, peso_bruto_kg),
          peso_tara_kg = COALESCE($4, peso_tara_kg),
          peso_liquido_kg = COALESCE($5, peso_liquido_kg),
          expedido_em = now(), expedido_por = $6, atualizado_por = $6
        WHERE id = $7
        RETURNING *`,
      [quantidadeKg, dados?.dataHoraCarga ?? null, pesos.bruto, pesos.tara, pesos.liquido, usuario.id, id]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.EXPEDIR,
      modulo: 'carregamento',
      registroTipo: 'CARREGAMENTO',
      registroId: id,
      registroNumero: c.numero,
      descricao:
        `Carregamento ${c.numero} expedido. Baixa de ${quantidadeKg} kg no estoque ` +
        `(movimento #${movId}).`,
      antes: { status: c.status, quantidade_kg: c.quantidade_kg },
      depois: { status: 'EXPEDIDO', quantidade_kg: quantidadeKg },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return rows[0];
  });
}

export async function cancelar(id, motivo, usuario, contexto = {}) {
  if (!motivo?.trim()) throw new ErroNegocio('Informe o motivo do cancelamento.');

  return transacao(async (cx) => {
    const c = await bloquear(cx, id);
    if (c.status === 'CANCELADO') throw new ErroNegocio('Este carregamento já está cancelado.');

    await estoque.liberarReserva(cx, 'CARREGAMENTO', id);

    // Se ja tinha saido do estoque, devolve a mercadoria por estorno
    if (c.status === 'EXPEDIDO') {
      const mov = await cx.query(
        `SELECT id, quantidade_kg FROM estoque_movimentos
          WHERE documento_tipo = 'CARREGAMENTO' AND documento_id = $1 AND tipo = 'CARREGAMENTO'
            AND id NOT IN (SELECT estorno_de_id FROM estoque_movimentos WHERE estorno_de_id IS NOT NULL)
          ORDER BY id`,
        [id]
      );
      for (const m of mov.rows) {
        await estoque.movimentar(cx, {
          tipo: 'ESTORNO',
          produtoId: c.produto_id,
          localId: c.local_id,
          loteId: c.lote_id,
          quantidadeKg: String(m.quantidade_kg).replace('-', ''),
          documentoTipo: 'CARREGAMENTO',
          documentoId: id,
          documentoNumero: c.numero,
          motivo,
          observacoes: `Estorno por cancelamento do carregamento ${c.numero}`,
          estornoDeId: m.id,
          usuarioId: usuario.id,
        });
      }
    }

    await cx.query(
      `UPDATE carregamentos
          SET status = 'CANCELADO', cancelado_em = now(), cancelado_por = $1,
              motivo_cancelamento = $2, atualizado_por = $1
        WHERE id = $3`,
      [usuario.id, motivo, id]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.CANCELAR,
      modulo: 'carregamento',
      registroTipo: 'CARREGAMENTO',
      registroId: id,
      registroNumero: c.numero,
      descricao: `Carregamento ${c.numero} cancelado. Motivo: ${motivo}`,
      antes: { status: c.status },
      depois: { status: 'CANCELADO' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { ok: true };
  });
}

export async function adicionarDocumento(carregamentoId, dados, usuario) {
  return transacao(async (cx) => {
    const { rows } = await cx.query(
      `INSERT INTO carregamento_documentos
          (carregamento_id, tipo, numero, data, observacoes, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [carregamentoId, dados.tipo, dados.numero ?? null, dados.data ?? null, dados.observacoes ?? null, usuario.id]
    );
    return rows[0];
  });
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

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

/**
 * Um certificado nao pode cobrir mais carga do que a quantidade certificada.
 * Impede que 100 t de certificado "cubram" 300 t de embarque.
 */
async function conferirCertificado(cx, dados, quantidadeKg, ignorarId) {
  if (!dados.certificadoId) return;

  const { rows } = await cx.query(
    `SELECT c.numero, c.quantidade_kg, c.status, c.produto_id,
            COALESCE((SELECT SUM(cg.quantidade_kg) FROM carregamentos cg
                       WHERE cg.certificado_id = c.id
                         AND cg.status <> 'CANCELADO'
                         AND ($2::BIGINT IS NULL OR cg.id <> $2)), 0) AS usado_kg
       FROM certificados_fumigacao c WHERE c.id = $1`,
    [dados.certificadoId, ignorarId ?? null]
  );
  const cert = rows[0];
  if (!cert) throw new ErroNaoEncontrado('Certificado de fumigação não encontrado.');
  if (cert.status === 'CANCELADO')
    throw new ErroNegocio(`O certificado ${cert.numero} está cancelado.`);
  if (Number(cert.produto_id) !== Number(dados.produtoId))
    throw new ErroNegocio(
      `O certificado ${cert.numero} é de outro produto e não pode ser vinculado a este carregamento.`
    );

  const disponivel = Decimal.de(cert.quantidade_kg, 3).menos(Decimal.de(cert.usado_kg, 3));
  if (Decimal.de(quantidadeKg, 3).maiorQue(disponivel))
    throw new ErroNegocio(
      `A quantidade excede o saldo do certificado ${cert.numero}. ` +
        `Certificado: ${Decimal.de(cert.quantidade_kg, 3).divididoPor('1000').paraSql(3)} t, ` +
        `já vinculado: ${Decimal.de(cert.usado_kg, 3).divididoPor('1000').paraSql(3)} t, ` +
        `disponível: ${disponivel.divididoPor('1000').paraSql(3)} t.`
    );
}

async function bloquear(cx, id) {
  const { rows } = await cx.query('SELECT * FROM carregamentos WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new ErroNaoEncontrado('Carregamento não encontrado.');
  return rows[0];
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const SELECT_BASE = `
  SELECT cg.*,
         cli.razao_social AS cliente,
         p.descricao AS produto, p.codigo AS produto_codigo,
         l.nome AS local, lt.codigo AS lote,
         v.placa AS veiculo_placa, v.marca_modelo AS veiculo_modelo,
         mo.nome AS motorista, mo.documento AS motorista_documento,
         tr.razao_social AS transportadora,
         pa.nome AS pais_destino, ic.codigo AS incoterm,
         un.codigo AS unidade, un.fator_kg,
         ce.numero AS certificado_numero, ce.numero_certificado AS certificado_externo,
         ce.status AS certificado_status,
         f.numero AS fumigacao_numero, f.numero_comunicado
    FROM carregamentos cg
    LEFT JOIN parceiros cli ON cli.id = cg.cliente_id
    JOIN produtos p         ON p.id = cg.produto_id
    JOIN locais_estoque l   ON l.id = cg.local_id
    LEFT JOIN lotes lt      ON lt.id = cg.lote_id
    LEFT JOIN veiculos v    ON v.id = cg.veiculo_id
    LEFT JOIN motoristas mo ON mo.id = cg.motorista_id
    LEFT JOIN parceiros tr  ON tr.id = cg.transportadora_id
    LEFT JOIN paises pa     ON pa.id = cg.pais_destino_id
    LEFT JOIN incoterms ic  ON ic.id = cg.incoterm_id
    LEFT JOIN unidades_medida un ON un.id = cg.unidade_id
    LEFT JOIN certificados_fumigacao ce ON ce.id = cg.certificado_id
    LEFT JOIN fumigacoes f  ON f.id = ce.fumigacao_id`;

export function listar(filtros = {}) {
  const cond = [];
  const params = [];
  if (filtros.status) {
    params.push(filtros.status);
    cond.push(`cg.status = $${params.length}`);
  }
  if (filtros.clienteId) {
    params.push(filtros.clienteId);
    cond.push(`cg.cliente_id = $${params.length}`);
  }
  if (filtros.produtoId) {
    params.push(filtros.produtoId);
    cond.push(`cg.produto_id = $${params.length}`);
  }
  if (filtros.de) {
    params.push(filtros.de);
    cond.push(`cg.data >= $${params.length}`);
  }
  if (filtros.ate) {
    params.push(filtros.ate);
    cond.push(`cg.data <= $${params.length}`);
  }
  if (filtros.busca) {
    params.push(`%${filtros.busca}%`);
    cond.push(
      `(cg.numero ILIKE $${params.length} OR cg.placa ILIKE $${params.length}
        OR cg.destino ILIKE $${params.length})`
    );
  }
  params.push(Number(filtros.limite || 200));

  return muitos(
    `${SELECT_BASE}
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY cg.id DESC
      LIMIT $${params.length}`,
    params
  );
}

export async function buscar(id) {
  const c = await um(`${SELECT_BASE} WHERE cg.id = $1`, [id]);
  if (!c) return null;
  c.documentos = await muitos(
    'SELECT * FROM carregamento_documentos WHERE carregamento_id = $1 ORDER BY id',
    [id]
  );
  c.movimentos = await muitos(
    `SELECT * FROM estoque_movimentos
      WHERE documento_tipo = 'CARREGAMENTO' AND documento_id = $1 ORDER BY id`,
    [id]
  );
  return c;
}

export const totaisPeriodo = (de, ate) =>
  um(
    `SELECT COUNT(*) FILTER (WHERE status = 'EXPEDIDO') AS expedidos,
            COALESCE(SUM(quantidade_kg) FILTER (WHERE status = 'EXPEDIDO'), 0) AS expedido_kg,
            COUNT(*) FILTER (WHERE status IN ('PROGRAMADO','EM_CARREGAMENTO')) AS em_aberto
       FROM carregamentos
      WHERE ($1::DATE IS NULL OR data >= $1) AND ($2::DATE IS NULL OR data <= $2)`,
    [de ?? null, ate ?? null]
  );

export default {
  criar,
  atualizar,
  programar,
  expedir,
  cancelar,
  adicionarDocumento,
  listar,
  buscar,
  totaisPeriodo,
};
