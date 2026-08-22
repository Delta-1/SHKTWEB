import { muitos, um, transacao } from '../db/index.js';
import { registrar, ACOES } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { criarContaPagar, cancelarTituloEmTransacao } from './financeiro.js';

export const listarFolhas = () => muitos(
  `SELECT f.*, o.nome AS operacao, m.codigo AS moeda,
          COUNT(i.id)::INT AS funcionarios,
          COALESCE(SUM(i.valor_liquido),0) AS total_liquido
     FROM folhas_competencia f JOIN operacoes o ON o.id=f.operacao_id
     JOIN moedas m ON m.id=f.moeda_id LEFT JOIN folha_funcionarios i ON i.folha_id=f.id
    GROUP BY f.id,o.nome,m.codigo ORDER BY f.competencia DESC,f.id DESC`
);

export async function buscarFolha(id) {
  const folha = await um(`SELECT f.*,o.nome AS operacao,m.codigo AS moeda FROM folhas_competencia f
    JOIN operacoes o ON o.id=f.operacao_id JOIN moedas m ON m.id=f.moeda_id WHERE f.id=$1`, [id]);
  if (!folha) return null;
  folha.itens = await muitos(`SELECT i.*,fu.nome AS funcionario,fu.matricula,cp.numero AS conta_pagar_numero,
    cp.status AS conta_pagar_status FROM folha_funcionarios i JOIN funcionarios fu ON fu.id=i.funcionario_id
    LEFT JOIN contas_pagar cp ON cp.id=i.conta_pagar_id WHERE i.folha_id=$1 ORDER BY fu.nome`, [id]);
  return folha;
}

export function criarFolha(dados, usuario, contexto={}) {
  return transacao(async cx => {
    const numero = await proximoNumero(cx, TIPOS_DOCUMENTO.FOLHA);
    const { rows } = await cx.query(`INSERT INTO folhas_competencia
      (numero,competencia,vencimento,operacao_id,moeda_id,observacoes,criado_por)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [numero,dados.competencia,dados.vencimento,dados.operacaoId,dados.moedaId,dados.observacoes,usuario.id]);
    await registrar(cx,{usuario,acao:ACOES.CRIAR,modulo:'rh',registroTipo:'FOLHA',registroId:rows[0].id,
      registroNumero:numero,descricao:`Folha ${numero} criada.`,depois:rows[0],ip:contexto.ip,sessao:contexto.sessao});
    return rows[0];
  });
}

export function adicionarFuncionario(folhaId, dados, usuario, contexto={}) {
  return transacao(async cx => {
    const { rows:[folha] } = await cx.query('SELECT * FROM folhas_competencia WHERE id=$1 FOR UPDATE',[folhaId]);
    if (!folha) throw new ErroNaoEncontrado('Folha não encontrada.');
    if (folha.status!=='RASCUNHO') throw new ErroNegocio('Somente folha em rascunho pode ser alterada.');
    const { rows: existentes } = await cx.query(
      'SELECT * FROM folha_funcionarios WHERE folha_id=$1 AND funcionario_id=$2',
      [folhaId,dados.funcionarioId]
    );
    const { rows } = await cx.query(`INSERT INTO folha_funcionarios
      (folha_id,funcionario_id,salario_base,horas_extras,adicionais,comissoes,outros_proventos,
       adiantamentos,inss,outros_descontos,observacoes,criado_por)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(folha_id,funcionario_id) DO UPDATE SET
        salario_base=EXCLUDED.salario_base,horas_extras=EXCLUDED.horas_extras,
        adicionais=EXCLUDED.adicionais,comissoes=EXCLUDED.comissoes,
        outros_proventos=EXCLUDED.outros_proventos,adiantamentos=EXCLUDED.adiantamentos,
        inss=EXCLUDED.inss,outros_descontos=EXCLUDED.outros_descontos,
        observacoes=EXCLUDED.observacoes RETURNING *`,
      [folhaId,dados.funcionarioId,dados.salarioBase,dados.horasExtras,dados.adicionais,dados.comissoes,
       dados.outrosProventos,dados.adiantamentos,dados.inss,dados.outrosDescontos,dados.observacoes,usuario.id]);
    await registrar(cx,{usuario,acao:existentes[0]?ACOES.ALTERAR:ACOES.CRIAR,modulo:'rh',registroTipo:'FOLHA_FUNCIONARIO',
      registroId:rows[0].id,registroNumero:folha.numero,
      descricao:`Funcionário ${existentes[0]?'atualizado':'incluído'} na folha ${folha.numero}.`,
      antes:existentes[0]||null,depois:rows[0],ip:contexto.ip,sessao:contexto.sessao});
    return rows[0];
  });
}

export function fecharFolha(id, usuario, contexto={}) {
  return transacao(async cx => {
    const { rows:[folha] } = await cx.query('SELECT * FROM folhas_competencia WHERE id=$1 FOR UPDATE',[id]);
    if (!folha) throw new ErroNaoEncontrado('Folha não encontrada.');
    if (folha.status!=='RASCUNHO') throw new ErroNegocio('Esta folha já foi fechada ou cancelada.');
    const { rows:itens } = await cx.query(`SELECT i.*,f.nome,f.centro_custo_id FROM folha_funcionarios i
      JOIN funcionarios f ON f.id=i.funcionario_id WHERE i.folha_id=$1 FOR UPDATE OF i`,[id]);
    if (!itens.length) throw new ErroNegocio('Inclua ao menos um funcionário antes de fechar a folha.');
    const { rows:[categoria] } = await cx.query("SELECT id FROM categorias_financeiras WHERE codigo='SALARIOS'");
    for (const item of itens) {
      if (Number(item.valor_liquido)<=0) continue;
      const cp = await criarContaPagar(cx,{descricao:`Folha ${folha.numero} — ${item.nome}`,origem:'RH',
        origemTipo:'FOLHA_FUNCIONARIO',origemId:item.id,origemNumero:folha.numero,
        funcionarioId:item.funcionario_id,beneficiario:item.nome,categoriaId:categoria.id,
        centroCustoId:item.centro_custo_id,competencia:folha.competencia,vencimento:folha.vencimento,
        valor:item.valor_liquido,moedaId:folha.moeda_id,operacaoId:folha.operacao_id},usuario);
      await cx.query('UPDATE folha_funcionarios SET conta_pagar_id=$1 WHERE id=$2',[cp.id,item.id]);
    }
    await cx.query("UPDATE folhas_competencia SET status='FECHADA',fechada_em=now(),fechada_por=$1,atualizado_por=$1 WHERE id=$2",[usuario.id,id]);
    await registrar(cx,{usuario,acao:ACOES.FECHAR,modulo:'rh',registroTipo:'FOLHA',registroId:id,
      registroNumero:folha.numero,descricao:`Folha ${folha.numero} fechada; ${itens.length} funcionário(s) processado(s).`,
      antes:{status:folha.status},depois:{status:'FECHADA'},ip:contexto.ip,sessao:contexto.sessao});
  });
}

export function cancelarFolha(id, motivo, usuario, contexto={}) {
  return transacao(async cx => {
    const { rows:[folha] } = await cx.query('SELECT * FROM folhas_competencia WHERE id=$1 FOR UPDATE',[id]);
    if (!folha) throw new ErroNaoEncontrado('Folha não encontrada.');
    if (folha.status==='CANCELADA') throw new ErroNegocio('A folha já está cancelada.');
    const { rows:itens } = await cx.query('SELECT id FROM folha_funcionarios WHERE folha_id=$1',[id]);
    for (const item of itens) await cancelarTituloEmTransacao(cx,'CP','FOLHA_FUNCIONARIO',item.id,motivo,usuario);
    await cx.query(`UPDATE folhas_competencia SET status='CANCELADA',cancelada_em=now(),cancelada_por=$1,
      motivo_cancelamento=$2,atualizado_por=$1 WHERE id=$3`,[usuario.id,motivo,id]);
    await registrar(cx,{usuario,acao:ACOES.CANCELAR,modulo:'rh',registroTipo:'FOLHA',registroId:id,
      registroNumero:folha.numero,descricao:`Folha ${folha.numero} cancelada. Motivo: ${motivo}`,
      antes:{status:folha.status},depois:{status:'CANCELADA'},ip:contexto.ip,sessao:contexto.sessao});
  });
}
