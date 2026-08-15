/**
 * Certificados de Fumigacao (secao 11).
 *
 * O certificado e o FATO GERADOR da obrigacao definitiva da fumigacao no
 * Financeiro. Ao validar um certificado, em UMA UNICA TRANSACAO (secao 28):
 *
 *   1. valida o saldo fumigado disponivel;
 *   2. registra/consolida o certificado;
 *   3. movimenta a conta-corrente de fumigacao (saida);
 *   4. gera automaticamente o titulo em Contas a Pagar;
 *   5. registra a auditoria.
 *
 * Se qualquer etapa falhar, nada e gravado.
 */
import { transacao, muitos, um } from '../db/index.js';
import { registrar, ACOES, diferenca } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { Decimal } from '../lib/decimal.js';
import { paraKg } from './unidades.js';
import { criarContaPagar } from './financeiro.js';
import { somarDias, hojeISO } from '../lib/formato.js';
import config from '../config.js';

/** valor_total = (quantidade_kg / 1000) * custo_tonelada */
export function calcularValor(quantidadeKg, custoTonelada) {
  const t = Decimal.de(quantidadeKg, 6).divididoPor('1000');
  return t.vezes(Decimal.de(custoTonelada || '0', 6)).paraSql(4);
}

export async function criar(dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const fum = await cx.query(
      `SELECT f.*, f.quantidade_kg - f.quantidade_certificada_kg AS saldo_kg
         FROM fumigacoes f WHERE f.id = $1`,
      [dados.fumigacaoId]
    );
    const fumigacao = fum.rows[0];
    if (!fumigacao) throw new ErroNaoEncontrado('Fumigação não encontrada.');
    if (fumigacao.status !== 'VALIDADA')
      throw new ErroNegocio(
        `A fumigação ${fumigacao.numero} ainda não está validada. ` +
          'Informe o Comunicado de Fumigação e valide antes de emitir o certificado.'
      );

    const conv = await paraKg(cx, dados.quantidade, dados.unidadeId);

    // Pre-checagem amigavel (a garantia real e a fn_fumigacao_consumir na validacao)
    if (Decimal.de(conv.kg, 3).maiorQue(fumigacao.saldo_kg))
      throw new ErroNegocio(
        `Saldo fumigado insuficiente na fumigação ${fumigacao.numero}. ` +
          `Disponível: ${Decimal.de(fumigacao.saldo_kg, 3).divididoPor('1000').paraSql(3)} t, ` +
          `solicitado: ${Decimal.de(conv.kg, 3).divididoPor('1000').paraSql(3)} t.`
      );

    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.CERTIFICADO);
    const custo = dados.custoTonelada ?? fumigacao.custo_tonelada ?? '0';
    const valorTotal = calcularValor(conv.kg, custo);
    const data = dados.data || hojeISO();
    const vencimento = dados.vencimento || somarDias(data, config.regras.diasVencimentoCertificado);

    const { rows } = await cx.query(
      `INSERT INTO certificados_fumigacao (
          numero, numero_certificado, fumigacao_id, fumigadora_id, produto_id,
          quantidade_kg, quantidade_origem, unidade_id, data,
          custo_tonelada, valor_total, moeda_id, vencimento,
          cliente_id, destino, observacoes, status, criado_por
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'RASCUNHO',$17)
       RETURNING *`,
      [
        numero,
        dados.numeroCertificado ?? null,
        fumigacao.id,
        fumigacao.fumigadora_id,
        fumigacao.produto_id,
        conv.kg,
        conv.origem,
        dados.unidadeId,
        data,
        custo,
        valorTotal,
        dados.moedaId ?? fumigacao.moeda_id,
        vencimento,
        dados.clienteId ?? null,
        dados.destino ?? null,
        dados.observacoes ?? null,
        usuario.id,
      ]
    );
    const certificado = rows[0];

    await registrar(cx, {
      usuario,
      acao: ACOES.CRIAR,
      modulo: 'certificados',
      registroTipo: 'CERTIFICADO_FUMIGACAO',
      registroId: certificado.id,
      registroNumero: numero,
      descricao:
        `Certificado ${numero} criado (rascunho) a partir da fumigação ${fumigacao.numero} ` +
        `com ${conv.kg} kg.`,
      depois: certificado,
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return certificado;
  });
}

export async function atualizar(id, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const atual = await bloquear(cx, id);
    if (atual.status !== 'RASCUNHO')
      throw new ErroNegocio(
        `O certificado ${atual.numero} já foi validado e não pode ser editado. ` +
          'Para corrigir, cancele-o e emita um novo certificado.'
      );

    const conv = await paraKg(cx, dados.quantidade, dados.unidadeId);
    const custo = dados.custoTonelada ?? atual.custo_tonelada ?? '0';
    const valorTotal = calcularValor(conv.kg, custo);
    const data = dados.data || atual.data;
    const vencimento =
      dados.vencimento || somarDias(data, config.regras.diasVencimentoCertificado);

    const { rows } = await cx.query(
      `UPDATE certificados_fumigacao SET
          numero_certificado = $1, quantidade_kg = $2, quantidade_origem = $3,
          unidade_id = $4, data = $5, custo_tonelada = $6, valor_total = $7,
          moeda_id = $8, vencimento = $9, cliente_id = $10, destino = $11,
          observacoes = $12, atualizado_por = $13
        WHERE id = $14
        RETURNING *`,
      [
        dados.numeroCertificado ?? null,
        conv.kg,
        conv.origem,
        dados.unidadeId,
        data,
        custo,
        valorTotal,
        dados.moedaId ?? atual.moeda_id,
        vencimento,
        dados.clienteId ?? null,
        dados.destino ?? null,
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
        modulo: 'certificados',
        registroTipo: 'CERTIFICADO_FUMIGACAO',
        registroId: id,
        registroNumero: atual.numero,
        descricao: `Certificado ${atual.numero} alterado.`,
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
 * VALIDACAO DO CERTIFICADO - o ponto de integracao mais importante do ERP.
 */
export async function validar(id, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const cert = await bloquear(cx, id);

    if (cert.status === 'VALIDADO') throw new ErroNegocio('Este certificado já está validado.');
    if (cert.status === 'CANCELADO') throw new ErroNegocio('Este certificado está cancelado.');
    if (cert.conta_pagar_id)
      throw new ErroNegocio('Este certificado já possui um título financeiro vinculado.');

    if (!cert.numero_certificado?.trim())
      throw new ErroNegocio(
        'Informe o número do certificado emitido pela empresa fumigadora antes de validar.'
      );

    // 1 + 3. Valida saldo e movimenta a conta-corrente de fumigacao.
    //        A funcao bloqueia a fumigacao e recusa quantidade acima do saldo.
    const { rows: saldoRows } = await cx.query(
      `SELECT fn_fumigacao_consumir($1,$2,$3,$4,$5,$6,$7) AS saldo`,
      [
        cert.fumigacao_id,
        cert.quantidade_kg,
        'CERTIFICADO_FUMIGACAO',
        cert.id,
        cert.numero,
        usuario.id,
        `Certificado ${cert.numero} (${cert.numero_certificado})`,
      ]
    );
    const saldoRestante = saldoRows[0].saldo;

    // 4. Gera o titulo em Contas a Pagar.
    const fum = await cx.query('SELECT numero FROM fumigacoes WHERE id = $1', [cert.fumigacao_id]);
    const categoria = await cx.query(
      `SELECT id FROM categorias_financeiras WHERE codigo = 'FUMIGACAO' LIMIT 1`
    );

    let contaPagar = null;
    if (Decimal.de(cert.valor_total, 4).ehPositivo()) {
      contaPagar = await criarContaPagar(
        cx,
        {
          descricao: `Fumigação - Certificado ${cert.numero_certificado || cert.numero} (${fum.rows[0].numero})`,
          origem: 'FUMIGACAO',
          origemTipo: 'CERTIFICADO_FUMIGACAO',
          origemId: cert.id,
          origemNumero: cert.numero,
          parceiroId: cert.fumigadora_id,
          categoriaId: categoria.rows[0]?.id ?? null,
          emissao: cert.data,
          vencimento: cert.vencimento || somarDias(cert.data, config.regras.diasVencimentoCertificado),
          competencia: cert.data,
          valor: cert.valor_total,
          moedaId: cert.moeda_id,
          observacoes:
            `Gerado automaticamente pela validação do Certificado de Fumigação ${cert.numero}. ` +
            `Quantidade: ${Decimal.de(cert.quantidade_kg, 3).divididoPor('1000').paraSql(3)} t ` +
            `x ${cert.custo_tonelada}/t.`,
        },
        usuario
      );
    }

    // 2. Consolida o certificado.
    const { rows } = await cx.query(
      `UPDATE certificados_fumigacao
          SET status = 'VALIDADO', validado_em = now(), validado_por = $1,
              conta_pagar_id = $2, atualizado_por = $1
        WHERE id = $3
        RETURNING *`,
      [usuario.id, contaPagar?.id ?? null, id]
    );

    // 5. Auditoria.
    await registrar(cx, {
      usuario,
      acao: ACOES.VALIDAR,
      modulo: 'certificados',
      registroTipo: 'CERTIFICADO_FUMIGACAO',
      registroId: id,
      registroNumero: cert.numero,
      descricao:
        `Certificado ${cert.numero} validado. Consumidos ${cert.quantidade_kg} kg da fumigação ` +
        `${fum.rows[0].numero}; saldo fumigado restante: ${saldoRestante} kg.` +
        (contaPagar ? ` Contas a Pagar ${contaPagar.numero} gerado no valor de ${contaPagar.valor}.` : ''),
      antes: { status: cert.status },
      depois: { status: 'VALIDADO', conta_pagar_id: contaPagar?.id ?? null },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { certificado: rows[0], contaPagar, saldoRestante };
  });
}

/**
 * Cancelamento: devolve o saldo fumigado e cancela o titulo financeiro.
 * O certificado permanece no historico com o motivo do cancelamento.
 */
export async function cancelar(id, motivo, usuario, contexto = {}) {
  if (!motivo?.trim()) throw new ErroNegocio('Informe o motivo do cancelamento.');

  return transacao(async (cx) => {
    const cert = await bloquear(cx, id);
    if (cert.status === 'CANCELADO') throw new ErroNegocio('Este certificado já está cancelado.');

    const carregamentos = await cx.query(
      `SELECT numero FROM carregamentos
        WHERE certificado_id = $1 AND status NOT IN ('CANCELADO','RASCUNHO')`,
      [id]
    );
    if (carregamentos.rowCount)
      throw new ErroNegocio(
        `Este certificado está vinculado ao(s) carregamento(s) ` +
          `${carregamentos.rows.map((c) => c.numero).join(', ')}. ` +
          'Cancele o carregamento antes de cancelar o certificado.'
      );

    if (cert.status === 'VALIDADO') {
      // Devolve o saldo para a conta-corrente de fumigacao
      await cx.query('SELECT fn_fumigacao_devolver($1,$2,$3,$4,$5,$6,$7)', [
        cert.fumigacao_id,
        cert.quantidade_kg,
        'CERTIFICADO_FUMIGACAO',
        cert.id,
        cert.numero,
        usuario.id,
        `Cancelamento do certificado ${cert.numero}: ${motivo}`,
      ]);

      if (cert.conta_pagar_id) {
        const cp = await cx.query(
          'SELECT * FROM contas_pagar WHERE id = $1 FOR UPDATE',
          [cert.conta_pagar_id]
        );
        if (cp.rows[0] && Number(cp.rows[0].valor_pago) > 0)
          throw new ErroNegocio(
            `O título ${cp.rows[0].numero} gerado por este certificado já possui pagamento. ` +
              'Estorne o pagamento antes de cancelar o certificado.'
          );

        await cx.query(
          `UPDATE contas_pagar
              SET status = 'CANCELADO',
                  motivo_cancelamento = $1,
                  atualizado_por = $2
            WHERE id = $3 AND status <> 'CANCELADO'`,
          [`Certificado ${cert.numero} cancelado: ${motivo}`, usuario.id, cert.conta_pagar_id]
        );
      }
    }

    await cx.query(
      `UPDATE certificados_fumigacao
          SET status = 'CANCELADO', cancelado_em = now(), cancelado_por = $1,
              motivo_cancelamento = $2, atualizado_por = $1
        WHERE id = $3`,
      [usuario.id, motivo, id]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.CANCELAR,
      modulo: 'certificados',
      registroTipo: 'CERTIFICADO_FUMIGACAO',
      registroId: id,
      registroNumero: cert.numero,
      descricao:
        `Certificado ${cert.numero} cancelado. Motivo: ${motivo}. ` +
        `Saldo de ${cert.quantidade_kg} kg devolvido à fumigação.`,
      antes: { status: cert.status },
      depois: { status: 'CANCELADO' },
      ip: contexto.ip,
      sessao: contexto.sessao,
    });

    return { ok: true };
  });
}

async function bloquear(cx, id) {
  const { rows } = await cx.query('SELECT * FROM certificados_fumigacao WHERE id = $1 FOR UPDATE', [
    id,
  ]);
  if (!rows[0]) throw new ErroNaoEncontrado('Certificado não encontrado.');
  return rows[0];
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const SELECT_BASE = `
  SELECT c.*,
         f.numero AS fumigacao_numero, f.numero_comunicado,
         f.quantidade_kg - f.quantidade_certificada_kg AS fumigacao_saldo_kg,
         pf.razao_social AS fumigadora,
         cli.razao_social AS cliente,
         p.descricao AS produto, p.codigo AS produto_codigo,
         un.codigo AS unidade, un.fator_kg,
         m.codigo AS moeda, m.simbolo AS moeda_simbolo,
         cp.numero AS conta_pagar_numero, cp.status AS conta_pagar_status,
         cp.vencimento AS conta_pagar_vencimento, cp.valor AS conta_pagar_valor,
         uv.nome AS validado_por_nome
    FROM certificados_fumigacao c
    JOIN fumigacoes f      ON f.id = c.fumigacao_id
    JOIN parceiros pf      ON pf.id = c.fumigadora_id
    LEFT JOIN parceiros cli ON cli.id = c.cliente_id
    JOIN produtos p        ON p.id = c.produto_id
    LEFT JOIN unidades_medida un ON un.id = c.unidade_id
    JOIN moedas m          ON m.id = c.moeda_id
    LEFT JOIN contas_pagar cp ON cp.id = c.conta_pagar_id
    LEFT JOIN usuarios uv  ON uv.id = c.validado_por`;

export function listar(filtros = {}) {
  const cond = [];
  const params = [];
  if (filtros.status) {
    params.push(filtros.status);
    cond.push(`c.status = $${params.length}`);
  }
  if (filtros.fumigacaoId) {
    params.push(filtros.fumigacaoId);
    cond.push(`c.fumigacao_id = $${params.length}`);
  }
  if (filtros.de) {
    params.push(filtros.de);
    cond.push(`c.data >= $${params.length}`);
  }
  if (filtros.ate) {
    params.push(filtros.ate);
    cond.push(`c.data <= $${params.length}`);
  }
  if (filtros.busca) {
    params.push(`%${filtros.busca}%`);
    cond.push(
      `(c.numero ILIKE $${params.length} OR c.numero_certificado ILIKE $${params.length}
        OR f.numero ILIKE $${params.length} OR f.numero_comunicado ILIKE $${params.length})`
    );
  }
  params.push(Number(filtros.limite || 200));

  return muitos(
    `${SELECT_BASE}
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY c.id DESC
      LIMIT $${params.length}`,
    params
  );
}

export async function buscar(id) {
  const c = await um(`${SELECT_BASE} WHERE c.id = $1`, [id]);
  if (!c) return null;
  c.carregamentos = await muitos(
    `SELECT id, numero, status, quantidade_kg, destino, data
       FROM carregamentos WHERE certificado_id = $1 ORDER BY id`,
    [id]
  );
  return c;
}

/** Certificados validados ainda nao vinculados a carregamento. */
export const disponiveis = (produtoId = null) =>
  muitos(
    `${SELECT_BASE}
      WHERE c.status = 'VALIDADO'
        ${produtoId ? 'AND c.produto_id = $1' : ''}
      ORDER BY c.data DESC, c.id DESC`,
    produtoId ? [produtoId] : []
  );

export default { criar, atualizar, validar, cancelar, listar, buscar, disponiveis, calcularValor };
