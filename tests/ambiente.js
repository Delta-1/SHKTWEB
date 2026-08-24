/**
 * Ambiente de teste.
 *
 * Aponta para um banco separado (shkt_erp_test), aplica as migracoes e a carga
 * inicial, e oferece utilitarios para limpar os dados operacionais entre os
 * testes - preservando os cadastros de apoio criados pelo seed.
 *
 * Importante: as variaveis sao definidas ANTES de importar qualquer modulo do
 * ERP, porque src/config.js le o ambiente no momento do import.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://shkt:shkt@127.0.0.1:5432/shkt_erp_test';

const { migrar } = await import('../src/db/migrate.js');
const { semear } = await import('../src/db/seed.js');
const db = await import('../src/db/index.js');

export const { pool, query, um, muitos, transacao } = db;

let preparado = false;

/** Prepara o banco de teste (uma vez por processo). */
export async function prepararBanco() {
  if (preparado) return;
  await migrar({ silencioso: true });
  await semear({ silencioso: true });
  preparado = true;
}

/**
 * Limpa dados operacionais entre os testes.
 * Cadastros de apoio (moedas, unidades, perfis...) permanecem.
 */
export async function limparOperacional() {
  await query(`
    TRUNCATE TABLE
      abastecimentos, viagem_despesas, ordens_manutencao, viagens,
      caixa_conferencias, caixa_movimentos, caixas, caixa_transferencias, financeiro_baixas,
      contas_pagar, contas_receber,
      recebimento_itens, recebimentos,
      pedido_compra_itens, pedidos_compra,
      pedido_venda_itens, pedidos_venda,
      carregamento_documentos, carregamentos,
      certificados_fumigacao, fumigacao_movimentos, fumigacoes,
      estoque_reservas, estoque_movimentos, estoque_saldos, lotes,
      anexos, auditoria
    RESTART IDENTITY CASCADE
  `);
  await query(`DELETE FROM documento_sequencias`);
}

/** Remove tambem os cadastros criados pelos testes. */
export async function limparCadastrosDeTeste() {
  await query(`DELETE FROM motoristas WHERE nome LIKE 'TESTE-%'`);
  await query(`DELETE FROM veiculos WHERE placa LIKE 'TST%'`);
  await query(`DELETE FROM parceiros WHERE codigo LIKE 'TESTE-%'`);
  await query(`DELETE FROM produtos WHERE codigo LIKE 'TESTE-%'`);
  await query(`DELETE FROM locais_estoque WHERE codigo LIKE 'TESTE-%'`);
}

/** Usuario ficticio usado nas chamadas de servico. */
export async function usuarioTeste() {
  const u = await um(
    `SELECT u.id, u.nome, u.email, u.perfil_id, p.codigo AS perfil_codigo, p.nome AS perfil_nome
       FROM usuarios u JOIN perfis p ON p.id = u.perfil_id
      ORDER BY u.id LIMIT 1`
  );
  const permissoes = (
    await muitos('SELECT permissao FROM perfil_permissoes WHERE perfil_id = $1', [u.perfil_id])
  ).map((r) => r.permissao);
  return { ...u, permissoes };
}

/** Ids das entidades de apoio mais usadas nos testes. */
export async function referencias() {
  const [produto, local, ton, kg, brl, fumigadora, cliente, fornecedor] = await Promise.all([
    um(`SELECT id FROM produtos WHERE codigo = 'MILHO-AD'`),
    um(`SELECT id FROM locais_estoque WHERE codigo = 'ARMAZEM-01'`),
    um(`SELECT id FROM unidades_medida WHERE codigo = 'TON'`),
    um(`SELECT id FROM unidades_medida WHERE codigo = 'KG'`),
    um(`SELECT id FROM moedas WHERE codigo = 'BRL'`),
    garantirParceiro('TESTE-FUM', 'FUMIGADORA TESTE LTDA', { is_fumigadora: true, custo_tonelada: '12.5000' }),
    garantirParceiro('TESTE-CLI', 'CLIENTE TESTE S.A.', { is_cliente: true }),
    garantirParceiro('TESTE-FOR', 'FORNECEDOR TESTE LTDA', { is_fornecedor: true }),
  ]);

  return {
    produtoId: produto.id,
    localId: local.id,
    tonId: ton.id,
    kgId: kg.id,
    brlId: brl.id,
    fumigadoraId: fumigadora.id,
    clienteId: cliente.id,
    fornecedorId: fornecedor.id,
  };
}

async function garantirParceiro(codigo, razao, flags = {}) {
  const existente = await um('SELECT id FROM parceiros WHERE codigo = $1', [codigo]);
  if (existente) return existente;
  return um(
    `INSERT INTO parceiros (codigo, razao_social, is_fumigadora, is_cliente, is_fornecedor, custo_tonelada)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      codigo,
      razao,
      !!flags.is_fumigadora,
      !!flags.is_cliente,
      !!flags.is_fornecedor,
      flags.custo_tonelada ?? null,
    ]
  );
}

export async function encerrar() {
  await pool.end();
}

/** Converte toneladas para a string em kg usada nas asserts. */
export const t = (toneladas) => (Number(toneladas) * 1000).toFixed(3);
