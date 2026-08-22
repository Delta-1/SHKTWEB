/**
 * Numeracao documental sequencial anual: 0001-2026, 0002-2026, ... 0001-2027.
 *
 * Sempre chamada DENTRO da transacao que cria o documento. A funcao
 * fn_proximo_numero bloqueia a linha da sequencia ate o COMMIT, de forma que
 * dois usuarios criando documentos ao mesmo tempo nunca recebem o mesmo numero
 * (secao 4) - e, se a transacao falhar, o numero nao e consumido.
 */

export const TIPOS_DOCUMENTO = {
  FUMIGACAO: 'FUMIGACAO',
  CERTIFICADO: 'CERTIFICADO',
  CARREGAMENTO: 'CARREGAMENTO',
  PEDIDO_COMPRA: 'PEDIDO_COMPRA',
  RECEBIMENTO: 'RECEBIMENTO',
  PEDIDO_VENDA: 'PEDIDO_VENDA',
  CONTA_PAGAR: 'CONTA_PAGAR',
  CONTA_RECEBER: 'CONTA_RECEBER',
  TRANSFERENCIA: 'TRANSFERENCIA',
  AJUSTE_ESTOQUE: 'AJUSTE_ESTOQUE',
  VIAGEM: 'VIAGEM',
  ABASTECIMENTO: 'ABASTECIMENTO',
  DESPESA_VIAGEM: 'DESPESA_VIAGEM',
  MANUTENCAO: 'MANUTENCAO',
};

/**
 * @param {import('pg').PoolClient} cx conexao dentro da transacao
 * @param {string} tipo um dos TIPOS_DOCUMENTO
 * @param {number} [ano] padrao: ano corrente
 * @returns {Promise<string>} ex.: "0007-2026"
 */
export async function proximoNumero(cx, tipo, ano = new Date().getFullYear()) {
  const { rows } = await cx.query('SELECT fn_proximo_numero($1, $2) AS numero', [tipo, ano]);
  return rows[0].numero;
}

/** Extrai o ano de um numero documental "0007-2026" -> 2026 */
export function anoDoNumero(numero) {
  const m = /^(\d+)-(\d{4})$/.exec(String(numero || ''));
  return m ? Number(m[2]) : null;
}

export default { proximoNumero, TIPOS_DOCUMENTO, anoDoNumero };
