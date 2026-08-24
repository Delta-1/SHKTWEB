/**
 * Caixa operacional.
 *
 * O caixa nao substitui Contas a Pagar/Receber nem o extrato bancario. Ele e
 * um turno de conferencia: a baixa financeira cria o movimento uma vez e,
 * quando a conta escolhida e do tipo CAIXA, recebe o caixa aberto na mesma
 * transacao. Se ainda nao houver turno, a primeira baixa o abre com saldo 0.
 */
import { transacao, muitos, um, pool } from '../db/index.js';
import { registrar, ACOES } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { Decimal } from '../lib/decimal.js';

const zero = () => Decimal.zero(4);
const dinheiro = (valor) => Decimal.de(valor ?? '0', 4) || zero();

/** Totais exatos usados na tela e nos testes, sem somar valores com Number. */
export function resumirMovimentos(saldoInicial, movimentos = []) {
  let entradas = zero();
  let saidas = zero();
  let recebido = zero();
  let pago = zero();
  let suprimentos = zero();
  let sangrias = zero();

  for (const movimento of movimentos) {
    if (movimento.estornado) continue;
    const valor = dinheiro(movimento.valor);
    if (movimento.tipo === 'ENTRADA') entradas = entradas.mais(valor);
    else saidas = saidas.mais(valor);
    if (movimento.origem_tipo === 'CONTA_RECEBER' && movimento.tipo === 'ENTRADA')
      recebido = recebido.mais(valor);
    if (movimento.origem_tipo === 'CONTA_PAGAR' && movimento.tipo === 'SAIDA')
      pago = pago.mais(valor);
    if (movimento.origem_tipo === 'SUPRIMENTO') suprimentos = suprimentos.mais(valor);
    if (movimento.origem_tipo === 'SANGRIA') sangrias = sangrias.mais(valor);
  }

  const inicial = dinheiro(saldoInicial);
  return {
    saldoInicial: inicial.paraSql(4),
    entradas: entradas.paraSql(4),
    saidas: saidas.paraSql(4),
    recebido: recebido.paraSql(4),
    pago: pago.paraSql(4),
    suprimentos: suprimentos.paraSql(4),
    sangrias: sangrias.paraSql(4),
    saldoFinal: inicial.mais(entradas).menos(saidas).paraSql(4),
  };
}

export function totalizarConferencias(linhas = []) {
  let sistema = zero();
  let informado = zero();
  for (const linha of linhas) {
    sistema = sistema.mais(dinheiro(linha.valorSistema ?? linha.valor_sistema));
    informado = informado.mais(dinheiro(linha.valorInformado ?? linha.valor_informado));
  }
  return {
    sistema: sistema.paraSql(4),
    informado: informado.paraSql(4),
    diferenca: informado.menos(sistema).paraSql(4),
  };
}

async function contaCaixaEm(cx, contaId) {
  const { rows } = await cx.query(
    `SELECT cb.id,cb.nome,cb.tipo,cb.moeda_id,m.codigo AS moeda,m.simbolo
       FROM contas_bancarias cb JOIN moedas m ON m.id=cb.moeda_id
      WHERE cb.id=$1 AND cb.ativo FOR UPDATE OF cb`,
    [contaId]
  );
  const conta = rows[0];
  if (!conta) throw new ErroNegocio('A conta de caixa não existe ou está inativa.');
  if (conta.tipo !== 'CAIXA') throw new ErroNegocio('Escolha uma conta cadastrada como Caixa.');
  return conta;
}

async function formaDinheiroEm(cx) {
  const { rows } = await cx.query(
    `SELECT id FROM formas_pagamento WHERE codigo='DINHEIRO' AND ativo LIMIT 1`
  );
  if (!rows[0]) throw new ErroNegocio('Cadastre e ative a forma de pagamento Dinheiro.');
  return rows[0].id;
}

export async function formaCaixaEmTransacao(cx, formaPagamentoId) {
  if (!formaPagamentoId) return formaDinheiroEm(cx);
  const { rows } = await cx.query(
    'SELECT id FROM formas_pagamento WHERE id=$1 AND ativo',
    [formaPagamentoId]
  );
  if (!rows[0]) throw new ErroNegocio('A forma de pagamento não existe ou está inativa.');
  return rows[0].id;
}

async function criarCaixaEm(cx, dados, usuario, contexto = {}) {
  const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.CAIXA);
  const { rows } = await cx.query(
    `INSERT INTO caixas (
        numero,conta_bancaria_id,operacao_id,saldo_inicial,abertura_por,
        abertura_automatica,observacoes_abertura
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      numero,
      dados.contaBancariaId,
      dados.operacaoId ?? null,
      dados.saldoInicial ?? '0',
      usuario.id,
      !!dados.automatico,
      dados.observacoes ?? null,
    ]
  );
  const caixa = rows[0];

  await registrar(cx, {
    usuario,
    acao: ACOES.CRIAR,
    modulo: 'caixa',
    registroTipo: 'CAIXA',
    registroId: caixa.id,
    registroNumero: caixa.numero,
    descricao: `${dados.automatico ? 'Abertura automática' : 'Abertura'} do caixa ${caixa.numero} com saldo ${caixa.saldo_inicial}.`,
    depois: caixa,
    ip: contexto.ip,
    sessao: contexto.sessao,
  });
  return caixa;
}

/**
 * Devolve o caixa aberto da conta. Na primeira movimentacao abre um turno com
 * saldo zero, o que preserva os fluxos existentes e torna a captura automatica.
 * A UNIQUE parcial no banco impede dois caixas abertos para a mesma conta.
 */
export async function garantirCaixaAbertoEmTransacao(
  cx,
  contaBancariaId,
  { operacaoId = null, usuario, contexto = {} } = {}
) {
  await contaCaixaEm(cx, contaBancariaId);
  const atual = await cx.query(
    `SELECT * FROM caixas
      WHERE conta_bancaria_id=$1 AND status='ABERTO'
      FOR UPDATE`,
    [contaBancariaId]
  );
  if (atual.rows[0]) return atual.rows[0];

  return criarCaixaEm(
    cx,
    {
      contaBancariaId,
      operacaoId,
      saldoInicial: '0',
      automatico: true,
      observacoes: 'Aberto automaticamente na primeira movimentação financeira.',
    },
    usuario,
    contexto
  );
}

export function abrirCaixa(dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    await contaCaixaEm(cx, dados.contaBancariaId);
    const { rows } = await cx.query(
      `SELECT id,numero FROM caixas
        WHERE conta_bancaria_id=$1 AND status='ABERTO' FOR UPDATE`,
      [dados.contaBancariaId]
    );
    if (rows[0]) throw new ErroNegocio(`O caixa ${rows[0].numero} desta conta já está aberto.`);
    return criarCaixaEm(cx, { ...dados, automatico: false }, usuario, contexto);
  });
}

async function formasEsperadasEm(cx, caixaId) {
  const { rows } = await cx.query(
    `SELECT fp.id,fp.codigo,fp.nome,fp.grupo_caixa,fp.ordem_caixa,
            (CASE WHEN fp.codigo='DINHEIRO' THEN c.saldo_inicial ELSE 0 END
             + COALESCE(SUM(CASE
                 WHEN cm.estornado THEN 0
                 WHEN cm.tipo='ENTRADA' THEN cm.valor
                 ELSE -cm.valor END),0))::NUMERIC(18,4) AS valor_sistema,
            COALESCE(SUM(CASE WHEN NOT cm.estornado AND cm.tipo='ENTRADA' THEN cm.valor ELSE 0 END),0)::NUMERIC(18,4) AS entradas,
            COALESCE(SUM(CASE WHEN NOT cm.estornado AND cm.tipo='SAIDA' THEN cm.valor ELSE 0 END),0)::NUMERIC(18,4) AS saidas
       FROM caixas c
       CROSS JOIN formas_pagamento fp
       LEFT JOIN caixa_movimentos cm
         ON cm.caixa_id=c.id AND cm.forma_pagamento_id=fp.id
      WHERE c.id=$1
        AND (fp.ativo OR cm.id IS NOT NULL)
      GROUP BY fp.id,c.saldo_inicial
     HAVING fp.codigo='DINHEIRO'
         OR COALESCE(SUM(CASE WHEN cm.estornado THEN 0 ELSE cm.valor END),0)<>0
      ORDER BY fp.ordem_caixa,fp.nome`,
    [caixaId]
  );
  return rows;
}

export async function registrarMovimentoManual(caixaId, tipo, dados, usuario, contexto = {}) {
  if (!['SUPRIMENTO', 'SANGRIA'].includes(tipo)) throw new ErroNegocio('Tipo de movimento inválido.');
  return transacao(async (cx) => {
    const { rows } = await cx.query(
      `SELECT c.*,cb.nome AS conta_nome
         FROM caixas c JOIN contas_bancarias cb ON cb.id=c.conta_bancaria_id
        WHERE c.id=$1 FOR UPDATE OF c`,
      [caixaId]
    );
    const caixa = rows[0];
    if (!caixa) throw new ErroNaoEncontrado('Caixa não encontrado.');
    if (caixa.status !== 'ABERTO') throw new ErroNegocio('Este caixa já foi fechado.');
    const formaId = await formaDinheiroEm(cx);
    if (tipo === 'SANGRIA') {
      const formas = await formasEsperadasEm(cx, caixa.id);
      const saldoDinheiro = formas.find((forma) => forma.codigo === 'DINHEIRO')?.valor_sistema ?? '0';
      if (dinheiro(dados.valor).maiorQue(saldoDinheiro))
        throw new ErroNegocio('A sangria não pode ser maior que o dinheiro esperado no caixa.');
    }
    const movimento = await cx.query(
      `INSERT INTO caixa_movimentos (
          conta_bancaria_id,data,tipo,valor,historico,origem_tipo,origem_id,
          caixa_id,forma_pagamento_id,operacao_id,criado_por
       ) VALUES ($1,CURRENT_DATE,$2,$3,$4,$5,$6,$6,$7,$8,$9)
       RETURNING *`,
      [
        caixa.conta_bancaria_id,
        tipo === 'SUPRIMENTO' ? 'ENTRADA' : 'SAIDA',
        dados.valor,
        `${tipo === 'SUPRIMENTO' ? 'Suprimento' : 'Sangria'} — ${dados.motivo}`,
        tipo,
        caixa.id,
        formaId,
        caixa.operacao_id,
        usuario.id,
      ]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.CRIAR,
      modulo: 'caixa',
      registroTipo: 'CAIXA_MOVIMENTO',
      registroId: movimento.rows[0].id,
      registroNumero: caixa.numero,
      descricao: `${tipo === 'SUPRIMENTO' ? 'Suprimento' : 'Sangria'} de ${dados.valor} no caixa ${caixa.numero}. Motivo: ${dados.motivo}`,
      depois: movimento.rows[0],
      ip: contexto.ip,
      sessao: contexto.sessao,
    });
    return movimento.rows[0];
  });
}

export function fecharCaixa(caixaId, informados, observacoes, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const { rows } = await cx.query('SELECT * FROM caixas WHERE id=$1 FOR UPDATE', [caixaId]);
    const caixa = rows[0];
    if (!caixa) throw new ErroNaoEncontrado('Caixa não encontrado.');
    if (caixa.status !== 'ABERTO') throw new ErroNegocio('Este caixa já foi fechado.');

    const esperados = await formasEsperadasEm(cx, caixa.id);
    const linhas = esperados.map((forma) => {
      const bruto = informados[String(forma.id)];
      if (bruto === undefined || bruto === null || bruto === '')
        throw new ErroNegocio(`Conte ou confira o valor de ${forma.nome}.`);
      const valor = Decimal.de(bruto, 4);
      if (!valor || valor.ehNegativo()) throw new ErroNegocio(`O valor informado em ${forma.nome} é inválido.`);
      return { ...forma, valorInformado: valor.paraSql(4), valorSistema: forma.valor_sistema };
    });
    const totais = totalizarConferencias(linhas);

    for (const linha of linhas) {
      await cx.query(
        `INSERT INTO caixa_conferencias
            (caixa_id,forma_pagamento_id,valor_sistema,valor_informado,criado_por)
         VALUES ($1,$2,$3,$4,$5)`,
        [caixa.id, linha.id, linha.valorSistema, linha.valorInformado, usuario.id]
      );
    }

    const fechado = await cx.query(
      `UPDATE caixas
          SET status='FECHADO',fechamento_em=now(),fechamento_por=$1,
              total_sistema=$2,total_informado=$3,diferenca=$4,
              observacoes_fechamento=$5
        WHERE id=$6 RETURNING *`,
      [usuario.id, totais.sistema, totais.informado, totais.diferenca, observacoes ?? null, caixa.id]
    );

    await registrar(cx, {
      usuario,
      acao: ACOES.FECHAR,
      modulo: 'caixa',
      registroTipo: 'CAIXA',
      registroId: caixa.id,
      registroNumero: caixa.numero,
      descricao: `Fechamento do caixa ${caixa.numero}. Sistema ${totais.sistema}; informado ${totais.informado}; diferença ${totais.diferenca}.`,
      antes: { status: caixa.status },
      depois: fechado.rows[0],
      ip: contexto.ip,
      sessao: contexto.sessao,
    });
    return fechado.rows[0];
  });
}

const SQL_CAIXA = `SELECT c.*,cb.nome AS conta_nome,cb.codigo AS conta_codigo,
                          m.codigo AS moeda,m.simbolo AS moeda_simbolo,
                          o.nome AS operacao,u1.nome AS aberto_por,u2.nome AS fechado_por
                     FROM caixas c
                     JOIN contas_bancarias cb ON cb.id=c.conta_bancaria_id
                     JOIN moedas m ON m.id=cb.moeda_id
                     LEFT JOIN operacoes o ON o.id=c.operacao_id
                     LEFT JOIN usuarios u1 ON u1.id=c.abertura_por
                     LEFT JOIN usuarios u2 ON u2.id=c.fechamento_por`;

export const listarCaixasAbertos = () =>
  muitos(`${SQL_CAIXA} WHERE c.status='ABERTO' ORDER BY c.abertura_em,c.id`);

export async function referenciasAbertura() {
  const [contas, operacoes] = await Promise.all([
    muitos(`SELECT cb.id,cb.nome,m.codigo AS moeda,m.simbolo
              FROM contas_bancarias cb JOIN moedas m ON m.id=cb.moeda_id
             WHERE cb.ativo AND cb.tipo='CAIXA' ORDER BY cb.nome`),
    muitos(`SELECT id,codigo,nome,cor FROM operacoes WHERE ativo ORDER BY ordem,nome`),
  ]);
  return { contas, operacoes };
}

async function movimentosDoCaixa(caixaId) {
  return muitos(
    `SELECT cm.*,fp.nome AS forma_pagamento,fp.grupo_caixa,u.nome AS usuario,
            o.nome AS operacao,
            COALESCE(cp.numero,cr.numero,ct.numero) AS transacao_numero,
            CASE
              WHEN cm.origem_tipo='CONTA_PAGAR' THEN '/financeiro/pagar/'||cm.origem_id
              WHEN cm.origem_tipo='CONTA_RECEBER' THEN '/financeiro/receber/'||cm.origem_id
              ELSE NULL END AS origem_url
       FROM caixa_movimentos cm
       LEFT JOIN formas_pagamento fp ON fp.id=cm.forma_pagamento_id
       LEFT JOIN usuarios u ON u.id=cm.criado_por
       LEFT JOIN operacoes o ON o.id=cm.operacao_id
       LEFT JOIN contas_pagar cp ON cm.origem_tipo='CONTA_PAGAR' AND cp.id=cm.origem_id
       LEFT JOIN contas_receber cr ON cm.origem_tipo='CONTA_RECEBER' AND cr.id=cm.origem_id
       LEFT JOIN caixa_transferencias ct ON cm.origem_tipo='TRANSFERENCIA' AND ct.id=cm.origem_id
      WHERE cm.caixa_id=$1
      ORDER BY cm.criado_em DESC,cm.id DESC`,
    [caixaId]
  );
}

export async function buscarCaixa(caixaId) {
  const caixa = await um(`${SQL_CAIXA} WHERE c.id=$1`, [caixaId]);
  if (!caixa) return null;
  const movimentos = await movimentosDoCaixa(caixa.id);
  const formas = caixa.status === 'FECHADO'
    ? await muitos(
        `SELECT cc.*,fp.codigo,fp.nome,fp.grupo_caixa,fp.ordem_caixa
           FROM caixa_conferencias cc JOIN formas_pagamento fp ON fp.id=cc.forma_pagamento_id
          WHERE cc.caixa_id=$1 ORDER BY fp.ordem_caixa,fp.nome`,
        [caixa.id]
      )
    : await formasEsperadasEm(pool, caixa.id);
  const canais = await muitos(
    `SELECT COALESCE(o.nome,'Sem operação') AS nome,
            COALESCE(SUM(CASE WHEN cm.estornado THEN 0 WHEN cm.tipo='ENTRADA' THEN cm.valor ELSE -cm.valor END),0)::NUMERIC(18,4) AS total
       FROM caixa_movimentos cm LEFT JOIN operacoes o ON o.id=cm.operacao_id
      WHERE cm.caixa_id=$1 GROUP BY o.nome ORDER BY o.nome NULLS LAST`,
    [caixa.id]
  );
  return { ...caixa, movimentos, formas, canais, resumo: resumirMovimentos(caixa.saldo_inicial, movimentos) };
}

export async function caixaAtual(preferidoId = null) {
  let caixa = null;
  if (preferidoId) caixa = await um(`SELECT id FROM caixas WHERE id=$1 AND status='ABERTO'`, [preferidoId]);
  if (!caixa) caixa = await um(`SELECT id FROM caixas WHERE status='ABERTO' ORDER BY abertura_em,id LIMIT 1`);
  return caixa ? buscarCaixa(caixa.id) : null;
}

export function listarHistorico(filtros = {}) {
  const params = [];
  const cond = [`c.status='FECHADO'`];
  if (filtros.de) { params.push(filtros.de); cond.push(`c.abertura_em >= $${params.length}::date`); }
  if (filtros.ate) { params.push(filtros.ate); cond.push(`c.abertura_em < $${params.length}::date + INTERVAL '1 day'`); }
  if (filtros.contaId) { params.push(filtros.contaId); cond.push(`c.conta_bancaria_id=$${params.length}`); }
  return muitos(`${SQL_CAIXA} WHERE ${cond.join(' AND ')} ORDER BY c.fechamento_em DESC,c.id DESC LIMIT 300`, params);
}

export function listarConferencia(filtros = {}) {
  const params = [];
  const cond = ['cm.caixa_id IS NOT NULL'];
  if (filtros.de) { params.push(filtros.de); cond.push(`cm.criado_em >= $${params.length}::date`); }
  if (filtros.ate) { params.push(filtros.ate); cond.push(`cm.criado_em < $${params.length}::date + INTERVAL '1 day'`); }
  if (filtros.formaId) { params.push(filtros.formaId); cond.push(`cm.forma_pagamento_id=$${params.length}`); }
  if (filtros.caixaId) { params.push(filtros.caixaId); cond.push(`cm.caixa_id=$${params.length}`); }
  return muitos(
    `SELECT cm.id,cm.data,cm.criado_em,cm.tipo,cm.valor,cm.historico,cm.origem_tipo,
            cm.origem_id,cm.estornado,fp.nome AS forma_pagamento,fp.grupo_caixa,
            c.numero AS caixa_numero,c.id AS caixa_id,u.nome AS usuario,
            COALESCE(cp.numero,cr.numero,ct.numero) AS transacao_numero,
            CASE
              WHEN cm.origem_tipo='CONTA_PAGAR' THEN '/financeiro/pagar/'||cm.origem_id
              WHEN cm.origem_tipo='CONTA_RECEBER' THEN '/financeiro/receber/'||cm.origem_id
              ELSE '/caixa/'||c.id END AS abrir_url
       FROM caixa_movimentos cm
       JOIN caixas c ON c.id=cm.caixa_id
       LEFT JOIN formas_pagamento fp ON fp.id=cm.forma_pagamento_id
       LEFT JOIN usuarios u ON u.id=cm.criado_por
       LEFT JOIN contas_pagar cp ON cm.origem_tipo='CONTA_PAGAR' AND cp.id=cm.origem_id
       LEFT JOIN contas_receber cr ON cm.origem_tipo='CONTA_RECEBER' AND cr.id=cm.origem_id
       LEFT JOIN caixa_transferencias ct ON cm.origem_tipo='TRANSFERENCIA' AND ct.id=cm.origem_id
      WHERE ${cond.join(' AND ')}
      ORDER BY cm.criado_em DESC,cm.id DESC LIMIT 1000`,
    params
  );
}

export const listarFormas = () =>
  muitos(`SELECT id,codigo,nome,grupo_caixa FROM formas_pagamento WHERE ativo ORDER BY ordem_caixa,nome`);

export default {
  abrirCaixa,
  garantirCaixaAbertoEmTransacao,
  formaCaixaEmTransacao,
  registrarMovimentoManual,
  fecharCaixa,
  listarCaixasAbertos,
  referenciasAbertura,
  buscarCaixa,
  caixaAtual,
  listarHistorico,
  listarConferencia,
  listarFormas,
};
