/**
 * SHKT Transportes: a viagem e o centro da operacao.
 *
 * Receita de frete, abastecimentos, despesas e manutencao ficam ligados a
 * mesma viagem. Cada confirmacao gera no Financeiro exatamente um titulo,
 * sempre dentro da mesma transacao e com origem navegavel.
 */
import { transacao, muitos, um } from '../db/index.js';
import { registrar, ACOES, diferenca } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { criarContaPagar, criarContaReceber, cancelarTituloEmTransacao } from './financeiro.js';

const EDITAVEIS = ['RASCUNHO', 'PROGRAMADA'];

async function referencia(cx, tabela, codigo) {
  const { rows } = await cx.query(`SELECT id FROM ${tabela} WHERE codigo = $1 LIMIT 1`, [codigo]);
  if (!rows[0]) throw new ErroNegocio(`Cadastro de apoio "${codigo}" não foi encontrado.`);
  return rows[0].id;
}

async function bloquear(cx, id) {
  const { rows } = await cx.query('SELECT * FROM viagens WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new ErroNaoEncontrado('Viagem não encontrada.');
  return rows[0];
}

export async function listar(filtros = {}) {
  const p = [];
  const w = [];
  const add = (sql, valor) => { p.push(valor); w.push(sql.replace('?', `$${p.length}`)); };
  if (filtros.status) add('v.status = ?', filtros.status);
  if (filtros.veiculoId) add('v.veiculo_id = ?', filtros.veiculoId);
  if (filtros.motoristaId) add('v.motorista_id = ?', filtros.motoristaId);
  if (filtros.de) add('v.data_saida_prevista >= ?', filtros.de);
  if (filtros.ate) add('v.data_saida_prevista <= ?', filtros.ate);
  if (filtros.busca) {
    p.push(`%${filtros.busca}%`);
    w.push(`(v.numero ILIKE $${p.length} OR v.origem ILIKE $${p.length} OR
             v.destino ILIKE $${p.length} OR ve.placa ILIKE $${p.length} OR
             pa.razao_social ILIKE $${p.length})`);
  }

  return muitos(
    `SELECT r.*, ve.placa, ve.marca_modelo, mo.nome AS motorista,
            pa.razao_social AS cliente, op.nome AS operacao, op.cor AS operacao_cor
       FROM vw_viagens_resultado r
       JOIN viagens v ON v.id = r.id
       JOIN veiculos ve ON ve.id = v.veiculo_id
       JOIN motoristas mo ON mo.id = v.motorista_id
       LEFT JOIN parceiros pa ON pa.id = v.cliente_id
       JOIN operacoes op ON op.id = v.operacao_id
      ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
      ORDER BY v.data_saida_prevista DESC, v.id DESC`,
    p
  );
}

export async function indicadores() {
  return um(`SELECT
      COUNT(*) FILTER (WHERE status IN ('PROGRAMADA','EM_ANDAMENTO','AGUARDANDO_ACERTO'))::INT AS abertas,
      COUNT(*) FILTER (WHERE status = 'EM_ANDAMENTO')::INT AS em_andamento,
      COALESCE(SUM(receita_prevista) FILTER (WHERE status <> 'CANCELADA'), 0) AS receita,
      COALESCE(SUM(custo_direto) FILTER (WHERE status <> 'CANCELADA'), 0) AS custo,
      COALESCE(SUM(margem_prevista) FILTER (WHERE status <> 'CANCELADA'), 0) AS margem
    FROM vw_viagens_resultado
   WHERE data_saida_prevista >= date_trunc('month', CURRENT_DATE)::DATE
     AND data_saida_prevista < (date_trunc('month', CURRENT_DATE) + interval '1 month')::DATE`);
}

export async function buscar(id) {
  const viagem = await um(
    `SELECT r.*, v.*, ve.placa, ve.marca_modelo, mo.nome AS motorista,
            pa.razao_social AS cliente, op.nome AS operacao, op.cor AS operacao_cor,
            cr.numero AS conta_receber_numero, cr.status AS conta_receber_status
       FROM viagens v
       JOIN vw_viagens_resultado r ON r.id = v.id
       JOIN veiculos ve ON ve.id = v.veiculo_id
       JOIN motoristas mo ON mo.id = v.motorista_id
       LEFT JOIN parceiros pa ON pa.id = v.cliente_id
       JOIN operacoes op ON op.id = v.operacao_id
       LEFT JOIN contas_receber cr ON cr.id = v.conta_receber_id
      WHERE v.id = $1`,
    [id]
  );
  if (!viagem) return null;

  const [abastecimentos, despesas, manutencoes, acerto] = await Promise.all([
    muitos(
      `SELECT a.*, tc.nome AS combustivel, p.razao_social AS fornecedor,
              cp.numero AS conta_pagar_numero, cp.status AS conta_pagar_status
         FROM abastecimentos a
         JOIN tipos_combustivel tc ON tc.id = a.combustivel_id
         LEFT JOIN parceiros p ON p.id = a.fornecedor_id
         LEFT JOIN contas_pagar cp ON cp.id = a.conta_pagar_id
        WHERE a.viagem_id = $1 ORDER BY a.data DESC, a.id DESC`, [id]
    ),
    muitos(
      `SELECT d.*, p.razao_social AS parceiro, cp.numero AS conta_pagar_numero,
              cp.status AS conta_pagar_status
         FROM viagem_despesas d
         LEFT JOIN parceiros p ON p.id = d.parceiro_id
         LEFT JOIN contas_pagar cp ON cp.id = d.conta_pagar_id
        WHERE d.viagem_id = $1 ORDER BY d.data DESC, d.id DESC`, [id]
    ),
    muitos(
      `SELECT m.*, p.razao_social AS oficina, cp.numero AS conta_pagar_numero,
              cp.status AS conta_pagar_status
         FROM ordens_manutencao m
         LEFT JOIN parceiros p ON p.id = m.oficina_id
         LEFT JOIN contas_pagar cp ON cp.id = m.conta_pagar_id
        WHERE m.viagem_id = $1 ORDER BY m.data DESC, m.id DESC`, [id]
    ),
    um(`SELECT a.*,cp.numero AS conta_pagar_numero,cr.numero AS conta_receber_numero
          FROM viagem_acertos a LEFT JOIN contas_pagar cp ON cp.id=a.conta_pagar_id
          LEFT JOIN contas_receber cr ON cr.id=a.conta_receber_id WHERE a.viagem_id=$1`,[id]),
  ]);
  return { ...viagem, abastecimentos, despesas, manutencoes, acerto };
}

export async function criarViagem(dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.VIAGEM);
    const { rows } = await cx.query(
      `INSERT INTO viagens (
          numero, operacao_id, carregamento_id, cliente_id, veiculo_id, motorista_id,
          origem, destino, data_saida_prevista, km_inicial, valor_frete, moeda_id,
          centro_custo_id, condicao_pagamento, vencimento_frete, observacoes, criado_por
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [numero, dados.operacaoId, dados.carregamentoId ?? null, dados.clienteId ?? null,
       dados.veiculoId, dados.motoristaId, dados.origem, dados.destino,
       dados.dataSaidaPrevista, dados.kmInicial ?? null, dados.valorFrete || '0',
       dados.moedaId, dados.centroCustoId ?? null, dados.condicaoPagamento ?? null,
       dados.vencimentoFrete ?? null, dados.observacoes ?? null, usuario.id]
    );
    await registrar(cx, {
      usuario, acao: ACOES.CRIAR, modulo: 'frota', registroTipo: 'VIAGEM',
      registroId: rows[0].id, registroNumero: numero,
      descricao: `Viagem ${numero} criada: ${dados.origem} → ${dados.destino}.`,
      depois: rows[0], ip: contexto.ip, sessao: contexto.sessao,
    });
    return rows[0];
  });
}

export async function atualizarViagem(id, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const atual = await bloquear(cx, id);
    if (!EDITAVEIS.includes(atual.status))
      throw new ErroNegocio('A viagem em andamento ou concluída não pode ser reescrita.');

    const { rows } = await cx.query(
      `UPDATE viagens SET operacao_id=$1, carregamento_id=$2, cliente_id=$3,
          veiculo_id=$4, motorista_id=$5, origem=$6, destino=$7,
          data_saida_prevista=$8, km_inicial=$9, valor_frete=$10, moeda_id=$11,
          centro_custo_id=$12, condicao_pagamento=$13, vencimento_frete=$14,
          observacoes=$15, atualizado_por=$16 WHERE id=$17 RETURNING *`,
      [dados.operacaoId, dados.carregamentoId ?? null, dados.clienteId ?? null,
       dados.veiculoId, dados.motoristaId, dados.origem, dados.destino,
       dados.dataSaidaPrevista, dados.kmInicial ?? null, dados.valorFrete || '0',
       dados.moedaId, dados.centroCustoId ?? null, dados.condicaoPagamento ?? null,
       dados.vencimentoFrete ?? null, dados.observacoes ?? null, usuario.id, id]
    );
    const dif = diferenca(atual, rows[0]);
    if (dif) await registrar(cx, {
      usuario, acao: ACOES.ALTERAR, modulo: 'frota', registroTipo: 'VIAGEM',
      registroId: id, registroNumero: atual.numero, descricao: `Viagem ${atual.numero} alterada.`,
      antes: dif.antes, depois: dif.depois, ip: contexto.ip, sessao: contexto.sessao,
    });
    return rows[0];
  });
}

export async function programar(id, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const v = await bloquear(cx, id);
    if (v.status !== 'RASCUNHO') throw new ErroNegocio('A viagem já foi programada.');

    let conta = null;
    if (Number(v.valor_frete) > 0) {
      if (!v.cliente_id) throw new ErroNegocio('Informe o cliente antes de programar uma viagem com frete.');
      const categoriaId = await referencia(cx, 'categorias_financeiras', 'VENDA_SERVICO');
      conta = await criarContaReceber(cx, {
        descricao: `Frete da viagem ${v.numero}: ${v.origem} → ${v.destino}`,
        origem: 'FRETE', origemTipo: 'VIAGEM', origemId: v.id, origemNumero: v.numero,
        parceiroId: v.cliente_id, categoriaId, centroCustoId: v.centro_custo_id,
        vencimento: v.vencimento_frete || v.data_saida_prevista, valor: v.valor_frete,
        moedaId: v.moeda_id, operacaoId: v.operacao_id,
      }, usuario);
    }

    const { rows } = await cx.query(
      `UPDATE viagens SET status='PROGRAMADA', programada_em=now(), programada_por=$1,
          conta_receber_id=$2, atualizado_por=$1 WHERE id=$3 RETURNING *`,
      [usuario.id, conta?.id ?? null, id]
    );
    await registrar(cx, {
      usuario, acao: ACOES.APROVAR, modulo: 'frota', registroTipo: 'VIAGEM',
      registroId: id, registroNumero: v.numero,
      descricao: `Viagem ${v.numero} programada${conta ? `; Contas a Receber ${conta.numero} gerado` : ''}.`,
      antes: { status: v.status }, depois: { status: 'PROGRAMADA' },
      ip: contexto.ip, sessao: contexto.sessao,
    });
    return rows[0];
  });
}

export async function iniciar(id, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const v = await bloquear(cx, id);
    if (v.status !== 'PROGRAMADA') throw new ErroNegocio('Apenas viagem programada pode ser iniciada.');
    const { rows } = await cx.query(
      `UPDATE viagens SET status='EM_ANDAMENTO', data_saida=COALESCE($1, now()),
          km_inicial=COALESCE($2, km_inicial), atualizado_por=$3 WHERE id=$4 RETURNING *`,
      [dados.dataSaida ?? null, dados.kmInicial ?? null, usuario.id, id]
    );
    await registrar(cx, {
      usuario, acao: ACOES.ALTERAR, modulo: 'frota', registroTipo: 'VIAGEM',
      registroId: id, registroNumero: v.numero, descricao: `Viagem ${v.numero} iniciada.`,
      antes: { status: v.status }, depois: { status: 'EM_ANDAMENTO' },
      ip: contexto.ip, sessao: contexto.sessao,
    });
    return rows[0];
  });
}

export async function concluir(id, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const v = await bloquear(cx, id);
    if (!['EM_ANDAMENTO','AGUARDANDO_ACERTO'].includes(v.status))
      throw new ErroNegocio('Apenas viagem em andamento pode ser concluída.');
    if (v.km_inicial != null && Number(dados.kmFinal) < Number(v.km_inicial))
      throw new ErroNegocio('A quilometragem final não pode ser menor que a inicial.');

    const { rows } = await cx.query(
      `UPDATE viagens SET status='AGUARDANDO_ACERTO', data_retorno=COALESCE($1, now()),
          km_final=$2, atualizado_por=$3
        WHERE id=$4 RETURNING *`,
      [dados.dataRetorno ?? null, dados.kmFinal, usuario.id, id]
    );
    await registrar(cx, {
      usuario, acao: ACOES.FECHAR, modulo: 'frota', registroTipo: 'VIAGEM',
      registroId: id, registroNumero: v.numero, descricao: `Viagem ${v.numero} retornou e aguarda acerto.`,
      antes: { status: v.status }, depois: { status: 'AGUARDANDO_ACERTO', km_final: dados.kmFinal },
      ip: contexto.ip, sessao: contexto.sessao,
    });
    return rows[0];
  });
}

export async function cancelarViagem(id, motivo, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const v = await bloquear(cx, id);
    if (v.status === 'CANCELADA') throw new ErroNegocio('A viagem já está cancelada.');
    if (v.status === 'CONCLUIDA') throw new ErroNegocio('Viagem concluída não pode ser apagada; faça os estornos necessários.');
    const custos = await cx.query(
      `SELECT (SELECT COUNT(*) FROM abastecimentos WHERE viagem_id=$1 AND status='CONFIRMADO') +
              (SELECT COUNT(*) FROM viagem_despesas WHERE viagem_id=$1 AND status='CONFIRMADA') +
              (SELECT COUNT(*) FROM ordens_manutencao WHERE viagem_id=$1 AND status IN ('APROVADA','EM_EXECUCAO','CONCLUIDA')) AS n`, [id]
    );
    if (Number(custos.rows[0].n) > 0)
      throw new ErroNegocio('Esta viagem possui custos confirmados. Cancele ou estorne esses lançamentos primeiro.');
    await cancelarTituloEmTransacao(cx, 'CR', 'VIAGEM', id, motivo, usuario);
    await cx.query(
      `UPDATE viagens SET status='CANCELADA', cancelada_em=now(), cancelada_por=$1,
          motivo_cancelamento=$2, atualizado_por=$1 WHERE id=$3`, [usuario.id, motivo, id]
    );
    await registrar(cx, {
      usuario, acao: ACOES.CANCELAR, modulo: 'frota', registroTipo: 'VIAGEM',
      registroId: id, registroNumero: v.numero, descricao: `Viagem ${v.numero} cancelada. Motivo: ${motivo}`,
      antes: { status: v.status }, depois: { status: 'CANCELADA' },
      ip: contexto.ip, sessao: contexto.sessao,
    });
  });
}

export async function criarAbastecimento(dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.ABASTECIMENTO);
    const { rows } = await cx.query(
      `INSERT INTO abastecimentos (numero, viagem_id, operacao_id, data, veiculo_id,
          motorista_id, combustivel_id, fornecedor_id, quantidade_litros, preco_litro,
          quilometragem, centro_custo_id, observacoes, criado_por)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [numero, dados.viagemId ?? null, dados.operacaoId, dados.data ?? null, dados.veiculoId,
       dados.motoristaId ?? null, dados.combustivelId, dados.fornecedorId ?? null,
       dados.quantidadeLitros, dados.precoLitro, dados.quilometragem ?? null,
       dados.centroCustoId ?? null, dados.observacoes ?? null, usuario.id]
    );
    await registrar(cx, { usuario, acao: ACOES.CRIAR, modulo: 'frota',
      registroTipo: 'ABASTECIMENTO', registroId: rows[0].id, registroNumero: numero,
      descricao: `Abastecimento ${numero} lançado como rascunho.`, depois: rows[0],
      ip: contexto.ip, sessao: contexto.sessao });
    return rows[0];
  });
}

export async function confirmarAbastecimento(id, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const { rows } = await cx.query('SELECT * FROM abastecimentos WHERE id=$1 FOR UPDATE', [id]);
    const a = rows[0];
    if (!a) throw new ErroNaoEncontrado('Abastecimento não encontrado.');
    if (a.status !== 'RASCUNHO') throw new ErroNegocio('O abastecimento já foi confirmado ou cancelado.');
    const categoriaId = await referencia(cx, 'categorias_financeiras', 'COMBUSTIVEL');
    const moedaId = await referencia(cx, 'moedas', 'BRL');
    const conta = await criarContaPagar(cx, {
      descricao: `Combustível ${a.numero}${a.viagem_id ? ` — viagem #${a.viagem_id}` : ''}`,
      origem: 'ABASTECIMENTO', origemTipo: 'ABASTECIMENTO', origemId: a.id,
      origemNumero: a.numero, parceiroId: a.fornecedor_id, categoriaId,
      centroCustoId: a.centro_custo_id, vencimento: a.data, valor: a.valor_total,
      moedaId, operacaoId: a.operacao_id,
    }, usuario);
    const atualizado = await cx.query(
      `UPDATE abastecimentos SET status='CONFIRMADO', confirmado_em=now(),
          confirmado_por=$1, conta_pagar_id=$2, atualizado_por=$1 WHERE id=$3 RETURNING *`,
      [usuario.id, conta.id, id]
    );
    await registrar(cx, { usuario, acao: ACOES.APROVAR, modulo: 'frota',
      registroTipo: 'ABASTECIMENTO', registroId: id, registroNumero: a.numero,
      descricao: `Abastecimento ${a.numero} confirmado; Contas a Pagar ${conta.numero} gerado.`,
      antes: { status: a.status }, depois: { status: 'CONFIRMADO' },
      ip: contexto.ip, sessao: contexto.sessao });
    return atualizado.rows[0];
  });
}

export async function criarDespesa(dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const { rows: [viagem] } = await cx.query('SELECT status FROM viagens WHERE id=$1 FOR UPDATE',[dados.viagemId]);
    if (!viagem) throw new ErroNaoEncontrado('Viagem não encontrada.');
    if (['CONCLUIDA','CANCELADA'].includes(viagem.status))
      throw new ErroNegocio('Viagem concluída ou cancelada não aceita novos lançamentos.');
    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.DESPESA_VIAGEM);
    const { rows } = await cx.query(
      `INSERT INTO viagem_despesas (numero, viagem_id, data, tipo, descricao,
          parceiro_id, categoria_id, centro_custo_id, valor, moeda_id, observacoes, criado_por)
       VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [numero, dados.viagemId, dados.data ?? null, dados.tipo, dados.descricao,
       dados.parceiroId ?? null, dados.categoriaId ?? null, dados.centroCustoId ?? null,
       dados.valor, dados.moedaId, dados.observacoes ?? null, usuario.id]
    );
    await registrar(cx, { usuario, acao: ACOES.CRIAR, modulo: 'frota',
      registroTipo: 'DESPESA_VIAGEM', registroId: rows[0].id, registroNumero: numero,
      descricao: `Despesa ${numero} lançada na viagem #${dados.viagemId}.`, depois: rows[0],
      ip: contexto.ip, sessao: contexto.sessao });
    return rows[0];
  });
}

export async function confirmarDespesa(id, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const { rows } = await cx.query(
      `SELECT d.*, v.operacao_id FROM viagem_despesas d JOIN viagens v ON v.id=d.viagem_id
        WHERE d.id=$1 FOR UPDATE OF d`, [id]
    );
    const d = rows[0];
    if (!d) throw new ErroNaoEncontrado('Despesa não encontrada.');
    if (d.status !== 'RASCUNHO') throw new ErroNegocio('A despesa já foi confirmada ou cancelada.');
    if (d.tipo !== 'ADIANTAMENTO') {
      const { rows: [comprovante] } = await cx.query(`SELECT COUNT(*)::INT n FROM anexos
        WHERE entidade_tipo='DESPESA_VIAGEM' AND entidade_id=$1 AND excluido_em IS NULL`,[id]);
      if (!comprovante.n) throw new ErroNegocio('Anexe o comprovante antes de confirmar esta despesa.');
    }
    let conta = null;
    // O adiantamento e saída de caixa para o motorista. Os comprovantes de
    // gasto são custo da viagem e entram no acerto, sem gerar pagamento duplo.
    if (d.tipo === 'ADIANTAMENTO') {
      const categoriaId = d.categoria_id || await referencia(cx, 'categorias_financeiras', 'ACERTO_VIAGEM');
      conta = await criarContaPagar(cx, {
        descricao: `${d.descricao} — adiantamento da viagem #${d.viagem_id}`,
        origem: 'VIAGEM', origemTipo: 'DESPESA_VIAGEM', origemId: d.id,
        origemNumero: d.numero, parceiroId: d.parceiro_id, categoriaId,
        centroCustoId: d.centro_custo_id, vencimento: d.data, valor: d.valor,
        moedaId: d.moeda_id, operacaoId: d.operacao_id,
      }, usuario);
    }
    const atualizado = await cx.query(
      `UPDATE viagem_despesas SET status='CONFIRMADA', confirmada_em=now(),
          confirmada_por=$1, conta_pagar_id=$2, atualizado_por=$1 WHERE id=$3 RETURNING *`,
      [usuario.id, conta?.id ?? null, id]
    );
    await registrar(cx, { usuario, acao: ACOES.APROVAR, modulo: 'frota',
      registroTipo: 'DESPESA_VIAGEM', registroId: id, registroNumero: d.numero,
      descricao: conta ? `Adiantamento ${d.numero} confirmado; Contas a Pagar ${conta.numero} gerado.`
        : `Comprovante ${d.numero} confirmado para o acerto da viagem.`,
      antes: { status: d.status }, depois: { status: 'CONFIRMADA' },
      ip: contexto.ip, sessao: contexto.sessao });
    return atualizado.rows[0];
  });
}

export async function fecharAcerto(viagemId, dados, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const { rows: [v] } = await cx.query(`SELECT v.*,m.nome AS motorista,m.funcionario_id
      FROM viagens v JOIN motoristas m ON m.id=v.motorista_id WHERE v.id=$1 FOR UPDATE OF v`,[viagemId]);
    if (!v) throw new ErroNaoEncontrado('Viagem não encontrada.');
    if (v.status !== 'AGUARDANDO_ACERTO') throw new ErroNegocio('A viagem precisa ter retornado antes do acerto.');
    const { rows: [s] } = await cx.query(`SELECT
      COALESCE(SUM(valor) FILTER(WHERE tipo='ADIANTAMENTO' AND status='CONFIRMADA'),0) adiantado,
      COALESCE(SUM(valor) FILTER(WHERE tipo<>'ADIANTAMENTO' AND status='CONFIRMADA'),0) despesas,
      COUNT(*) FILTER(WHERE status='RASCUNHO')::INT rascunhos FROM viagem_despesas WHERE viagem_id=$1`,[viagemId]);
    if (s.rascunhos > 0) throw new ErroNegocio('Confirme ou cancele todas as despesas antes de fechar o acerto.');
    const adiantado=Number(s.adiantado), despesas=Number(s.despesas);
    const devolver=Math.max(adiantado-despesas,0), reembolsar=Math.max(despesas-adiantado,0);
    const numero=await proximoNumero(cx,TIPOS_DOCUMENTO.ACERTO_VIAGEM);
    const { rows:[a] }=await cx.query(`INSERT INTO viagem_acertos
      (numero,viagem_id,total_adiantado,total_despesas,saldo_devolver,saldo_reembolsar,observacoes,criado_por)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[numero,viagemId,adiantado,despesas,devolver,reembolsar,dados.observacoes,usuario.id]);
    const moedaId=v.moeda_id; const categoriaId=await referencia(cx,'categorias_financeiras','ACERTO_VIAGEM');
    let cp=null,cr=null;
    if(reembolsar>0) cp=await criarContaPagar(cx,{descricao:`Reembolso do acerto ${numero} — ${v.motorista}`,
      origem:'ACERTO_VIAGEM',origemTipo:'ACERTO_VIAGEM',origemId:a.id,origemNumero:numero,
      funcionarioId:v.funcionario_id,beneficiario:v.motorista,categoriaId,centroCustoId:v.centro_custo_id,
      vencimento:dados.vencimento,valor:String(reembolsar),moedaId,operacaoId:v.operacao_id},usuario);
    if(devolver>0) { const categoriaReceita=await referencia(cx,'categorias_financeiras','RECUPERACAO_DESPESA');
      cr=await criarContaReceber(cx,{descricao:`Devolução do acerto ${numero} — ${v.motorista}`,
      origem:'ACERTO_VIAGEM',origemTipo:'ACERTO_VIAGEM',origemId:a.id,origemNumero:numero,pagador:v.motorista,
      categoriaId:categoriaReceita,centroCustoId:v.centro_custo_id,vencimento:dados.vencimento,valor:String(devolver),
      moedaId,operacaoId:v.operacao_id},usuario); }
    await cx.query("UPDATE viagem_acertos SET status='FECHADO',fechado_em=now(),fechado_por=$1,conta_pagar_id=$2,conta_receber_id=$3 WHERE id=$4",[usuario.id,cp?.id??null,cr?.id??null,a.id]);
    await cx.query("UPDATE viagens SET status='CONCLUIDA',concluida_em=now(),concluida_por=$1,atualizado_por=$1 WHERE id=$2",[usuario.id,viagemId]);
    await registrar(cx,{usuario,acao:ACOES.FECHAR,modulo:'frota',registroTipo:'ACERTO_VIAGEM',registroId:a.id,
      registroNumero:numero,descricao:`Acerto ${numero} fechado: adiantado ${adiantado}, despesas ${despesas}.`,
      depois:{adiantado,despesas,devolver,reembolsar},ip:contexto.ip,sessao:contexto.sessao}); return a;
  });
}

export async function criarManutencao(dados, usuario, contexto = {}) {
  const total = Number(dados.valorPecas || 0) + Number(dados.valorServicos || 0) +
    Number(dados.valorMaoObra || 0);
  if (total <= 0) throw new ErroNegocio('Informe ao menos um valor de peça, serviço ou mão de obra.');
  return transacao(async (cx) => {
    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.MANUTENCAO);
    const { rows } = await cx.query(
      `INSERT INTO ordens_manutencao (numero, operacao_id, viagem_id, veiculo_id,
          oficina_id, data, quilometragem, tipo, descricao, valor_pecas,
          valor_servicos, valor_mao_obra, previsao_conclusao, categoria_id,
          centro_custo_id, moeda_id, observacoes, criado_por)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [numero, dados.operacaoId, dados.viagemId ?? null, dados.veiculoId,
       dados.oficinaId ?? null, dados.data ?? null, dados.quilometragem ?? null,
       dados.tipo, dados.descricao, dados.valorPecas || '0', dados.valorServicos || '0',
       dados.valorMaoObra || '0', dados.previsaoConclusao ?? null, dados.categoriaId ?? null,
       dados.centroCustoId ?? null, dados.moedaId, dados.observacoes ?? null, usuario.id]
    );
    await registrar(cx, { usuario, acao: ACOES.CRIAR, modulo: 'frota',
      registroTipo: 'MANUTENCAO', registroId: rows[0].id, registroNumero: numero,
      descricao: `Ordem de manutenção ${numero} criada.`, depois: rows[0],
      ip: contexto.ip, sessao: contexto.sessao });
    return rows[0];
  });
}

export async function listarManutencoes(filtros = {}) {
  const p = [];
  const w = [];
  const add = (sql, valor) => { p.push(valor); w.push(sql.replace('?', `$${p.length}`)); };
  if (filtros.status) add('m.status = ?', filtros.status);
  if (filtros.veiculoId) add('m.veiculo_id = ?', filtros.veiculoId);
  if (filtros.busca) {
    p.push(`%${filtros.busca}%`);
    w.push(`(m.numero ILIKE $${p.length} OR m.descricao ILIKE $${p.length} OR
             v.placa ILIKE $${p.length} OR p.razao_social ILIKE $${p.length})`);
  }
  return muitos(
    `SELECT m.*, v.placa, v.marca_modelo, p.razao_social AS oficina,
            vi.numero AS viagem_numero, cp.numero AS conta_pagar_numero,
            cp.status AS conta_pagar_status
       FROM ordens_manutencao m
       JOIN veiculos v ON v.id=m.veiculo_id
       LEFT JOIN parceiros p ON p.id=m.oficina_id
       LEFT JOIN viagens vi ON vi.id=m.viagem_id
       LEFT JOIN contas_pagar cp ON cp.id=m.conta_pagar_id
      ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
      ORDER BY m.data DESC, m.id DESC`, p
  );
}

export async function aprovarManutencao(id, usuario, contexto = {}) {
  return transacao(async (cx) => {
    const { rows } = await cx.query('SELECT * FROM ordens_manutencao WHERE id=$1 FOR UPDATE', [id]);
    const m = rows[0];
    if (!m) throw new ErroNaoEncontrado('Ordem de manutenção não encontrada.');
    if (m.status !== 'RASCUNHO') throw new ErroNegocio('A ordem já foi aprovada ou cancelada.');
    const categoriaId = m.categoria_id || await referencia(cx, 'categorias_financeiras', 'MANUTENCAO');
    const conta = await criarContaPagar(cx, {
      descricao: `Manutenção ${m.numero}: ${m.descricao}`,
      origem: 'MANUTENCAO', origemTipo: 'MANUTENCAO', origemId: m.id,
      origemNumero: m.numero, parceiroId: m.oficina_id, categoriaId,
      centroCustoId: m.centro_custo_id, vencimento: m.previsao_conclusao || m.data,
      valor: m.valor_total, moedaId: m.moeda_id, operacaoId: m.operacao_id,
    }, usuario);
    const atualizado = await cx.query(
      `UPDATE ordens_manutencao SET status='APROVADA', aprovada_em=now(),
          aprovada_por=$1, conta_pagar_id=$2, atualizado_por=$1 WHERE id=$3 RETURNING *`,
      [usuario.id, conta.id, id]
    );
    await registrar(cx, { usuario, acao: ACOES.APROVAR, modulo: 'frota',
      registroTipo: 'MANUTENCAO', registroId: id, registroNumero: m.numero,
      descricao: `Manutenção ${m.numero} aprovada; Contas a Pagar ${conta.numero} gerado.`,
      antes: { status: m.status }, depois: { status: 'APROVADA' },
      ip: contexto.ip, sessao: contexto.sessao });
    return atualizado.rows[0];
  });
}

export default {
  listar, indicadores, buscar, criarViagem, atualizarViagem, programar, iniciar,
  concluir, cancelarViagem, criarAbastecimento, confirmarAbastecimento,
  criarDespesa, confirmarDespesa, fecharAcerto, criarManutencao, listarManutencoes, aprovarManutencao,
};
