/**
 * Carga inicial do ERP SHKT.
 *
 * Cria apenas o que o sistema precisa para funcionar no primeiro dia:
 * perfis de acesso, usuario administrador, moedas, paises, unidades,
 * Incoterms, categorias financeiras e o produto principal da operacao.
 *
 * E idempotente: pode ser executado varias vezes sem duplicar registros.
 *
 *   npm run seed
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pool, transacao } from './index.js';
import { gerarHash } from '../lib/auth.js';
import { PERFIS_PADRAO } from '../lib/permissoes.js';

const SENHA_INICIAL = process.env.ADMIN_SENHA ||
  (process.env.NODE_ENV === 'test' ? randomBytes(24).toString('base64url') : null);
const EMAIL_ADMIN = process.env.ADMIN_EMAIL || 'admin@shkt.com.br';

export const MOEDAS = [
  ['BRL', 'Real brasileiro', 'R$', 2],
  ['USD', 'Dólar americano', 'US$', 2],
  ['PEN', 'Sol peruano', 'S/', 2],
];

export const PAISES = [
  ['BR', 'Brasil', 'BRL'],
  ['PE', 'Peru', 'PEN'],
  ['PY', 'Paraguai', 'USD'],
  ['BO', 'Bolívia', 'USD'],
  ['AR', 'Argentina', 'USD'],
  ['UY', 'Uruguai', 'USD'],
  ['CL', 'Chile', 'USD'],
];

// fator_kg: quantos quilos vale 1 unidade
export const UNIDADES = [
  ['KG', 'Quilograma', '1', 3],
  ['TON', 'Tonelada', '1000', 3],
  ['SC60', 'Saco 60 kg', '60', 2],
  ['SC50', 'Saco 50 kg', '50', 2],
  ['UN', 'Unidade', '1', 0],
];

export const INCOTERMS = [
  ['EXW', 'Ex Works - na origem'],
  ['FCA', 'Free Carrier - livre no transportador'],
  ['FOB', 'Free On Board - livre a bordo'],
  ['CFR', 'Cost and Freight - custo e frete'],
  ['CIF', 'Cost, Insurance and Freight - custo, seguro e frete'],
  ['CPT', 'Carriage Paid To - transporte pago até'],
  ['DAP', 'Delivered At Place - entregue no local'],
  ['DDP', 'Delivered Duty Paid - entregue com direitos pagos'],
];

export const FORMAS_PAGAMENTO = [
  ['PIX', 'PIX'],
  ['TED', 'Transferência bancária / TED'],
  ['BOLETO', 'Boleto'],
  ['DINHEIRO', 'Dinheiro'],
  ['CARTAO', 'Cartão'],
  ['CARTAO_CREDITO', 'Cartão de crédito'],
  ['CARTAO_DEBITO', 'Cartão de débito'],
  ['QR_CODE', 'QR Code'],
  ['CAMBIO', 'Câmbio / remessa internacional'],
  ['CHEQUE', 'Cheque'],
];

export const CONDICOES_PAGAMENTO = [
  ['AVISTA', 'À vista', 0, 1],
  ['10DD', '10 dias', 10, 1],
  ['15DD', '15 dias', 15, 1],
  ['30DD', '30 dias', 30, 1],
  ['45DD', '45 dias', 45, 1],
  ['60DD', '60 dias', 60, 1],
];

// codigo, nome, tipo, grupo_dre, ordem
export const CATEGORIAS = [
  ['VENDA_MERCADORIA', 'Venda de mercadoria', 'RECEITA', 'RECEITA_BRUTA', 10],
  ['VENDA_SERVICO', 'Prestação de serviço', 'RECEITA', 'RECEITA_BRUTA', 20],
  ['OUTRAS_RECEITAS', 'Outras receitas', 'RECEITA', 'OUTRAS', 900],
  ['DEDUCOES', 'Deduções sobre vendas', 'DESPESA', 'DEDUCOES', 100],
  ['COMPRA_MERCADORIA', 'Compra de mercadoria', 'DESPESA', 'CUSTO_MERCADORIA', 200],
  ['FRETE', 'Frete', 'DESPESA', 'FRETES', 210],
  ['FUMIGACAO', 'Fumigação', 'DESPESA', 'FUMIGACAO', 220],
  ['CUSTO_OPERACIONAL', 'Custos diretos operacionais', 'DESPESA', 'CUSTOS_DIRETOS', 230],
  ['ARMAZENAGEM', 'Armazenagem', 'DESPESA', 'CUSTOS_DIRETOS', 235],
  ['SALARIOS', 'Salários e encargos', 'DESPESA', 'SALARIOS', 300],
  ['ADMINISTRATIVAS', 'Despesas administrativas', 'DESPESA', 'ADMINISTRATIVAS', 310],
  ['MANUTENCAO', 'Manutenção', 'DESPESA', 'MANUTENCAO', 320],
  ['COMBUSTIVEL', 'Combustível', 'DESPESA', 'VEICULOS', 330],
  ['DESPESAS_VEICULOS', 'Despesas de veículos', 'DESPESA', 'VEICULOS', 335],
  ['VIAGEM', 'Despesas de viagem', 'DESPESA', 'VEICULOS', 340],
  ['IMPOSTOS', 'Impostos e taxas', 'DESPESA', 'IMPOSTOS', 350],
  ['OUTRAS_DESPESAS', 'Outras despesas', 'DESPESA', 'OUTRAS', 910],
];

export const CENTROS_CUSTO = [
  ['ADM', 'Administrativo'],
  ['COMERCIAL', 'Comercial'],
  ['OPERACAO', 'Operação / Pátio'],
  ['FROTA', 'Frota'],
  ['EXPORTACAO', 'Exportação'],
];

export const COMBUSTIVEIS = [
  ['DIESEL_S10', 'Diesel S10'],
  ['DIESEL_S500', 'Diesel S500'],
  ['GASOLINA', 'Gasolina'],
  ['ETANOL', 'Etanol'],
  ['ARLA', 'ARLA 32'],
];

async function inserir(cx, sql, params) {
  await cx.query(sql, params);
}

export async function semear({ silencioso = false } = {}) {
  const log = (...a) => !silencioso && console.log(...a);

  return transacao(async (cx) => {
    // ---------------------------------------------------------------- perfis
    for (const perfil of PERFIS_PADRAO) {
      const { rows } = await cx.query(
        `INSERT INTO perfis (codigo, nome, descricao, sistema)
              VALUES ($1,$2,$3,$4)
         ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome,
                                            descricao = EXCLUDED.descricao
         RETURNING id`,
        [perfil.codigo, perfil.nome, perfil.descricao, perfil.sistema]
      );
      const perfilId = rows[0].id;

      // Só popula as permissões na primeira carga; ajustes feitos na tela
      // de Perfis não são sobrescritos em execuções seguintes.
      const existentes = await cx.query(
        'SELECT COUNT(*)::INT AS n FROM perfil_permissoes WHERE perfil_id = $1',
        [perfilId]
      );
      if (existentes.rows[0].n === 0) {
        for (const p of perfil.permissoes) {
          await inserir(
            cx,
            `INSERT INTO perfil_permissoes (perfil_id, permissao)
                  VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [perfilId, p]
          );
        }
      }
    }
    log('  ✓ perfis de acesso');

    // -------------------------------------------------------------- usuário
    const perfilAdmin = await cx.query(`SELECT id FROM perfis WHERE codigo = 'ADMIN'`);
    const jaTemUsuario = await cx.query('SELECT COUNT(*)::INT AS n FROM usuarios');

    if (jaTemUsuario.rows[0].n === 0) {
      if (!SENHA_INICIAL) {
        throw new Error(
          'ADMIN_SENHA não está configurada. Defina uma senha inicial forte antes de executar o seed.'
        );
      }
      const hash = await gerarHash(SENHA_INICIAL);
      await inserir(
        cx,
        `INSERT INTO usuarios (nome, email, senha_hash, perfil_id, trocar_senha)
              VALUES ($1,$2,$3,$4,TRUE)`,
        ['Administrador SHKT', EMAIL_ADMIN, hash, perfilAdmin.rows[0].id]
      );
      log(`  ✓ usuário administrador criado: ${EMAIL_ADMIN} (troca obrigatória no primeiro acesso)`);
    }

    // -------------------------------------------------------- tabelas de apoio
    for (const [codigo, nome, simbolo, decimais] of MOEDAS)
      await inserir(
        cx,
        `INSERT INTO moedas (codigo, nome, simbolo, decimais) VALUES ($1,$2,$3,$4)
         ON CONFLICT (codigo) DO NOTHING`,
        [codigo, nome, simbolo, decimais]
      );

    for (const [codigo, nome, moeda] of PAISES)
      await inserir(
        cx,
        `INSERT INTO paises (codigo, nome, moeda_padrao) VALUES ($1,$2,$3)
         ON CONFLICT (codigo) DO NOTHING`,
        [codigo, nome, moeda]
      );

    for (const [codigo, descricao, fator, decimais] of UNIDADES)
      await inserir(
        cx,
        `INSERT INTO unidades_medida (codigo, descricao, fator_kg, decimais) VALUES ($1,$2,$3,$4)
         ON CONFLICT (codigo) DO NOTHING`,
        [codigo, descricao, fator, decimais]
      );

    for (const [codigo, descricao] of INCOTERMS)
      await inserir(
        cx,
        `INSERT INTO incoterms (codigo, descricao) VALUES ($1,$2)
         ON CONFLICT (codigo) DO NOTHING`,
        [codigo, descricao]
      );

    for (const [codigo, nome] of FORMAS_PAGAMENTO)
      await inserir(
        cx,
        `INSERT INTO formas_pagamento (codigo, nome) VALUES ($1,$2)
         ON CONFLICT (codigo) DO NOTHING`,
        [codigo, nome]
      );

    for (const [codigo, nome, dias, parcelas] of CONDICOES_PAGAMENTO)
      await inserir(
        cx,
        `INSERT INTO condicoes_pagamento (codigo, nome, dias_prazo, parcelas) VALUES ($1,$2,$3,$4)
         ON CONFLICT (codigo) DO NOTHING`,
        [codigo, nome, dias, parcelas]
      );

    for (const [codigo, nome, tipo, grupo, ordem] of CATEGORIAS)
      await inserir(
        cx,
        `INSERT INTO categorias_financeiras (codigo, nome, tipo, grupo_dre, ordem_dre)
              VALUES ($1,$2,$3,$4,$5) ON CONFLICT (codigo) DO NOTHING`,
        [codigo, nome, tipo, grupo, ordem]
      );

    for (const [codigo, nome] of CENTROS_CUSTO)
      await inserir(
        cx,
        `INSERT INTO centros_custo (codigo, nome) VALUES ($1,$2) ON CONFLICT (codigo) DO NOTHING`,
        [codigo, nome]
      );

    for (const [codigo, nome] of COMBUSTIVEIS)
      await inserir(
        cx,
        `INSERT INTO tipos_combustivel (codigo, nome) VALUES ($1,$2) ON CONFLICT (codigo) DO NOTHING`,
        [codigo, nome]
      );

    log('  ✓ moedas, países, unidades, Incoterms, categorias e centros de custo');

    // ------------------------------------------------------ produto principal
    const ton = await cx.query(`SELECT id FROM unidades_medida WHERE codigo = 'TON'`);
    await inserir(
      cx,
      `INSERT INTO produtos (codigo, descricao, nome_cientifico, unidade_id, categoria,
                             controla_lote, exige_fumigacao)
            VALUES ($1,$2,$3,$4,$5,TRUE,TRUE)
       ON CONFLICT (codigo) DO NOTHING`,
      ['MILHO-AD', 'Milho Amarelo Duro', 'Zea mays', ton.rows[0].id, 'Grãos']
    );

    // ---------------------------------------------------------- local padrão
    const brasil = await cx.query(`SELECT id FROM paises WHERE codigo = 'BR'`);
    await inserir(
      cx,
      `INSERT INTO locais_estoque (codigo, nome, pais_id) VALUES ($1,$2,$3)
       ON CONFLICT (codigo) DO NOTHING`,
      ['ARMAZEM-01', 'Armazém Principal', brasil.rows[0].id]
    );

    // -------------------------------------------------------- caixa da empresa
    const brl = await cx.query(`SELECT id FROM moedas WHERE codigo = 'BRL'`);
    await inserir(
      cx,
      `INSERT INTO contas_bancarias (codigo, nome, tipo, moeda_id) VALUES ($1,$2,'CAIXA',$3)
       ON CONFLICT (codigo) DO NOTHING`,
      ['CAIXA', 'Caixa da empresa', brl.rows[0].id]
    );

    log('  ✓ produto Milho Amarelo Duro, armazém principal e caixa');

    // ------------------------------------------------------------ parâmetros
    const parametros = [
      ['empresa.nome', 'SHKT INDÚSTRIA IMPORTAÇÃO & EXPORTAÇÃO LTDA', 'Razão social', 'EMPRESA'],
      ['empresa.cnpj', '', 'CNPJ', 'EMPRESA'],
      ['empresa.endereco', '', 'Endereço', 'EMPRESA'],
      ['empresa.cidade', '', 'Cidade/UF', 'EMPRESA'],
      ['empresa.telefone', '', 'Telefone', 'EMPRESA'],
      ['empresa.email', '', 'E-mail', 'EMPRESA'],
      ['certificado.dias_vencimento', '10', 'Dias para vencimento do título de fumigação', 'REGRAS'],
    ];
    for (const [chave, valor, descricao, grupo] of parametros)
      await inserir(
        cx,
        `INSERT INTO parametros (chave, valor, descricao, grupo) VALUES ($1,$2,$3,$4)
         ON CONFLICT (chave) DO NOTHING`,
        [chave, valor, descricao, grupo]
      );

    log('  ✓ parâmetros da empresa');
  });
}

const executadoDiretamente =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (executadoDiretamente) {
  console.log('Carregando dados iniciais do ERP SHKT...');
  semear()
    .then(() => pool.end())
    .then(() => {
      console.log('\nPronto. Acesse o sistema e troque a senha do administrador.');
      process.exit(0);
    })
    .catch((e) => {
      console.error('\nFalha na carga inicial:', e.message);
      console.error(e.stack);
      process.exit(1);
    });
}
