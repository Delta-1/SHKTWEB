/**
 * Listas de apoio usadas nos formularios operacionais.
 * Centralizado aqui para que toda tela ofereca exatamente as mesmas opcoes,
 * sempre filtradas por "ativo" - o operador nunca escolhe um cadastro morto.
 */
import { muitos } from '../db/index.js';

const consultas = {
  operacoes: () =>
    muitos('SELECT id, codigo, nome, tipo, cor FROM operacoes WHERE ativo ORDER BY ordem, nome'),
  produtos: () =>
    muitos(
      `SELECT id, codigo, descricao, unidade_id, controla_lote, exige_fumigacao
         FROM produtos WHERE ativo ORDER BY descricao`
    ),
  locais: () => muitos('SELECT id, codigo, nome FROM locais_estoque WHERE ativo ORDER BY nome'),
  unidades: () =>
    muitos('SELECT id, codigo, descricao, fator_kg, decimais FROM unidades_medida WHERE ativo ORDER BY fator_kg'),
  moedas: () => muitos('SELECT id, codigo, nome, simbolo FROM moedas WHERE ativo ORDER BY codigo'),
  lotes: () =>
    muitos(
      `SELECT l.id, l.codigo, l.produto_id, l.safra, p.descricao AS produto
         FROM lotes l JOIN produtos p ON p.id = l.produto_id
        WHERE l.ativo ORDER BY l.codigo`
    ),
  fumigadoras: () =>
    muitos(
      `SELECT id, razao_social AS nome, custo_tonelada
         FROM parceiros WHERE ativo AND is_fumigadora ORDER BY razao_social`
    ),
  clientes: () =>
    muitos(
      `SELECT id, razao_social AS nome, pais_id, moeda_id
         FROM parceiros WHERE ativo AND is_cliente ORDER BY razao_social`
    ),
  fornecedores: () =>
    muitos(
      `SELECT id, razao_social AS nome FROM parceiros WHERE ativo AND is_fornecedor ORDER BY razao_social`
    ),
  transportadoras: () =>
    muitos(
      `SELECT id, razao_social AS nome
         FROM parceiros WHERE ativo AND is_transportadora ORDER BY razao_social`
    ),
  parceiros: () =>
    muitos('SELECT id, razao_social AS nome FROM parceiros WHERE ativo ORDER BY razao_social'),
  veiculos: () =>
    muitos(
      `SELECT id, placa, marca_modelo, capacidade_kg, motorista_padrao_id
         FROM veiculos WHERE situacao = 'ATIVO' ORDER BY placa`
    ),
  motoristas: () =>
    muitos('SELECT id, nome, documento, veiculo_padrao_id FROM motoristas WHERE ativo ORDER BY nome'),
  funcionarios: () =>
    muitos(`SELECT id, matricula, nome FROM funcionarios WHERE situacao <> 'DESLIGADO' ORDER BY nome`),
  paises: () => muitos('SELECT id, codigo, nome FROM paises WHERE ativo ORDER BY nome'),
  incoterms: () => muitos('SELECT id, codigo, descricao FROM incoterms WHERE ativo ORDER BY codigo'),
  contasBancarias: () =>
    muitos(
      `SELECT cb.id, cb.codigo, cb.nome, cb.tipo, m.simbolo AS moeda_simbolo
         FROM contas_bancarias cb JOIN moedas m ON m.id = cb.moeda_id
        WHERE cb.ativo ORDER BY cb.tipo DESC, cb.nome`
    ),
  categorias: () =>
    muitos(
      `SELECT id, codigo, nome, tipo FROM categorias_financeiras WHERE ativo ORDER BY tipo, nome`
    ),
  centrosCusto: () => muitos('SELECT id, codigo, nome FROM centros_custo WHERE ativo ORDER BY nome'),
  formasPagamento: () => muitos('SELECT id, codigo, nome FROM formas_pagamento WHERE ativo ORDER BY nome'),
};

/**
 * Carrega apenas as listas pedidas, em paralelo.
 *   const ref = await carregar(['produtos', 'locais', 'unidades']);
 */
export async function carregar(nomes) {
  const pedidos = nomes.filter((n) => consultas[n]);
  const resultados = await Promise.all(pedidos.map((n) => consultas[n]()));
  return Object.fromEntries(pedidos.map((n, i) => [n, resultados[i]]));
}

export default { carregar };
