/**
 * Registro de auditoria (secao 22).
 *
 * Toda acao critica grava usuario, data/hora, modulo, registro afetado e,
 * quando aplicavel, o valor anterior e o posterior. A tabela e imutavel
 * (trigger no banco impede UPDATE/DELETE).
 *
 * Deve ser chamada DENTRO da mesma transacao da operacao auditada, para que
 * um rollback tambem descarte o log - evitando auditoria de algo que nao
 * aconteceu.
 */

export const ACOES = {
  CRIAR: 'CRIAR',
  ALTERAR: 'ALTERAR',
  APROVAR: 'APROVAR',
  VALIDAR: 'VALIDAR',
  CANCELAR: 'CANCELAR',
  ESTORNAR: 'ESTORNAR',
  PAGAR: 'PAGAR',
  RECEBER: 'RECEBER',
  FECHAR: 'FECHAR',
  EXPEDIR: 'EXPEDIR',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  LOGIN_FALHOU: 'LOGIN_FALHOU',
  IMPORTAR: 'IMPORTAR',
  EXPORTAR: 'EXPORTAR',
};

/**
 * @param {import('pg').PoolClient} cx
 * @param {object} dados
 * @param {object} [dados.usuario] objeto do usuario logado (req.usuario)
 * @param {string} dados.acao
 * @param {string} dados.modulo
 * @param {string} [dados.registroTipo]
 * @param {number} [dados.registroId]
 * @param {string} [dados.registroNumero]
 * @param {string} [dados.descricao]
 * @param {object} [dados.antes]
 * @param {object} [dados.depois]
 * @param {string} [dados.ip]
 * @param {string} [dados.sessao]
 */
export async function registrar(cx, dados) {
  const {
    usuario = null,
    acao,
    modulo,
    registroTipo = null,
    registroId = null,
    registroNumero = null,
    descricao = null,
    antes = null,
    depois = null,
    ip = null,
    sessao = null,
  } = dados;

  await cx.query(
    `INSERT INTO auditoria (
        usuario_id, usuario_nome, acao, modulo,
        registro_tipo, registro_id, registro_numero,
        descricao, valor_anterior, valor_posterior, ip, sessao
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      usuario?.id ?? null,
      usuario?.nome ?? null,
      acao,
      modulo,
      registroTipo,
      registroId,
      registroNumero,
      descricao,
      antes ? JSON.stringify(limpar(antes)) : null,
      depois ? JSON.stringify(limpar(depois)) : null,
      ip,
      sessao,
    ]
  );
}

/** Remove campos sem valor gerencial e dados sensiveis do snapshot. */
function limpar(objeto) {
  if (!objeto || typeof objeto !== 'object') return objeto;
  const ignorar = new Set(['senha', 'senha_hash', 'senha_confirmacao', '_csrf']);
  const saida = {};
  for (const [k, v] of Object.entries(objeto)) {
    if (ignorar.has(k)) continue;
    if (v === undefined) continue;
    saida[k] = v;
  }
  return saida;
}

/**
 * Compara dois snapshots e devolve apenas os campos que mudaram.
 * Deixa o log de auditoria legivel em vez de despejar o registro inteiro.
 */
export function diferenca(antes, depois) {
  const mudou = { antes: {}, depois: {} };
  const chaves = new Set([...Object.keys(antes || {}), ...Object.keys(depois || {})]);
  for (const k of chaves) {
    const a = antes?.[k];
    const d = depois?.[k];
    if (String(a ?? '') !== String(d ?? '')) {
      mudou.antes[k] = a ?? null;
      mudou.depois[k] = d ?? null;
    }
  }
  return Object.keys(mudou.depois).length ? mudou : null;
}

export default { registrar, diferenca, ACOES };
