/**
 * Catalogo de permissoes (RBAC).
 *
 * Cada permissao tem o formato "modulo.acao". A verificacao acontece SEMPRE
 * no back-end (middleware exigir()); esconder botoes no front e apenas
 * conforto visual, nunca a barreira de seguranca (secao 23).
 */

export const ACOES = {
  visualizar: 'Visualizar',
  criar: 'Criar',
  editar: 'Editar',
  aprovar: 'Aprovar / Validar',
  cancelar: 'Cancelar / Estornar',
  liquidar: 'Pagar / Receber',
  exportar: 'Exportar relatórios',
  administrar: 'Administrar',
};

/** Modulos do sistema e as acoes que fazem sentido em cada um. */
export const MODULOS = [
  {
    codigo: 'dashboard',
    nome: 'Painel',
    acoes: ['visualizar'],
  },
  {
    codigo: 'cadastros',
    nome: 'Cadastros',
    acoes: ['visualizar', 'criar', 'editar', 'cancelar'],
  },
  {
    codigo: 'estoque',
    nome: 'Estoque',
    acoes: ['visualizar', 'criar', 'aprovar', 'cancelar', 'exportar'],
  },
  {
    codigo: 'fumigacao',
    nome: 'Fumigação',
    acoes: ['visualizar', 'criar', 'editar', 'aprovar', 'cancelar', 'exportar'],
  },
  {
    codigo: 'certificados',
    nome: 'Certificados de Fumigação',
    acoes: ['visualizar', 'criar', 'editar', 'aprovar', 'cancelar', 'exportar'],
  },
  {
    codigo: 'carregamento',
    nome: 'Carregamento / Exportação',
    acoes: ['visualizar', 'criar', 'editar', 'aprovar', 'cancelar', 'exportar'],
  },
  {
    codigo: 'compras',
    nome: 'Compras e Recebimento',
    acoes: ['visualizar', 'criar', 'editar', 'aprovar', 'cancelar', 'exportar'],
  },
  {
    codigo: 'vendas',
    nome: 'Vendas',
    acoes: ['visualizar', 'criar', 'editar', 'aprovar', 'cancelar', 'exportar'],
  },
  {
    codigo: 'financeiro',
    nome: 'Financeiro',
    acoes: ['visualizar', 'criar', 'editar', 'aprovar', 'cancelar', 'liquidar', 'exportar'],
  },
  {
    codigo: 'caixa',
    nome: 'Caixa operacional',
    acoes: ['visualizar', 'criar', 'liquidar', 'cancelar', 'exportar'],
  },
  {
    codigo: 'frota',
    nome: 'SHKT Transportes / Frota',
    acoes: ['visualizar', 'criar', 'editar', 'aprovar', 'cancelar', 'exportar'],
  },
  {
    codigo: 'rh',
    nome: 'Recursos Humanos / Folha',
    acoes: ['visualizar', 'criar', 'editar', 'aprovar', 'cancelar', 'exportar'],
  },
  {
    codigo: 'impostos',
    nome: 'Impostos e Obrigações',
    acoes: ['visualizar', 'criar', 'editar', 'aprovar', 'cancelar', 'exportar'],
  },
  {
    codigo: 'importacoes',
    nome: 'Importação de planilhas',
    acoes: ['visualizar', 'criar', 'aprovar'],
  },
  {
    codigo: 'relatorios',
    nome: 'Relatórios',
    acoes: ['visualizar', 'exportar'],
  },
  {
    codigo: 'auditoria',
    nome: 'Auditoria',
    acoes: ['visualizar', 'exportar'],
  },
  {
    codigo: 'admin',
    nome: 'Administração (usuários, perfis, parâmetros)',
    acoes: ['visualizar', 'administrar'],
  },
];

/** Lista plana de todas as permissoes validas: ['estoque.criar', ...] */
export const TODAS_PERMISSOES = MODULOS.flatMap((m) => m.acoes.map((a) => `${m.codigo}.${a}`));

export function permissaoValida(p) {
  return TODAS_PERMISSOES.includes(p);
}

export function rotuloPermissao(p) {
  const [mod, acao] = p.split('.');
  const m = MODULOS.find((x) => x.codigo === mod);
  return `${m ? m.nome : mod} · ${ACOES[acao] || acao}`;
}

const todasDoModulo = (codigo) => {
  const m = MODULOS.find((x) => x.codigo === codigo);
  return m ? m.acoes.map((a) => `${codigo}.${a}`) : [];
};

const somenteLeitura = MODULOS.filter((m) => m.acoes.includes('visualizar')).map(
  (m) => `${m.codigo}.visualizar`
);

/**
 * Perfis iniciais sugeridos (secao 23). Sao criados pelo seed e podem ser
 * ajustados livremente na tela de Perfis.
 */
export const PERFIS_PADRAO = [
  {
    codigo: 'ADMIN',
    nome: 'Administrador',
    descricao: 'Acesso total ao sistema, incluindo usuários, perfis e parâmetros.',
    sistema: true,
    permissoes: TODAS_PERMISSOES,
  },
  {
    codigo: 'DIRETORIA',
    nome: 'Diretoria',
    descricao: 'Visão gerencial completa e aprovação de operações.',
    sistema: false,
    permissoes: [
      ...somenteLeitura,
      ...todasDoModulo('estoque'),
      ...todasDoModulo('fumigacao'),
      ...todasDoModulo('certificados'),
      ...todasDoModulo('carregamento'),
      ...todasDoModulo('compras'),
      ...todasDoModulo('vendas'),
      ...todasDoModulo('financeiro'),
      ...todasDoModulo('caixa'),
      ...todasDoModulo('frota'),
      ...todasDoModulo('rh'),
      ...todasDoModulo('impostos'),
      ...todasDoModulo('importacoes'),
      'relatorios.exportar',
      'auditoria.exportar',
    ],
  },
  {
    codigo: 'FINANCEIRO',
    nome: 'Financeiro',
    descricao: 'Contas a pagar e receber, caixa, bancos e baixas.',
    sistema: false,
    permissoes: [
      'dashboard.visualizar',
      'cadastros.visualizar',
      'cadastros.criar',
      'cadastros.editar',
      'estoque.visualizar',
      'fumigacao.visualizar',
      'certificados.visualizar',
      'carregamento.visualizar',
      'compras.visualizar',
      'compras.aprovar',
      'vendas.visualizar',
      'vendas.aprovar',
      ...todasDoModulo('financeiro'),
      ...todasDoModulo('caixa'),
      'frota.visualizar',
      'relatorios.visualizar',
      'relatorios.exportar',
    ],
  },
  {
    codigo: 'ESTOQUE',
    nome: 'Estoque / Pátio',
    descricao: 'Movimentações de estoque, recebimentos e carregamentos.',
    sistema: false,
    permissoes: [
      'dashboard.visualizar',
      'cadastros.visualizar',
      'estoque.visualizar',
      'estoque.criar',
      'estoque.exportar',
      'fumigacao.visualizar',
      'certificados.visualizar',
      'carregamento.visualizar',
      'carregamento.criar',
      'carregamento.editar',
      'carregamento.exportar',
      // O pátio recebe a mercadoria: lança o recebimento, mas não aprova compra
      'compras.visualizar',
      'compras.criar',
      'compras.editar',
      'compras.exportar',
      'vendas.visualizar',
      'frota.visualizar',
      'frota.criar',
      'frota.editar',
      'relatorios.visualizar',
    ],
  },
  {
    codigo: 'TRANSPORTES',
    nome: 'Transportadora / Motorista',
    descricao: 'Viagens, abastecimentos, despesas e consulta da frota.',
    sistema: false,
    permissoes: [
      'dashboard.visualizar',
      'cadastros.visualizar',
      'frota.visualizar',
      'frota.criar',
      'frota.editar',
      'relatorios.visualizar',
    ],
  },
  {
    codigo: 'COMPRAS',
    nome: 'Compras',
    descricao: 'Pedidos, recebimentos, fornecedores e importação de cadastros.',
    sistema: false,
    permissoes: [
      'dashboard.visualizar', 'cadastros.visualizar', 'cadastros.criar', 'cadastros.editar',
      ...todasDoModulo('compras'), 'estoque.visualizar', 'financeiro.visualizar',
      'relatorios.visualizar', ...todasDoModulo('importacoes'),
    ],
  },
  {
    codigo: 'VENDAS',
    nome: 'Vendas',
    descricao: 'Clientes, pedidos, carregamentos e recebimentos.',
    sistema: false,
    permissoes: [
      'dashboard.visualizar', 'cadastros.visualizar', 'cadastros.criar', 'cadastros.editar',
      ...todasDoModulo('vendas'), ...todasDoModulo('carregamento'),
      'financeiro.visualizar', 'caixa.visualizar', 'caixa.criar', 'caixa.liquidar',
      'relatorios.visualizar', ...todasDoModulo('importacoes'),
    ],
  },
  {
    codigo: 'RH',
    nome: 'Recursos Humanos',
    descricao: 'Funcionários, folha, provisões e relatórios de RH.',
    sistema: false,
    permissoes: [
      'dashboard.visualizar', 'cadastros.visualizar', 'cadastros.criar', 'cadastros.editar',
      ...todasDoModulo('rh'), 'financeiro.visualizar', 'relatorios.visualizar',
    ],
  },
  {
    codigo: 'FUMIGACAO',
    nome: 'Fumigação',
    descricao: 'Pedidos de fumigação, comunicados e certificados.',
    sistema: false,
    permissoes: [
      'dashboard.visualizar',
      'cadastros.visualizar',
      'estoque.visualizar',
      ...todasDoModulo('fumigacao'),
      ...todasDoModulo('certificados'),
      'carregamento.visualizar',
      'relatorios.visualizar',
      'relatorios.exportar',
    ],
  },
  {
    codigo: 'CONSULTA',
    nome: 'Consulta / Auditoria',
    descricao: 'Somente leitura em todos os módulos.',
    sistema: false,
    permissoes: [...somenteLeitura, 'relatorios.exportar', 'auditoria.exportar'],
  },
];

export default { MODULOS, ACOES, TODAS_PERMISSOES, PERFIS_PADRAO };
