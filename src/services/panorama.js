/**
 * Panorama do grupo: o que entra e o que sai, por operação.
 *
 * É a pergunta que o dono faz todo dia, e a razão de o sistema existir:
 *
 *   "Quanto entrou e quanto saiu da SHKT? E da transportadora?"
 *
 * Duas leituras, deliberadamente separadas:
 *
 *   MERCADORIA  quilos que entraram no armazém e quilos que saíram.
 *               Entrada = recebimento confirmado. Saída = carregamento
 *               expedido. Pedido não conta: pedido é promessa.
 *
 *   DINHEIRO    o que passou pelo caixa, de verdade — baixa de título,
 *               não título em aberto. O que ainda está prometido aparece
 *               ao lado, com esse nome, para ninguém confundir compromisso
 *               com dinheiro.
 */
import { muitos, um } from '../db/index.js';

export const operacoes = () =>
  muitos('SELECT * FROM operacoes WHERE ativo ORDER BY ordem, nome');

/**
 * Números consolidados de cada operação no período.
 * @param {string} de  aaaa-mm-dd
 * @param {string} ate aaaa-mm-dd
 */
export async function porOperacao(de, ate) {
  const [lista, mercadoria, dinheiro, aberto, estoque] = await Promise.all([
    operacoes(),

    muitos(
      `SELECT operacao_id, sentido,
              COALESCE(SUM(quantidade_kg), 0)::NUMERIC(18,3) AS kg,
              COUNT(*)::INT AS documentos
         FROM vw_panorama_mercadoria
        WHERE data BETWEEN $1 AND $2
        GROUP BY operacao_id, sentido`,
      [de, ate]
    ),

    muitos(
      `SELECT operacao_id, sentido,
              COALESCE(SUM(valor), 0)::NUMERIC(18,4) AS valor,
              COUNT(*)::INT AS lancamentos
         FROM vw_panorama_dinheiro
        WHERE data BETWEEN $1 AND $2
        GROUP BY operacao_id, sentido`,
      [de, ate]
    ),

    muitos('SELECT * FROM vw_panorama_aberto'),

    // O estoque não tem recorte por operação: o grão é do grupo, está num
    // armazém só. Entra inteiro na operação de grãos.
    um(`SELECT COALESCE(SUM(fisico_kg),0)::NUMERIC(18,3)     AS fisico_kg,
               COALESCE(SUM(disponivel_kg),0)::NUMERIC(18,3) AS disponivel_kg,
               COALESCE(SUM(reservado_kg),0)::NUMERIC(18,3)  AS reservado_kg
          FROM vw_estoque_posicao`),
  ]);

  /**
   * Le um numero da consulta agregada. Quando nao existe linha (nenhum
   * movimento naquela operacao), devolve zero JA NA ESCALA CERTA: o mesmo
   * campo nunca sai ora como "0", ora como "0.000". Formato instavel obriga
   * quem consome a adivinhar, e cedo ou tarde alguem compara errado.
   */
  const busca = (linhas, id, sentido, campo, casas) => {
    const achou = linhas.find(
      (l) => Number(l.operacao_id) === Number(id) && l.sentido === sentido
    )?.[campo];
    if (achou !== undefined && achou !== null) return achou;
    return casas === null ? 0 : Number(0).toFixed(casas);
  };

  const KG = 3;      // quantidades em quilos
  const RS = 4;      // dinheiro
  const CONTAGEM = null;

  const painel = lista.map((op) => {
    const entrouKg = busca(mercadoria, op.id, 'ENTRADA', 'kg', KG);
    const saiuKg = busca(mercadoria, op.id, 'SAIDA', 'kg', KG);
    const entrouRs = busca(dinheiro, op.id, 'ENTRADA', 'valor', RS);
    const saiuRs = busca(dinheiro, op.id, 'SAIDA', 'valor', RS);

    return {
      ...op,
      mercadoria: {
        entrou_kg: entrouKg,
        saiu_kg: saiuKg,
        entradas: Number(busca(mercadoria, op.id, 'ENTRADA', 'documentos', CONTAGEM)),
        saidas: Number(busca(mercadoria, op.id, 'SAIDA', 'documentos', CONTAGEM)),
        saldo_kg: (Number(entrouKg) - Number(saiuKg)).toFixed(KG),
      },
      dinheiro: {
        entrou: entrouRs,
        saiu: saiuRs,
        resultado: (Number(entrouRs) - Number(saiuRs)).toFixed(RS),
      },
      aberto: {
        pagar: busca(aberto, op.id, 'A_PAGAR', 'valor', RS),
        pagar_vencido: busca(aberto, op.id, 'A_PAGAR', 'vencido', RS),
        receber: busca(aberto, op.id, 'A_RECEBER', 'valor', RS),
        receber_vencido: busca(aberto, op.id, 'A_RECEBER', 'vencido', RS),
      },
      // Só a operação de grãos guarda mercadoria
      estoque: op.tipo === 'GRAOS' ? estoque : null,
    };
  });

  // Total do grupo, incluindo o que ficou sem operação informada
  const somar = (linhas, sentido, campo) =>
    linhas
      .filter((l) => l.sentido === sentido)
      .reduce((s, l) => s + Number(l[campo] || 0), 0);

  const total = {
    entrou_kg: somar(mercadoria, 'ENTRADA', 'kg').toFixed(KG),
    saiu_kg: somar(mercadoria, 'SAIDA', 'kg').toFixed(KG),
    entrou: somar(dinheiro, 'ENTRADA', 'valor').toFixed(RS),
    saiu: somar(dinheiro, 'SAIDA', 'valor').toFixed(RS),
    pagar: somar(aberto, 'A_PAGAR', 'valor').toFixed(RS),
    pagar_vencido: somar(aberto, 'A_PAGAR', 'vencido').toFixed(RS),
    receber: somar(aberto, 'A_RECEBER', 'valor').toFixed(RS),
    receber_vencido: somar(aberto, 'A_RECEBER', 'vencido').toFixed(RS),
  };
  total.resultado = (Number(total.entrou) - Number(total.saiu)).toFixed(RS);
  total.saldo_kg = (Number(total.entrou_kg) - Number(total.saiu_kg)).toFixed(KG);

  return { operacoes: painel, total, estoque };
}

/**
 * Extrato do período: cada entrada e cada saída, em uma linha, do mais
 * recente para o mais antigo. É o "de onde veio esse número" do panorama.
 */
export function movimento(de, ate, limite = 40) {
  return muitos(
    `SELECT * FROM (
        SELECT m.data, m.sentido, m.origem, m.documento_id, m.documento_numero,
               m.quantidade_kg, NULL::NUMERIC(18,4) AS valor,
               o.nome AS operacao, o.cor AS operacao_cor, o.codigo AS operacao_codigo
          FROM vw_panorama_mercadoria m
          LEFT JOIN operacoes o ON o.id = m.operacao_id
         WHERE m.data BETWEEN $1 AND $2

        UNION ALL

        SELECT d.data, d.sentido, d.origem, d.documento_id, d.documento_numero,
               NULL::NUMERIC(18,3), d.valor,
               o.nome, o.cor, o.codigo
          FROM vw_panorama_dinheiro d
          LEFT JOIN operacoes o ON o.id = d.operacao_id
         WHERE d.data BETWEEN $1 AND $2
     ) t
     ORDER BY t.data DESC, t.documento_numero DESC
     LIMIT $3`,
    [de, ate, limite]
  );
}

/** Rótulo legível do tipo de lançamento no extrato. */
export const ROTULOS_ORIGEM = {
  RECEBIMENTO: 'Entrada de mercadoria',
  CARREGAMENTO: 'Expedição',
  RECEBIMENTO_TITULO: 'Recebimento de título',
  PAGAMENTO_TITULO: 'Pagamento de título',
};

/** Para onde o extrato leva quando a pessoa clica na linha. */
export const CAMINHOS_ORIGEM = {
  RECEBIMENTO: '/recebimentos/',
  CARREGAMENTO: '/carregamentos/',
  RECEBIMENTO_TITULO: '/financeiro/receber/',
  PAGAMENTO_TITULO: '/financeiro/pagar/',
};

export default { operacoes, porOperacao, movimento, ROTULOS_ORIGEM, CAMINHOS_ORIGEM };
