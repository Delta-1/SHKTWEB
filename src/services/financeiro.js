/**
 * Servico Financeiro (secao 14).
 *
 * Regra de integracao: todo titulo gerado automaticamente guarda
 * origem_tipo + origem_id + origem_numero, permitindo navegar do titulo ate o
 * documento que o originou e vice-versa. O indice unico uq_cp_origem impede,
 * no proprio banco, que a mesma origem gere dois titulos.
 */
import { transacao, muitos, um } from '../db/index.js';
import { registrar, ACOES } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { Decimal } from '../lib/decimal.js';

// ---------------------------------------------------------------------------
// Criacao de titulos (chamadas de dentro de outras transacoes)
// ---------------------------------------------------------------------------

/**
 * Cria um titulo em Contas a Pagar dentro de uma transacao aberta.
 * @param {import('pg').PoolClient} cx
 */
export async function criarContaPagar(cx, dados, usuario) {
  const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.CONTA_PAGAR);

  const { rows } = await cx.query(
    `INSERT INTO contas_pagar (
        numero, descricao, origem, origem_tipo, origem_id, origem_numero,
        parceiro_id, funcionario_id, beneficiario, categoria_id, centro_custo_id,
        emissao, vencimento, competencia, valor, moeda_id, documento_fiscal,
        observacoes, criado_por
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               COALESCE($12, CURRENT_DATE),$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      numero,
      dados.descricao,
      dados.origem || 'MANUAL',
      dados.origemTipo ?? null,
      dados.origemId ?? null,
      dados.origemNumero ?? null,
      dados.parceiroId ?? null,
      dados.funcionarioId ?? null,
      dados.beneficiario ?? null,
      dados.categoriaId ?? null,
      dados.centroCustoId ?? null,
      dados.emissao ?? null,
      dados.vencimento,
      dados.competencia ?? null,
      dados.valor,
      dados.moedaId,
      dados.documentoFiscal ?? null,
      dados.observacoes ?? null,
      usuario?.id ?? null,
    ]
  );

  await auditarTitulo(cx, 'CP', rows[0], usuario);
  return rows[0];
}

/** Cria um titulo em Contas a Receber dentro de uma transacao aberta. */
export async function criarContaReceber(cx, dados, usuario) {
  const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.CONTA_RECEBER);

  const { rows } = await cx.query(
    `INSERT INTO contas_receber (
        numero, descricao, origem, origem_tipo, origem_id, origem_numero,
        parceiro_id, pagador, categoria_id, centro_custo_id,
        emissao, vencimento, competencia, valor, moeda_id, documento_fiscal,
        observacoes, criado_por
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               COALESCE($11, CURRENT_DATE),$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      numero,
      dados.descricao,
      dados.origem || 'MANUAL',
      dados.origemTipo ?? null,
      dados.origemId ?? null,
      dados.origemNumero ?? null,
      dados.parceiroId ?? null,
      dados.pagador ?? null,
      dados.categoriaId ?? null,
      dados.centroCustoId ?? null,
      dados.emissao ?? null,
      dados.vencimento,
      dados.competencia ?? null,
      dados.valor,
      dados.moedaId,
      dados.documentoFiscal ?? null,
      dados.observacoes ?? null,
      usuario?.id ?? null,
    ]
  );

  await auditarTitulo(cx, 'CR', rows[0], usuario);
  return rows[0];
}

/**
 * Audita a criacao de qualquer titulo, seja ele digitado na tela ou gerado
 * automaticamente por outro modulo (fumigacao, RH, manutencao...). Fica aqui,
 * na origem, para que nenhum caminho de criacao escape da auditoria.
 */
async function auditarTitulo(cx, tipo, titulo, usuario) {
  const nomeTipo = tipo === 'CP' ? 'Contas a Pagar' : 'Contas a Receber';
  const automatico = titulo.origem !== 'MANUAL';

  await registrar(cx, {
    usuario,
    acao: ACOES.CRIAR,
    modulo: 'financeiro',
    registroTipo: tipo === 'CP' ? 'CONTA_PAGAR' : 'CONTA_RECEBER',
    registroId: titulo.id,
    registroNumero: titulo.numero,
    descricao:
      `${nomeTipo} ${titulo.numero}: ${titulo.descricao} — ${titulo.valor}` +
      (automatico
        ? ` (gerado automaticamente por ${titulo.origem_tipo || titulo.origem} ${titulo.origem_numero || ''})`.trimEnd()
        : ''),
    depois: titulo,
  });
}

/** Versao autonoma (abre a propria transacao) usada pelas telas manuais. */
export async function criarTituloManual(tipo, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const titulo =
      tipo === 'CP'
        ? await criarContaPagar(cx, dados, usuario)
        : await criarContaReceber(cx, dados, usuario);
    return titulo;
  });
}

// ---------------------------------------------------------------------------
// Baixas (pagamento / recebimento) - permite baixa parcial
// ---------------------------------------------------------------------------

export async function baixar(tipo, tituloId, dados, usuario, contexto = {}) {
  const tabela = tipo === 'CP' ? 'contas_pagar' : 'contas_receber';
  const campoLiquidado = tipo === 'CP' ? 'valor_pago' : 'valor_recebido';
  const campoData = tipo === 'CP' ? 'data_pagamento' : 'data_recebimento';
  const statusFinal = tipo === 'CP' ? 'PAGO' : 'RECEBIDO';

  return transacao(async (cx) => {
    // Bloqueia o titulo: duas baixas simultaneas nao podem ultrapassar o saldo
    const { rows } = await cx.query(`SELECT * FROM ${tabela} WHERE id = $1 FOR UPDATE`, [tituloId]);
    const titulo = rows[0];
    if (!titulo) throw new ErroNaoEncontrado('Título não encontrado.');
    if (titulo.status === 'CANCELADO')
      throw new ErroNegocio('Este título está cancelado e não pode receber baixa.');
    if (titulo.status === statusFinal)
      throw new ErroNegocio(`Este título já está ${statusFinal === 'PAGO' ? 'pago' : 'recebido'}.`);

    const valorTitulo = Decimal.de(titulo.valor, 4);
    const jaLiquidado = Decimal.de(titulo[campoLiquidado], 4) || Decimal.zero(4);
    const saldo = valorTitulo.menos(jaLiquidado);
    const valorBaixa = Decimal.de(dados.valor, 4);

    if (!valorBaixa || !valorBaixa.ehPositivo())
      throw new ErroNegocio('O valor da baixa deve ser maior que zero.');
    if (valorBaixa.maiorQue(saldo))
      throw new ErroNegocio(
        `O valor da baixa (${valorBaixa.paraSql(2)}) é maior que o saldo do título (${saldo.paraSql(2)}).`
      );

    const desconto = Decimal.de(dados.desconto || '0', 4);
    const juros = Decimal.de(dados.juros || '0', 4);

    const baixa = await cx.query(
      `INSERT INTO financeiro_baixas (
          titulo_tipo, conta_pagar_id, conta_receber_id, data, valor, juros, desconto,
          conta_bancaria_id, forma_pagamento_id, observacoes, criado_por
       ) VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        tipo,
        tipo === 'CP' ? tituloId : null,
        tipo === 'CR' ? tituloId : null,
        dados.data ?? null,
        valorBaixa.paraSql(4),
        juros.paraSql(4),
        desconto.paraSql(4),
        dados.contaBancariaId,
        dados.formaPagamentoId ?? null,
        dados.observacoes ?? null,
        usuario.id,
      ]
    );

    const novoLiquidado = jaLiquidado.mais(valorBaixa);
    const quitado = novoLiquidado.compara(valorTitulo) >= 0;

    await cx.query(
      `UPDATE ${tabela}
          SET ${campoLiquidado} = $1,
              ${campoData} = $2,
              status = $3,
              atualizado_por = $4
        WHERE id = $5`,
      [
        novoLiquidado.paraSql(4),
        quitado ? baixa.rows[0].data : titulo[campoData],
        quitado ? statusFinal : 'PARCIAL',
        usuario.id,
        tituloId,
      ]
    );

    // Movimento de caixa: saida para CP, entrada para CR
    const valorCaixa = valorBaixa.mais(juros).menos(desconto);
    await cx.query(
      `INSERT INTO caixa_movimentos (
          conta_bancaria_id, data, tipo, valor, historico,
          origem_tipo, origem_id, baixa_id, criado_por
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        dados.contaBancariaId,
        baixa.rows[0].data,
        tipo === 'CP' ? 'SAIDA' : 'ENTRADA',
        valorCaixa.paraSql(4),
        `${tipo === 'CP' ? 'Pagamento' : 'Recebimento'} ${titulo.numero} - ${titulo.descricao}`,
        tipo === 'CP' ? 'CONTA_PAGAR' : 'CONTA_RECEBER',
        tituloId,
        baixa.rows[0].id,
        usuario.id,
      ]
    );

    await registrar(cx, {
      usuario,
      acao: tipo === 'CP' ? ACOES.PAGAR : ACOES.RECEBER,
      modulo: 'financeiro',
      registroTipo: tipo === 'CP' ? 'CONTA_PAGAR' : 'CONTA_RECEBER',
      registroId: tituloId,
      registroNumero: titulo.numero,
      descricao: `Baixa de ${valorBaixa.paraSql(2)} no título ${titulo.numero}.`,
      antes: { status: titulo.status, liquidado: jaLiquidado.paraSql(2) },
      depois: { status: quitado ? statusFinal : 'PARCIAL', liquidado: novoLiquidado.paraSql(2) },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return baixa.rows[0];
  });
}

/** Estorna uma baixa, devolvendo o saldo do titulo e o movimento de caixa. */
export async function estornarBaixa(baixaId, motivo, usuario, contexto = {}) {
  if (!motivo?.trim()) throw new ErroNegocio('Informe o motivo do estorno.');

  return transacao(async (cx) => {
    const { rows } = await cx.query('SELECT * FROM financeiro_baixas WHERE id = $1 FOR UPDATE', [
      baixaId,
    ]);
    const baixa = rows[0];
    if (!baixa) throw new ErroNaoEncontrado('Baixa não encontrada.');
    if (baixa.estornada) throw new ErroNegocio('Esta baixa já foi estornada.');

    const tipo = baixa.titulo_tipo;
    const tabela = tipo === 'CP' ? 'contas_pagar' : 'contas_receber';
    const campoLiquidado = tipo === 'CP' ? 'valor_pago' : 'valor_recebido';
    const tituloId = tipo === 'CP' ? baixa.conta_pagar_id : baixa.conta_receber_id;

    const t = await cx.query(`SELECT * FROM ${tabela} WHERE id = $1 FOR UPDATE`, [tituloId]);
    const titulo = t.rows[0];

    const liquidado = Decimal.de(titulo[campoLiquidado], 4).menos(Decimal.de(baixa.valor, 4));

    await cx.query(
      `UPDATE ${tabela}
          SET ${campoLiquidado} = $1,
              status = CASE WHEN $1::NUMERIC = 0 THEN 'ABERTO' ELSE 'PARCIAL' END,
              ${tipo === 'CP' ? 'data_pagamento' : 'data_recebimento'} = NULL,
              atualizado_por = $2
        WHERE id = $3`,
      [liquidado.paraSql(4), usuario.id, tituloId]
    );

    await cx.query(
      `UPDATE financeiro_baixas
          SET estornada = TRUE, estornada_em = now(), estornada_por = $1, motivo_estorno = $2
        WHERE id = $3`,
      [usuario.id, motivo, baixaId]
    );

    await cx.query('UPDATE caixa_movimentos SET estornado = TRUE WHERE baixa_id = $1', [baixaId]);

    await registrar(cx, {
      usuario,
      acao: ACOES.ESTORNAR,
      modulo: 'financeiro',
      registroTipo: tipo === 'CP' ? 'CONTA_PAGAR' : 'CONTA_RECEBER',
      registroId: tituloId,
      registroNumero: titulo.numero,
      descricao: `Estorno da baixa #${baixaId} (${baixa.valor}). Motivo: ${motivo}`,
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { ok: true };
  });
}

/** Cancela um titulo (nunca exclui). */
export async function cancelarTitulo(tipo, tituloId, motivo, usuario, contexto = {}) {
  if (!motivo?.trim()) throw new ErroNegocio('Informe o motivo do cancelamento.');
  const tabela = tipo === 'CP' ? 'contas_pagar' : 'contas_receber';
  const campoLiquidado = tipo === 'CP' ? 'valor_pago' : 'valor_recebido';

  return transacao(async (cx) => {
    const { rows } = await cx.query(`SELECT * FROM ${tabela} WHERE id = $1 FOR UPDATE`, [tituloId]);
    const titulo = rows[0];
    if (!titulo) throw new ErroNaoEncontrado('Título não encontrado.');
    if (titulo.status === 'CANCELADO') throw new ErroNegocio('Este título já está cancelado.');
    if (Number(titulo[campoLiquidado]) > 0)
      throw new ErroNegocio(
        'Este título já possui baixas. Estorne as baixas antes de cancelar o título.'
      );

    await cx.query(
      `UPDATE ${tabela}
          SET status = 'CANCELADO', motivo_cancelamento = $1, atualizado_por = $2
        WHERE id = $3`,
      [motivo, usuario.id, tituloId]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.CANCELAR,
      modulo: 'financeiro',
      registroTipo: tipo === 'CP' ? 'CONTA_PAGAR' : 'CONTA_RECEBER',
      registroId: tituloId,
      registroNumero: titulo.numero,
      descricao: `Cancelamento do título ${titulo.numero}. Motivo: ${motivo}`,
      antes: { status: titulo.status },
      depois: { status: 'CANCELADO' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { ok: true };
  });
}

/** Transferencia entre contas proprias. */
export async function transferirEntreContas(dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.TRANSFERENCIA);
    const { rows } = await cx.query(
      `INSERT INTO caixa_transferencias
          (numero, data, conta_origem_id, conta_destino_id, valor, observacoes, criado_por)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        numero,
        dados.data ?? null,
        dados.contaOrigemId,
        dados.contaDestinoId,
        dados.valor,
        dados.observacoes ?? null,
        usuario.id,
      ]
    );
    const transf = rows[0];

    await cx.query(
      `INSERT INTO caixa_movimentos
          (conta_bancaria_id, data, tipo, valor, historico, origem_tipo, origem_id, transferencia_id, criado_por)
       VALUES ($1,$2,'SAIDA',$3,$4,'TRANSFERENCIA',$5,$5,$6),
              ($7,$2,'ENTRADA',$3,$8,'TRANSFERENCIA',$5,$5,$6)`,
      [
        dados.contaOrigemId,
        transf.data,
        dados.valor,
        `Transferência ${numero} (saída)`,
        transf.id,
        usuario.id,
        dados.contaDestinoId,
        `Transferência ${numero} (entrada)`,
      ]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.CRIAR,
      modulo: 'financeiro',
      registroTipo: 'TRANSFERENCIA',
      registroId: transf.id,
      registroNumero: numero,
      descricao: `Transferência entre contas: ${dados.valor}`,
      depois: transf,
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return transf;
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export function listarTitulos(tipo, filtros = {}) {
  const tabela = tipo === 'CP' ? 'contas_pagar' : 'contas_receber';
  const campoLiquidado = tipo === 'CP' ? 'valor_pago' : 'valor_recebido';
  const cond = [];
  const params = [];

  if (filtros.status) {
    params.push(filtros.status);
    cond.push(`t.status = $${params.length}`);
  } else if (!filtros.incluirCancelados) {
    cond.push(`t.status <> 'CANCELADO'`);
  }
  if (filtros.parceiroId) {
    params.push(filtros.parceiroId);
    cond.push(`t.parceiro_id = $${params.length}`);
  }
  if (filtros.de) {
    params.push(filtros.de);
    cond.push(`t.vencimento >= $${params.length}`);
  }
  if (filtros.ate) {
    params.push(filtros.ate);
    cond.push(`t.vencimento <= $${params.length}`);
  }
  if (filtros.busca) {
    params.push(`%${filtros.busca}%`);
    cond.push(`(t.numero ILIKE $${params.length} OR t.descricao ILIKE $${params.length}
                OR t.origem_numero ILIKE $${params.length})`);
  }
  if (filtros.vencidos) {
    cond.push(`t.vencimento < CURRENT_DATE AND t.status IN ('ABERTO','PARCIAL')`);
  }
  params.push(Number(filtros.limite || 300));

  return muitos(
    `SELECT t.*, t.valor - t.${campoLiquidado} AS saldo,
            p.razao_social AS parceiro, m.codigo AS moeda, m.simbolo AS moeda_simbolo,
            cat.nome AS categoria, cc.nome AS centro_custo,
            (t.vencimento < CURRENT_DATE AND t.status IN ('ABERTO','PARCIAL')) AS vencido
       FROM ${tabela} t
       LEFT JOIN parceiros p ON p.id = t.parceiro_id
       JOIN moedas m ON m.id = t.moeda_id
       LEFT JOIN categorias_financeiras cat ON cat.id = t.categoria_id
       LEFT JOIN centros_custo cc ON cc.id = t.centro_custo_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY t.vencimento, t.numero
      LIMIT $${params.length}`,
    params
  );
}

export async function buscarTitulo(tipo, id) {
  const tabela = tipo === 'CP' ? 'contas_pagar' : 'contas_receber';
  const campoLiquidado = tipo === 'CP' ? 'valor_pago' : 'valor_recebido';
  const titulo = await um(
    `SELECT t.*, t.valor - t.${campoLiquidado} AS saldo,
            p.razao_social AS parceiro, m.codigo AS moeda, m.simbolo AS moeda_simbolo,
            cat.nome AS categoria, cc.nome AS centro_custo, f.nome AS funcionario
       FROM ${tabela} t
       LEFT JOIN parceiros p ON p.id = t.parceiro_id
       JOIN moedas m ON m.id = t.moeda_id
       LEFT JOIN categorias_financeiras cat ON cat.id = t.categoria_id
       LEFT JOIN centros_custo cc ON cc.id = t.centro_custo_id
       ${tipo === 'CP' ? 'LEFT JOIN funcionarios f ON f.id = t.funcionario_id' : 'LEFT JOIN funcionarios f ON FALSE'}
      WHERE t.id = $1`,
    [id]
  );
  if (!titulo) return null;

  titulo.baixas = await muitos(
    `SELECT b.*, cb.nome AS conta_bancaria, fp.nome AS forma_pagamento, u.nome AS usuario
       FROM financeiro_baixas b
       JOIN contas_bancarias cb ON cb.id = b.conta_bancaria_id
       LEFT JOIN formas_pagamento fp ON fp.id = b.forma_pagamento_id
       LEFT JOIN usuarios u ON u.id = b.criado_por
      WHERE b.${tipo === 'CP' ? 'conta_pagar_id' : 'conta_receber_id'} = $1
      ORDER BY b.data, b.id`,
    [id]
  );

  return titulo;
}

export const saldosContas = () =>
  muitos('SELECT * FROM vw_contas_saldos WHERE ativo ORDER BY tipo DESC, nome');

export function extratoConta(contaId, filtros = {}) {
  const params = [contaId];
  const cond = ['cm.conta_bancaria_id = $1', 'NOT cm.estornado'];
  if (filtros.de) {
    params.push(filtros.de);
    cond.push(`cm.data >= $${params.length}`);
  }
  if (filtros.ate) {
    params.push(filtros.ate);
    cond.push(`cm.data <= $${params.length}`);
  }
  return muitos(
    `SELECT cm.*, u.nome AS usuario
       FROM caixa_movimentos cm
       LEFT JOIN usuarios u ON u.id = cm.criado_por
      WHERE ${cond.join(' AND ')}
      ORDER BY cm.data DESC, cm.id DESC
      LIMIT 500`,
    params
  );
}

export default {
  criarContaPagar,
  criarContaReceber,
  criarTituloManual,
  baixar,
  estornarBaixa,
  cancelarTitulo,
  transferirEntreContas,
  listarTitulos,
  buscarTitulo,
  saldosContas,
  extratoConta,
};
