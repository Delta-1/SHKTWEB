/**
 * Cadastros mestres - a fonte unica de informacao do ERP.
 *
 * Clientes, fornecedores, transportadoras, fumigadoras e oficinas vivem na
 * MESMA tabela (parceiros), diferenciados por marcadores de papel. Assim uma
 * empresa que e fornecedora e tambem transportadora e cadastrada uma unica
 * vez - exatamente a regra central do projeto.
 */
import { Router } from 'express';
import { criarCrud } from '../lib/crud.js';
import { exigir } from '../lib/auth.js';
import { muitos } from '../db/index.js';

const router = Router();

// ---------------------------------------------------------------------------
// Parceiros
// ---------------------------------------------------------------------------

const camposParceiro = (papel) => [
  { nome: 'codigo', rotulo: 'Código', col: 3, listar: true, buscar: true,
    ajuda: 'Deixe em branco para gerar automaticamente.', grupo: 'Identificação' },
  { nome: 'tipo_pessoa', rotulo: 'Tipo', tipo: 'select', col: 3, padrao: 'PJ', obrigatorio: true,
    opcoes: [{ valor: 'PJ', texto: 'Pessoa jurídica' }, { valor: 'PF', texto: 'Pessoa física' }],
    grupo: 'Identificação' },
  { nome: 'razao_social', rotulo: 'Razão social / Nome', col: 6, obrigatorio: true,
    listar: true, buscar: true, grupo: 'Identificação' },
  { nome: 'nome_fantasia', rotulo: 'Nome fantasia', col: 6, buscar: true, grupo: 'Identificação' },
  { nome: 'tipo_documento', rotulo: 'Tipo de documento', tipo: 'select', col: 3, padrao: 'CNPJ',
    opcoes: [
      { valor: 'CNPJ', texto: 'CNPJ' },
      { valor: 'CPF', texto: 'CPF' },
      { valor: 'RUC', texto: 'RUC (Peru/Paraguai)' },
      { valor: 'OUTRO', texto: 'Outro / estrangeiro' },
    ], grupo: 'Identificação' },
  { nome: 'documento', rotulo: 'CPF / CNPJ / RUC', tipo: 'documento', col: 3,
    listar: true, buscar: true, grupo: 'Identificação',
    ajuda: 'CPF e CNPJ são conferidos pelo dígito verificador.' },
  { nome: 'inscricao_estadual', rotulo: 'Inscrição estadual', col: 3, grupo: 'Identificação' },
  { nome: 'ruc', rotulo: 'RUC', col: 3, grupo: 'Identificação' },

  { nome: 'pais_id', rotulo: 'País', tipo: 'select', origem: 'paises:nome', col: 3,
    grupo: 'Endereço e contato' },
  { nome: 'endereco', rotulo: 'Endereço', col: 6, grupo: 'Endereço e contato' },
  { nome: 'cidade', rotulo: 'Cidade', col: 3, listar: true, grupo: 'Endereço e contato' },
  { nome: 'estado', rotulo: 'Estado / Departamento', col: 3, grupo: 'Endereço e contato' },
  { nome: 'cep', rotulo: 'CEP / Código postal', col: 3, grupo: 'Endereço e contato' },
  { nome: 'telefone', rotulo: 'Telefone', col: 3, listar: true, buscar: true, grupo: 'Endereço e contato' },
  { nome: 'email', rotulo: 'E-mail', tipo: 'email', col: 3, buscar: true, grupo: 'Endereço e contato' },
  { nome: 'contato', rotulo: 'Pessoa de contato', col: 6, grupo: 'Endereço e contato' },

  { nome: 'moeda_id', rotulo: 'Moeda preferencial', tipo: 'select', origem: 'moedas:nome', col: 4,
    grupo: 'Condições comerciais' },
  { nome: 'condicao_pagto_id', rotulo: 'Condição de pagamento padrão', tipo: 'select',
    origem: 'condicoes_pagamento:nome', col: 4, grupo: 'Condições comerciais' },
  { nome: 'tipo_fornecimento', rotulo: 'Tipo de fornecimento', col: 4,
    placeholder: 'Mercadoria, frete, serviço...', grupo: 'Condições comerciais' },
  ...(papel === 'fumigadora'
    ? [{ nome: 'custo_tonelada', rotulo: 'Custo por tonelada (padrão)', tipo: 'dinheiro', col: 4,
         listar: true, grupo: 'Condições comerciais',
         ajuda: 'Sugerido automaticamente ao criar uma fumigação desta empresa.' }]
    : [{ nome: 'custo_tonelada', rotulo: 'Custo por tonelada (padrão)', tipo: 'dinheiro', col: 4,
         grupo: 'Condições comerciais' }]),

  { nome: 'banco_nome', rotulo: 'Banco', col: 3, grupo: 'Dados bancários' },
  { nome: 'banco_agencia', rotulo: 'Agência', col: 3, grupo: 'Dados bancários' },
  { nome: 'banco_conta', rotulo: 'Conta', col: 3, grupo: 'Dados bancários' },
  { nome: 'banco_titular', rotulo: 'Titular', col: 3, grupo: 'Dados bancários' },
  { nome: 'banco_pix', rotulo: 'Chave PIX', col: 6, grupo: 'Dados bancários' },

  { nome: 'is_cliente', rotulo: 'É cliente', tipo: 'checkbox', col: 3, grupo: 'Papéis no sistema',
    padrao: papel === 'cliente' },
  { nome: 'is_fornecedor', rotulo: 'É fornecedor', tipo: 'checkbox', col: 3, grupo: 'Papéis no sistema',
    padrao: papel === 'fornecedor' },
  { nome: 'is_transportadora', rotulo: 'É transportadora', tipo: 'checkbox', col: 3,
    grupo: 'Papéis no sistema', padrao: papel === 'transportadora' },
  { nome: 'is_fumigadora', rotulo: 'É empresa fumigadora', tipo: 'checkbox', col: 3,
    grupo: 'Papéis no sistema', padrao: papel === 'fumigadora' },
  { nome: 'is_oficina', rotulo: 'É oficina / prestador', tipo: 'checkbox', col: 3,
    grupo: 'Papéis no sistema', padrao: papel === 'oficina' },

  { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', col: 12, grupo: 'Outros' },
  { nome: 'ativo', rotulo: 'Cadastro ativo', tipo: 'checkbox', col: 3, padrao: true, grupo: 'Outros' },
];

const parceiro = (rota, titulo, singular, papel, flag, descricao) =>
  criarCrud({
    tabela: 'parceiros',
    rota,
    titulo,
    singular,
    permissao: 'cadastros',
    campoRotulo: 'razao_social',
    ordem: 'razao_social',
    filtroFixo: flag,
    valoresFixos: flag ? { [flag]: true } : undefined,
    colunasExtras: ['criado_por', 'atualizado_por'],
    campos: camposParceiro(papel),
    descricao,
  });

router.use(
  parceiro('clientes', 'Clientes', 'Cliente', 'cliente', 'is_cliente',
    'Compradores nacionais e internacionais.')
);
router.use(
  parceiro('fornecedores', 'Fornecedores', 'Fornecedor', 'fornecedor', 'is_fornecedor',
    'Fornecedores de mercadoria, frete e serviços.')
);
router.use(
  parceiro('fumigadoras', 'Empresas fumigadoras', 'Empresa fumigadora', 'fumigadora', 'is_fumigadora',
    'Somente empresas marcadas aqui podem ser escolhidas em uma fumigação.')
);
router.use(
  parceiro('transportadoras', 'Transportadoras', 'Transportadora', 'transportadora', 'is_transportadora', null)
);
router.use(
  parceiro('parceiros', 'Todos os parceiros', 'Parceiro', null, null,
    'Visão única de todos os cadastros. Use esta tela para adicionar um novo papel a uma empresa já cadastrada.')
);

// ---------------------------------------------------------------------------
// Produtos e lotes
// ---------------------------------------------------------------------------

router.use(
  criarCrud({
    tabela: 'produtos',
    rota: 'produtos',
    titulo: 'Produtos',
    singular: 'Produto',
    permissao: 'cadastros',
    campoRotulo: 'descricao',
    ordem: 'descricao',
    colunasExtras: ['criado_por', 'atualizado_por'],
    campos: [
      { nome: 'codigo', rotulo: 'Código', col: 3, obrigatorio: true, listar: true, buscar: true },
      { nome: 'descricao', rotulo: 'Descrição', col: 6, obrigatorio: true, listar: true, buscar: true },
      { nome: 'categoria', rotulo: 'Categoria', col: 3, listar: true, buscar: true },
      { nome: 'nome_cientifico', rotulo: 'Nome científico', col: 4,
        ajuda: 'Usado em documentos de exportação. Ex.: Zea mays' },
      { nome: 'unidade_id', rotulo: 'Unidade padrão', tipo: 'select', origem: 'unidades_medida:descricao',
        col: 4, obrigatorio: true, listar: true,
        ajuda: 'Unidade sugerida nas telas. O estoque é sempre guardado em kg.' },
      { nome: 'ncm', rotulo: 'NCM', col: 4 },
      { nome: 'estoque_minimo_kg', rotulo: 'Estoque mínimo (kg)', tipo: 'decimal', escala: 3, col: 4,
        ajuda: 'Abaixo disso o produto aparece nos alertas do painel.' },
      { nome: 'controla_lote', rotulo: 'Controla lote', tipo: 'checkbox', col: 4, padrao: true },
      { nome: 'exige_fumigacao', rotulo: 'Exige certificado de fumigação para exportar',
        tipo: 'checkbox', col: 4, listar: true,
        ajuda: 'Bloqueia a expedição de exportação sem certificado válido vinculado.' },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', col: 12 },
      { nome: 'ativo', rotulo: 'Produto ativo', tipo: 'checkbox', col: 3, padrao: true },
    ],
  })
);

router.use(
  criarCrud({
    tabela: 'lotes',
    rota: 'lotes',
    titulo: 'Lotes',
    singular: 'Lote',
    permissao: 'cadastros',
    campoRotulo: 'codigo',
    ordem: 'id DESC',
    colunasExtras: ['criado_por'],
    descricao: 'Identificação de partidas de mercadoria para rastreabilidade.',
    campos: [
      { nome: 'codigo', rotulo: 'Código do lote', col: 4, obrigatorio: true, listar: true, buscar: true },
      { nome: 'produto_id', rotulo: 'Produto', tipo: 'select', origem: 'produtos:descricao',
        col: 4, obrigatorio: true, listar: true },
      { nome: 'safra', rotulo: 'Safra', col: 4, listar: true, buscar: true },
      { nome: 'origem', rotulo: 'Origem / procedência', col: 6, buscar: true },
      { nome: 'data_entrada', rotulo: 'Data de entrada', tipo: 'data', col: 3, listar: true },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', col: 12 },
      { nome: 'ativo', rotulo: 'Lote ativo', tipo: 'checkbox', col: 3, padrao: true },
    ],
  })
);

// ---------------------------------------------------------------------------
// Frota e pessoas
// ---------------------------------------------------------------------------

router.use(
  criarCrud({
    tabela: 'veiculos',
    rota: 'veiculos',
    titulo: 'Veículos',
    singular: 'Veículo',
    permissao: 'cadastros',
    campoRotulo: 'placa',
    ordem: 'placa',
    colunaAtivo: false,
    colunasExtras: ['criado_por', 'atualizado_por'],
    campos: [
      { nome: 'placa', rotulo: 'Placa', tipo: 'placa', col: 3, obrigatorio: true, listar: true, buscar: true },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', col: 3, listar: true,
        opcoes: [
          { valor: 'CAVALO', texto: 'Cavalo mecânico' },
          { valor: 'CARRETA', texto: 'Carreta / semirreboque' },
          { valor: 'TRUCK', texto: 'Truck' },
          { valor: 'TOCO', texto: 'Toco' },
          { valor: 'BITREM', texto: 'Bitrem' },
          { valor: 'UTILITARIO', texto: 'Utilitário' },
          { valor: 'MAQUINA', texto: 'Máquina / equipamento' },
        ] },
      { nome: 'marca_modelo', rotulo: 'Marca / modelo', col: 4, listar: true, buscar: true },
      { nome: 'ano', rotulo: 'Ano', tipo: 'numero', col: 2 },
      { nome: 'capacidade_kg', rotulo: 'Capacidade (kg)', tipo: 'decimal', escala: 3, col: 3, listar: true },
      { nome: 'km_atual', rotulo: 'Quilometragem atual', tipo: 'decimal', escala: 2, col: 3 },
      { nome: 'combustivel_id', rotulo: 'Combustível', tipo: 'select',
        origem: 'tipos_combustivel:nome', col: 3 },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', col: 3, padrao: 'ATIVO', listar: true,
        opcoes: [
          { valor: 'ATIVO', texto: 'Ativo' },
          { valor: 'MANUTENCAO', texto: 'Em manutenção' },
          { valor: 'INATIVO', texto: 'Inativo' },
          { valor: 'VENDIDO', texto: 'Vendido' },
        ] },
      { nome: 'proprietario', rotulo: 'Proprietário (texto livre)', col: 4 },
      { nome: 'proprietario_id', rotulo: 'Proprietário cadastrado', tipo: 'select',
        origem: 'parceiros:razao_social', col: 4 },
      { nome: 'centro_custo_id', rotulo: 'Centro de custo', tipo: 'select',
        origem: 'centros_custo:nome', col: 4 },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', col: 12 },
    ],
  })
);

router.use(
  criarCrud({
    tabela: 'motoristas',
    rota: 'motoristas',
    titulo: 'Motoristas',
    singular: 'Motorista',
    permissao: 'cadastros',
    campoRotulo: 'nome',
    ordem: 'nome',
    colunasExtras: ['criado_por', 'atualizado_por'],
    campos: [
      { nome: 'nome', rotulo: 'Nome', col: 6, obrigatorio: true, listar: true, buscar: true },
      { nome: 'documento', rotulo: 'CPF / documento', col: 3, listar: true, buscar: true },
      { nome: 'telefone', rotulo: 'Telefone', col: 3, listar: true, buscar: true },
      { nome: 'vinculo', rotulo: 'Vínculo', tipo: 'select', col: 3, padrao: 'TERCEIRO',
        obrigatorio: true, listar: true,
        opcoes: [
          { valor: 'FUNCIONARIO', texto: 'Funcionário' },
          { valor: 'TERCEIRO', texto: 'Terceiro' },
          { valor: 'AGREGADO', texto: 'Agregado' },
        ] },
      { nome: 'funcionario_id', rotulo: 'Funcionário vinculado', tipo: 'select',
        origem: 'funcionarios:nome', col: 4,
        ajuda: 'Preencha quando o motorista estiver na folha de pagamento.' },
      { nome: 'transportadora_id', rotulo: 'Transportadora', tipo: 'select',
        origem: 'parceiros:razao_social:is_transportadora', col: 4 },
      { nome: 'cnh', rotulo: 'CNH', col: 3 },
      { nome: 'cnh_categoria', rotulo: 'Categoria', col: 2 },
      { nome: 'cnh_validade', rotulo: 'Validade da CNH', tipo: 'data', col: 3, listar: true },
      { nome: 'veiculo_padrao_id', rotulo: 'Veículo padrão', tipo: 'select',
        origem: 'veiculos:placa', col: 4 },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', col: 12 },
      { nome: 'ativo', rotulo: 'Motorista ativo', tipo: 'checkbox', col: 3, padrao: true },
    ],
  })
);

router.use(
  criarCrud({
    tabela: 'funcionarios',
    rota: 'funcionarios',
    titulo: 'Funcionários',
    singular: 'Funcionário',
    permissao: 'cadastros',
    campoRotulo: 'nome',
    ordem: 'nome',
    colunaAtivo: false,
    colunasExtras: ['criado_por', 'atualizado_por'],
    campos: [
      { nome: 'matricula', rotulo: 'Matrícula', col: 3, obrigatorio: true, listar: true, buscar: true },
      { nome: 'nome', rotulo: 'Nome', col: 6, obrigatorio: true, listar: true, buscar: true },
      { nome: 'cpf', rotulo: 'CPF', tipo: 'documento', col: 3, buscar: true },
      { nome: 'cargo', rotulo: 'Cargo', col: 4, listar: true, buscar: true },
      { nome: 'departamento', rotulo: 'Departamento', col: 4 },
      { nome: 'centro_custo_id', rotulo: 'Centro de custo', tipo: 'select',
        origem: 'centros_custo:nome', col: 4 },
      { nome: 'admissao', rotulo: 'Admissão', tipo: 'data', col: 3, listar: true },
      { nome: 'demissao', rotulo: 'Demissão', tipo: 'data', col: 3 },
      { nome: 'salario_base', rotulo: 'Salário-base', tipo: 'dinheiro', col: 3, listar: true },
      { nome: 'moeda_id', rotulo: 'Moeda', tipo: 'select', origem: 'moedas:codigo', col: 3 },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', col: 3, padrao: 'ATIVO',
        obrigatorio: true, listar: true,
        opcoes: [
          { valor: 'ATIVO', texto: 'Ativo' },
          { valor: 'FERIAS', texto: 'Em férias' },
          { valor: 'AFASTADO', texto: 'Afastado' },
          { valor: 'DESLIGADO', texto: 'Desligado' },
        ] },
      { nome: 'telefone', rotulo: 'Telefone', col: 3 },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email', col: 3 },
      { nome: 'endereco', rotulo: 'Endereço', col: 6 },
      { nome: 'banco_nome', rotulo: 'Banco', col: 3, grupo: 'Dados para pagamento' },
      { nome: 'banco_agencia', rotulo: 'Agência', col: 3, grupo: 'Dados para pagamento' },
      { nome: 'banco_conta', rotulo: 'Conta', col: 3, grupo: 'Dados para pagamento' },
      { nome: 'banco_pix', rotulo: 'Chave PIX', col: 3, grupo: 'Dados para pagamento' },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', col: 12 },
    ],
  })
);

// ---------------------------------------------------------------------------
// Tabelas de apoio
// ---------------------------------------------------------------------------

const apoio = [
  {
    rota: 'locais', tabela: 'locais_estoque', titulo: 'Locais de estoque', singular: 'Local',
    campoRotulo: 'nome', ordem: 'nome',
    campos: [
      { nome: 'codigo', rotulo: 'Código', col: 3, obrigatorio: true, listar: true, buscar: true },
      { nome: 'nome', rotulo: 'Nome', col: 6, obrigatorio: true, listar: true, buscar: true },
      { nome: 'endereco', rotulo: 'Endereço', col: 6 },
      { nome: 'cidade', rotulo: 'Cidade', col: 3, listar: true },
      { nome: 'uf', rotulo: 'UF / Departamento', col: 3, listar: true },
      { nome: 'pais_id', rotulo: 'País', tipo: 'select', origem: 'paises:nome', col: 3 },
      { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', col: 3, padrao: true },
    ],
  },
  {
    rota: 'contas-bancarias', tabela: 'contas_bancarias', titulo: 'Contas bancárias e caixa',
    singular: 'Conta', campoRotulo: 'nome', ordem: 'nome',
    campos: [
      { nome: 'codigo', rotulo: 'Código', col: 3, obrigatorio: true, listar: true, buscar: true },
      { nome: 'nome', rotulo: 'Nome', col: 5, obrigatorio: true, listar: true, buscar: true },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', col: 2, padrao: 'BANCO', obrigatorio: true, listar: true,
        opcoes: [{ valor: 'BANCO', texto: 'Banco' }, { valor: 'CAIXA', texto: 'Caixa' }] },
      { nome: 'moeda_id', rotulo: 'Moeda', tipo: 'select', origem: 'moedas:codigo', col: 2,
        obrigatorio: true, listar: true },
      { nome: 'banco', rotulo: 'Banco', col: 4, listar: true },
      { nome: 'agencia', rotulo: 'Agência', col: 2 },
      { nome: 'conta', rotulo: 'Conta', col: 3 },
      { nome: 'saldo_inicial', rotulo: 'Saldo inicial', tipo: 'dinheiro', col: 3,
        ajuda: 'Saldo na data de implantação. As movimentações partem daqui.' },
      { nome: 'data_saldo', rotulo: 'Data do saldo inicial', tipo: 'data', col: 3 },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', col: 12 },
      { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox', col: 3, padrao: true },
    ],
  },
  {
    rota: 'categorias', tabela: 'categorias_financeiras', titulo: 'Categorias financeiras',
    singular: 'Categoria', campoRotulo: 'nome', ordem: 'ordem_dre, nome',
    descricao: 'Classificam receitas e despesas e alimentam a DRE gerencial.',
    campos: [
      { nome: 'codigo', rotulo: 'Código', col: 3, obrigatorio: true, listar: true, buscar: true },
      { nome: 'nome', rotulo: 'Nome', col: 5, obrigatorio: true, listar: true, buscar: true },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', col: 2, obrigatorio: true, listar: true,
        opcoes: [{ valor: 'RECEITA', texto: 'Receita' }, { valor: 'DESPESA', texto: 'Despesa' }] },
      { nome: 'grupo_dre', rotulo: 'Grupo na DRE', tipo: 'select', col: 4, obrigatorio: true, listar: true,
        opcoes: [
          { valor: 'RECEITA_BRUTA', texto: 'Receita bruta' },
          { valor: 'DEDUCOES', texto: 'Deduções' },
          { valor: 'CUSTO_MERCADORIA', texto: 'Custo da mercadoria' },
          { valor: 'FRETES', texto: 'Fretes' },
          { valor: 'FUMIGACAO', texto: 'Fumigação' },
          { valor: 'CUSTOS_DIRETOS', texto: 'Custos diretos operacionais' },
          { valor: 'SALARIOS', texto: 'Salários e encargos' },
          { valor: 'ADMINISTRATIVAS', texto: 'Despesas administrativas' },
          { valor: 'MANUTENCAO', texto: 'Manutenção' },
          { valor: 'VEICULOS', texto: 'Despesas de veículos' },
          { valor: 'IMPOSTOS', texto: 'Impostos e despesas operacionais' },
          { valor: 'OUTRAS', texto: 'Outras receitas/despesas' },
        ] },
      { nome: 'ordem_dre', rotulo: 'Ordem na DRE', tipo: 'numero', col: 3 },
      { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox', col: 3, padrao: true },
    ],
  },
  {
    rota: 'centros-custo', tabela: 'centros_custo', titulo: 'Centros de custo', singular: 'Centro de custo',
    campoRotulo: 'nome', ordem: 'nome',
    campos: [
      { nome: 'codigo', rotulo: 'Código', col: 4, obrigatorio: true, listar: true, buscar: true },
      { nome: 'nome', rotulo: 'Nome', col: 8, obrigatorio: true, listar: true, buscar: true },
      { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', col: 3, padrao: true },
    ],
  },
  {
    rota: 'unidades', tabela: 'unidades_medida', titulo: 'Unidades de medida', singular: 'Unidade',
    campoRotulo: 'descricao', ordem: 'codigo',
    descricao: 'O estoque é sempre guardado em kg; o fator converte a unidade digitada.',
    campos: [
      { nome: 'codigo', rotulo: 'Código', col: 3, obrigatorio: true, listar: true, buscar: true },
      { nome: 'descricao', rotulo: 'Descrição', col: 5, obrigatorio: true, listar: true, buscar: true },
      { nome: 'fator_kg', rotulo: 'Equivale a quantos kg', tipo: 'decimal', escala: 6, col: 4,
        obrigatorio: true, listar: true,
        ajuda: 'Tonelada = 1000, saco de 60 kg = 60, quilo = 1.' },
      { nome: 'decimais', rotulo: 'Casas decimais', tipo: 'numero', col: 3, padrao: 3 },
      { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox', col: 3, padrao: true },
    ],
  },
  {
    rota: 'moedas', tabela: 'moedas', titulo: 'Moedas', singular: 'Moeda',
    campoRotulo: 'nome', ordem: 'codigo',
    campos: [
      { nome: 'codigo', rotulo: 'Código', col: 3, obrigatorio: true, listar: true, buscar: true },
      { nome: 'nome', rotulo: 'Nome', col: 5, obrigatorio: true, listar: true, buscar: true },
      { nome: 'simbolo', rotulo: 'Símbolo', col: 2, obrigatorio: true, listar: true },
      { nome: 'decimais', rotulo: 'Casas decimais', tipo: 'numero', col: 2, padrao: 2 },
      { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox', col: 3, padrao: true },
    ],
  },
  {
    rota: 'paises', tabela: 'paises', titulo: 'Países', singular: 'País',
    campoRotulo: 'nome', ordem: 'nome',
    campos: [
      { nome: 'codigo', rotulo: 'Código ISO', col: 3, obrigatorio: true, listar: true, buscar: true },
      { nome: 'nome', rotulo: 'Nome', col: 6, obrigatorio: true, listar: true, buscar: true },
      { nome: 'moeda_padrao', rotulo: 'Moeda padrão', col: 3, listar: true },
      { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', col: 3, padrao: true },
    ],
  },
  {
    rota: 'incoterms', tabela: 'incoterms', titulo: 'Incoterms', singular: 'Incoterm',
    campoRotulo: 'codigo', ordem: 'codigo',
    campos: [
      { nome: 'codigo', rotulo: 'Código', col: 3, obrigatorio: true, listar: true, buscar: true },
      { nome: 'descricao', rotulo: 'Descrição', col: 9, obrigatorio: true, listar: true, buscar: true },
      { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', col: 3, padrao: true },
    ],
  },
  {
    rota: 'formas-pagamento', tabela: 'formas_pagamento', titulo: 'Formas de pagamento',
    singular: 'Forma de pagamento', campoRotulo: 'nome', ordem: 'nome',
    campos: [
      { nome: 'codigo', rotulo: 'Código', col: 4, obrigatorio: true, listar: true, buscar: true },
      { nome: 'nome', rotulo: 'Nome', col: 8, obrigatorio: true, listar: true, buscar: true },
      { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox', col: 3, padrao: true },
    ],
  },
  {
    rota: 'condicoes-pagamento', tabela: 'condicoes_pagamento', titulo: 'Condições de pagamento',
    singular: 'Condição', campoRotulo: 'nome', ordem: 'dias_prazo',
    campos: [
      { nome: 'codigo', rotulo: 'Código', col: 3, obrigatorio: true, listar: true, buscar: true },
      { nome: 'nome', rotulo: 'Nome', col: 5, obrigatorio: true, listar: true, buscar: true },
      { nome: 'dias_prazo', rotulo: 'Prazo (dias)', tipo: 'numero', col: 2, listar: true },
      { nome: 'parcelas', rotulo: 'Parcelas', tipo: 'numero', col: 2, padrao: 1, listar: true },
      { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox', col: 3, padrao: true },
    ],
  },
  {
    rota: 'combustiveis', tabela: 'tipos_combustivel', titulo: 'Tipos de combustível',
    singular: 'Combustível', campoRotulo: 'nome', ordem: 'nome',
    campos: [
      { nome: 'codigo', rotulo: 'Código', col: 4, obrigatorio: true, listar: true, buscar: true },
      { nome: 'nome', rotulo: 'Nome', col: 8, obrigatorio: true, listar: true, buscar: true },
      { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', col: 3, padrao: true },
    ],
  },
];

for (const def of apoio) {
  router.use(criarCrud({ ...def, permissao: 'cadastros' }));
}

// ---------------------------------------------------------------------------
// Indice das tabelas de apoio
// ---------------------------------------------------------------------------

router.get('/', exigir('cadastros.visualizar'), async (req, res, next) => {
  try {
    const contagens = await muitos(`
      SELECT 'locais' AS rota, COUNT(*)::INT AS n FROM locais_estoque WHERE ativo
      UNION ALL SELECT 'contas-bancarias', COUNT(*)::INT FROM contas_bancarias WHERE ativo
      UNION ALL SELECT 'categorias', COUNT(*)::INT FROM categorias_financeiras WHERE ativo
      UNION ALL SELECT 'centros-custo', COUNT(*)::INT FROM centros_custo WHERE ativo
      UNION ALL SELECT 'unidades', COUNT(*)::INT FROM unidades_medida WHERE ativo
      UNION ALL SELECT 'moedas', COUNT(*)::INT FROM moedas WHERE ativo
      UNION ALL SELECT 'paises', COUNT(*)::INT FROM paises WHERE ativo
      UNION ALL SELECT 'incoterms', COUNT(*)::INT FROM incoterms WHERE ativo
      UNION ALL SELECT 'formas-pagamento', COUNT(*)::INT FROM formas_pagamento WHERE ativo
      UNION ALL SELECT 'condicoes-pagamento', COUNT(*)::INT FROM condicoes_pagamento WHERE ativo
      UNION ALL SELECT 'combustiveis', COUNT(*)::INT FROM tipos_combustivel WHERE ativo
      UNION ALL SELECT 'parceiros', COUNT(*)::INT FROM parceiros WHERE ativo
    `);
    const mapa = Object.fromEntries(contagens.map((c) => [c.rota, c.n]));

    res.render('cadastros/indice', {
      titulo: 'Tabelas de apoio',
      apoio: [
        { rota: 'parceiros', titulo: 'Todos os parceiros',
          descricao: 'Visão única de clientes, fornecedores, transportadoras e fumigadoras.' },
        ...apoio.map((a) => ({ rota: a.rota, titulo: a.titulo, descricao: a.descricao })),
      ],
      contagens: mapa,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
