import { muitos, um, transacao } from '../db/index.js';
import { registrar, ACOES } from '../lib/auditoria.js';
import { ErroNegocio, ErroNaoEncontrado } from '../lib/erros.js';
import { proximoNumero, TIPOS_DOCUMENTO } from '../lib/numeracao.js';
import { criarContaPagar, cancelarTituloEmTransacao } from './financeiro.js';

export const listar = () => muitos(`SELECT o.*,t.nome AS tipo,t.natureza,op.nome AS operacao,m.codigo AS moeda,
  cp.numero AS conta_pagar_numero,cp.status AS conta_pagar_status FROM obrigacoes o
  JOIN tipos_obrigacao t ON t.id=o.tipo_id JOIN operacoes op ON op.id=o.operacao_id
  JOIN moedas m ON m.id=o.moeda_id LEFT JOIN contas_pagar cp ON cp.id=o.conta_pagar_id
  ORDER BY o.vencimento,o.id DESC`);
export const tipos = () => muitos('SELECT * FROM tipos_obrigacao WHERE ativo ORDER BY natureza,nome');
export const buscar = id => um(`SELECT o.*,t.nome AS tipo,t.natureza,op.nome AS operacao,m.codigo AS moeda,
  cp.numero AS conta_pagar_numero,cp.status AS conta_pagar_status FROM obrigacoes o
  JOIN tipos_obrigacao t ON t.id=o.tipo_id JOIN operacoes op ON op.id=o.operacao_id
  JOIN moedas m ON m.id=o.moeda_id LEFT JOIN contas_pagar cp ON cp.id=o.conta_pagar_id WHERE o.id=$1`,[id]);

export function criar(dados,usuario,contexto={}) { return transacao(async cx=>{
  const numero=await proximoNumero(cx,TIPOS_DOCUMENTO.OBRIGACAO);
  const {rows}=await cx.query(`INSERT INTO obrigacoes
    (numero,tipo_id,operacao_id,competencia,vencimento,descricao,documento,parcela,total_parcelas,
     valor,moeda_id,taxa_cambio,centro_custo_id,observacoes,criado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [numero,dados.tipoId,dados.operacaoId,dados.competencia,dados.vencimento,dados.descricao,
     dados.documento,dados.parcela,dados.totalParcelas,dados.valor,dados.moedaId,dados.taxaCambio,
     dados.centroCustoId,dados.observacoes,usuario.id]);
  await registrar(cx,{usuario,acao:ACOES.CRIAR,modulo:'impostos',registroTipo:'OBRIGACAO',registroId:rows[0].id,
    registroNumero:numero,descricao:`Obrigação ${numero} criada.`,depois:rows[0],ip:contexto.ip,sessao:contexto.sessao});
  return rows[0];
}); }

export function aprovar(id,usuario,contexto={}) { return transacao(async cx=>{
  const {rows:[o]}=await cx.query(`SELECT o.*,t.categoria_id FROM obrigacoes o JOIN tipos_obrigacao t ON t.id=o.tipo_id
    WHERE o.id=$1 FOR UPDATE OF o`,[id]);
  if(!o) throw new ErroNaoEncontrado('Obrigação não encontrada.');
  if(o.status!=='RASCUNHO') throw new ErroNegocio('A obrigação já foi aprovada ou cancelada.');
  const cp=await criarContaPagar(cx,{descricao:o.descricao,origem:'IMPOSTO',origemTipo:'OBRIGACAO',origemId:o.id,
    origemNumero:o.numero,categoriaId:o.categoria_id,centroCustoId:o.centro_custo_id,competencia:o.competencia,
    vencimento:o.vencimento,valor:o.valor,moedaId:o.moeda_id,taxaCambio:o.taxa_cambio,documentoFiscal:o.documento,
    operacaoId:o.operacao_id},usuario);
  await cx.query("UPDATE obrigacoes SET status='APROVADA',aprovada_em=now(),aprovada_por=$1,conta_pagar_id=$2,atualizado_por=$1 WHERE id=$3",[usuario.id,cp.id,id]);
  await registrar(cx,{usuario,acao:ACOES.APROVAR,modulo:'impostos',registroTipo:'OBRIGACAO',registroId:id,
    registroNumero:o.numero,descricao:`Obrigação ${o.numero} aprovada; Contas a Pagar ${cp.numero} gerado.`,
    antes:{status:o.status},depois:{status:'APROVADA'},ip:contexto.ip,sessao:contexto.sessao});
}); }

export function cancelar(id,motivo,usuario,contexto={}) { return transacao(async cx=>{
  const {rows:[o]}=await cx.query('SELECT * FROM obrigacoes WHERE id=$1 FOR UPDATE',[id]);
  if(!o) throw new ErroNaoEncontrado('Obrigação não encontrada.');
  if(o.status==='CANCELADA') throw new ErroNegocio('A obrigação já está cancelada.');
  await cancelarTituloEmTransacao(cx,'CP','OBRIGACAO',o.id,motivo,usuario);
  await cx.query(`UPDATE obrigacoes SET status='CANCELADA',cancelada_em=now(),cancelada_por=$1,
    motivo_cancelamento=$2,atualizado_por=$1 WHERE id=$3`,[usuario.id,motivo,id]);
  await registrar(cx,{usuario,acao:ACOES.CANCELAR,modulo:'impostos',registroTipo:'OBRIGACAO',registroId:id,
    registroNumero:o.numero,descricao:`Obrigação ${o.numero} cancelada. Motivo: ${motivo}`,
    antes:{status:o.status},depois:{status:'CANCELADA'},ip:contexto.ip,sessao:contexto.sessao});
}); }
