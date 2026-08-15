/**
 * Conversao de unidades.
 *
 * O ERP guarda TODO o estoque em quilogramas. O usuario digita na unidade que
 * usa no dia a dia (tonelada, saco de 60 kg) e o sistema converte na entrada e
 * reconverte na exibicao. Isso elimina a divergencia classica entre planilhas
 * que misturam kg, t e sacos.
 */
import { Decimal } from '../lib/decimal.js';
import { ErroValidacao } from '../lib/erros.js';

/** Busca a unidade e devolve o fator de conversao para kg. */
export async function buscarUnidade(cx, unidadeId) {
  const { rows } = await cx.query(
    'SELECT id, codigo, descricao, fator_kg, decimais FROM unidades_medida WHERE id = $1',
    [unidadeId]
  );
  if (!rows[0]) throw new ErroValidacao('Unidade de medida não encontrada.', 'unidade_id');
  return rows[0];
}

/**
 * Converte uma quantidade digitada para kg.
 * @returns {{ kg: string, origem: string, unidade: object }}
 */
export async function paraKg(cx, quantidadeDigitada, unidadeId) {
  const unidade = await buscarUnidade(cx, unidadeId);
  const qtd = Decimal.de(quantidadeDigitada, 6);
  if (!qtd) throw new ErroValidacao('Quantidade é obrigatória.', 'quantidade');

  const kg = qtd.vezes(unidade.fator_kg);

  return {
    kg: kg.paraSql(3),
    origem: qtd.paraSql(3),
    unidade,
  };
}

/** Converte kg de volta para a unidade informada (para preencher formularios). */
export function deKg(valorKg, fatorKg, casas = 3) {
  const d = Decimal.de(valorKg, 6);
  if (!d) return null;
  return d.divididoPor(fatorKg || 1).paraSql(casas);
}

export default { buscarUnidade, paraKg, deKg };
