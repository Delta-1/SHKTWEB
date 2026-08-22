import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { muitos, um, transacao } from '../db/index.js';
import { carregar } from '../lib/referencias.js';
import { hojeISO } from '../lib/formato.js';
import { registrar, ACOES } from '../lib/auditoria.js';

const router = Router();

/** Estrutura da DRE gerencial (secao 20). */
const ESTRUTURA_DRE = [
  { tipo: 'grupo', chave: 'RECEITA_BRUTA', rotulo: 'Receita bruta', sinal: 1 },
  { tipo: 'grupo', chave: 'DEDUCOES', rotulo: '(−) Deduções', sinal: -1 },
  { tipo: 'subtotal', rotulo: 'Receita líquida', ate: ['RECEITA_BRUTA', 'DEDUCOES'] },
  { tipo: 'grupo', chave: 'CUSTO_MERCADORIA', rotulo: '(−) Custo da mercadoria', sinal: -1 },
  { tipo: 'grupo', chave: 'FRETES', rotulo: '(−) Fretes', sinal: -1 },
  { tipo: 'grupo', chave: 'FUMIGACAO', rotulo: '(−) Fumigação', sinal: -1 },
  { tipo: 'grupo', chave: 'CUSTOS_DIRETOS', rotulo: '(−) Custos diretos operacionais', sinal: -1 },
  {
    tipo: 'subtotal',
    rotulo: 'Margem bruta',
    ate: ['RECEITA_BRUTA', 'DEDUCOES', 'CUSTO_MERCADORIA', 'FRETES', 'FUMIGACAO', 'CUSTOS_DIRETOS'],
    destaque: true,
  },
  { tipo: 'grupo', chave: 'SALARIOS', rotulo: '(−) Salários e encargos', sinal: -1 },
  { tipo: 'grupo', chave: 'ADMINISTRATIVAS', rotulo: '(−) Despesas administrativas', sinal: -1 },
  { tipo: 'grupo', chave: 'MANUTENCAO', rotulo: '(−) Manutenção', sinal: -1 },
  { tipo: 'grupo', chave: 'VEICULOS', rotulo: '(−) Despesas de veículos', sinal: -1 },
  { tipo: 'grupo', chave: 'IMPOSTOS', rotulo: '(−) Impostos e despesas operacionais', sinal: -1 },
  {
    tipo: 'subtotal',
    rotulo: 'Resultado operacional',
    ate: ['RECEITA_BRUTA', 'DEDUCOES', 'CUSTO_MERCADORIA', 'FRETES', 'FUMIGACAO', 'CUSTOS_DIRETOS',
          'SALARIOS', 'ADMINISTRATIVAS', 'MANUTENCAO', 'VEICULOS', 'IMPOSTOS'],
    destaque: true,
  },
  { tipo: 'grupo', chave: 'OUTRAS', rotulo: '(+/−) Outras receitas e despesas', sinal: null },
  { tipo: 'total', rotulo: 'Resultado do período' },
];

const periodo = (req) => ({
  de: req.query.de || hojeISO().slice(0, 8) + '01',
  ate: req.query.ate || hojeISO(),
});

// --------------------------------------------------------------- indice
router.get('/', exigir('relatorios.visualizar'), (req, res) => {
  res.render('relatorios/indice', {
    titulo: 'Relatórios',
    ...periodo(req),
    relatorios: [
      { url: '/relatorios/dre', nome: 'DRE gerencial',
        descricao: 'Resultado do período por grupo, com filtros de centro de custo.' },
      { url: '/relatorios/estoque', nome: 'Posição e movimentação de estoque',
        descricao: 'Saldo por produto, local e lote, com histórico de movimentos.' },
      { url: '/relatorios/fumigacao', nome: 'Fumigações e saldo fumigado',
        descricao: 'Fumigações do período, quantidade certificada e saldo disponível.' },
      { url: '/relatorios/certificados', nome: 'Certificados de fumigação',
        descricao: 'Certificados emitidos, custo por tonelada e vínculo financeiro.' },
      { url: '/relatorios/carregamentos', nome: 'Carregamentos e exportações',
        descricao: 'Operações expedidas por cliente, produto e destino.' },
      { url: '/relatorios/financeiro', nome: 'Contas a pagar e receber',
        descricao: 'Títulos por vencimento, situação e categoria.' },
      { url: '/relatorios/fluxo-caixa', nome: 'Fluxo de caixa',
        descricao: 'Entradas e saídas realizadas por conta e por dia.' },
      { url: '/relatorios/compras', nome: 'Compras',
        descricao: 'Pedidos por fornecedor, situação e valor.' },
      { url: '/relatorios/vendas', nome: 'Vendas',
        descricao: 'Pedidos por cliente, situação e valor.' },
      { url: '/relatorios/combustivel', nome: 'Combustível e consumo',
        descricao: 'Abastecimentos, litros, custo e veículo.' },
      { url: '/relatorios/viagens', nome: 'Viagens e margem',
        descricao: 'Frete, custos diretos, margem e consumo por viagem.' },
      { url: '/relatorios/manutencao', nome: 'Manutenção da frota',
        descricao: 'Ordens, custos, veículo e situação.' },
      { url: '/relatorios/rh', nome: 'Folha e RH',
        descricao: 'Líquido por funcionário e competência.' },
      { url: '/relatorios/obrigacoes', nome: 'Obrigações',
        descricao: 'Agenda fiscal, operacional, trabalhista e de exportação.' },
    ],
  });
});

// ------------------------------------------------------------------ DRE
router.get('/dre', exigir('relatorios.visualizar'), async (req, res, next) => {
  try {
    const { de, ate } = periodo(req);
    const centroCustoId = req.query.centro || null;

    const linhas = await muitos(
      `SELECT cat.grupo_dre, cat.nome AS categoria, cat.tipo,
              COALESCE(SUM(t.valor_base_brl), 0) AS total
         FROM vw_titulos t
         JOIN categorias_financeiras cat ON cat.id = t.categoria_id
        WHERE COALESCE(t.emissao, CURRENT_DATE) BETWEEN $1 AND $2
          AND ($3::BIGINT IS NULL OR t.centro_custo_id = $3)
        GROUP BY cat.grupo_dre, cat.nome, cat.tipo, cat.ordem_dre
        ORDER BY cat.ordem_dre, cat.nome`,
      [de, ate, centroCustoId]
    );

    const semCategoria = await um(
      `SELECT COUNT(*)::INT AS n, COALESCE(SUM(valor_base_brl), 0) AS total
         FROM vw_titulos
        WHERE categoria_id IS NULL AND COALESCE(emissao, CURRENT_DATE) BETWEEN $1 AND $2`,
      [de, ate]
    );

    const porGrupo = {};
    for (const l of linhas) {
      porGrupo[l.grupo_dre] ??= { total: 0, categorias: [] };
      const valor = Number(l.total);
      porGrupo[l.grupo_dre].total += valor;
      porGrupo[l.grupo_dre].categorias.push({ nome: l.categoria, tipo: l.tipo, total: valor });
    }

    // Aplica o sinal de cada grupo para montar os subtotais
    const valorGrupo = (chave) => {
      const g = porGrupo[chave];
      if (!g) return 0;
      const linha = ESTRUTURA_DRE.find((x) => x.chave === chave);
      if (linha?.sinal === null) {
        // Grupo misto (OUTRAS): receitas somam, despesas subtraem
        return g.categorias.reduce(
          (s, c) => s + (c.tipo === 'RECEITA' ? c.total : -c.total),
          0
        );
      }
      return g.total * (linha?.sinal ?? 1);
    };

    const ref = await carregar(['centrosCusto']);

    res.render('relatorios/dre', {
      titulo: 'DRE gerencial',
      de,
      ate,
      centroCustoId,
      ref,
      estrutura: ESTRUTURA_DRE,
      porGrupo,
      valorGrupo,
      semCategoria,
    });
  } catch (e) {
    next(e);
  }
});

// -------------------------------------------------------------- estoque
router.get('/estoque', exigir('relatorios.visualizar'), async (req, res, next) => {
  try {
    const posicao = await muitos('SELECT * FROM vw_estoque_posicao ORDER BY produto_descricao, local_nome');
    res.render('relatorios/tabela', {
      titulo: 'Posição de estoque',
      subtitulo: `Emitido em ${new Date().toLocaleString('pt-BR')}`,
      colunas: [
        { chave: 'produto_descricao', rotulo: 'Produto' },
        { chave: 'local_nome', rotulo: 'Local' },
        { chave: 'lote_codigo', rotulo: 'Lote' },
        { chave: 'fisico_kg', rotulo: 'Físico (t)', tipo: 'toneladas' },
        { chave: 'reservado_kg', rotulo: 'Reservado (t)', tipo: 'toneladas' },
        { chave: 'disponivel_kg', rotulo: 'Disponível (t)', tipo: 'toneladas' },
        { chave: 'fumigado_saldo_kg', rotulo: 'Fumigado (t)', tipo: 'toneladas' },
        { chave: 'expedido_kg', rotulo: 'Expedido (t)', tipo: 'toneladas' },
      ],
      linhas: posicao,
      totalizar: ['fisico_kg', 'reservado_kg', 'disponivel_kg', 'fumigado_saldo_kg', 'expedido_kg'],
      voltar: '/relatorios',
    });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------- fumigacao
router.get('/fumigacao', exigir('relatorios.visualizar'), async (req, res, next) => {
  try {
    const { de, ate } = periodo(req);
    const linhas = await muitos(
      `SELECT f.numero, f.numero_comunicado, p.razao_social AS fumigadora,
              pr.descricao AS produto, f.status,
              f.data_hora_inicio, f.data_hora_termino,
              f.quantidade_kg, f.quantidade_certificada_kg,
              f.quantidade_kg - f.quantidade_certificada_kg AS saldo_kg
         FROM fumigacoes f
         JOIN parceiros p ON p.id = f.fumigadora_id
         JOIN produtos pr ON pr.id = f.produto_id
        WHERE COALESCE(f.data_hora_inicio::DATE, f.criado_em::DATE) BETWEEN $1 AND $2
        ORDER BY f.id`,
      [de, ate]
    );

    res.render('relatorios/tabela', {
      titulo: 'Fumigações e saldo fumigado',
      subtitulo: `Período de ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}`,
      periodo: { de, ate },
      colunas: [
        { chave: 'numero', rotulo: 'Nº', tipo: 'mono' },
        { chave: 'numero_comunicado', rotulo: 'Comunicado', tipo: 'mono' },
        { chave: 'fumigadora', rotulo: 'Fumigadora' },
        { chave: 'produto', rotulo: 'Produto' },
        { chave: 'data_hora_termino', rotulo: 'Término', tipo: 'dataHora' },
        { chave: 'status', rotulo: 'Situação', tipo: 'status' },
        { chave: 'quantidade_kg', rotulo: 'Fumigado (t)', tipo: 'toneladas' },
        { chave: 'quantidade_certificada_kg', rotulo: 'Certificado (t)', tipo: 'toneladas' },
        { chave: 'saldo_kg', rotulo: 'Saldo (t)', tipo: 'toneladas' },
      ],
      linhas,
      totalizar: ['quantidade_kg', 'quantidade_certificada_kg', 'saldo_kg'],
      voltar: '/relatorios',
    });
  } catch (e) {
    next(e);
  }
});

// ----------------------------------------------------------- certificados
router.get('/certificados', exigir('relatorios.visualizar'), async (req, res, next) => {
  try {
    const { de, ate } = periodo(req);
    const linhas = await muitos(
      `SELECT c.numero, c.numero_certificado, f.numero AS fumigacao,
              p.razao_social AS fumigadora, c.data, c.status,
              c.quantidade_kg, c.custo_tonelada, c.valor_total,
              cp.numero AS conta_pagar, cp.status AS situacao_pagamento
         FROM certificados_fumigacao c
         JOIN fumigacoes f ON f.id = c.fumigacao_id
         JOIN parceiros p ON p.id = c.fumigadora_id
         LEFT JOIN contas_pagar cp ON cp.id = c.conta_pagar_id
        WHERE c.data BETWEEN $1 AND $2
        ORDER BY c.data, c.id`,
      [de, ate]
    );

    res.render('relatorios/tabela', {
      titulo: 'Certificados de fumigação',
      subtitulo: `Período de ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}`,
      periodo: { de, ate },
      colunas: [
        { chave: 'numero', rotulo: 'Nº interno', tipo: 'mono' },
        { chave: 'numero_certificado', rotulo: 'Certificado', tipo: 'mono' },
        { chave: 'fumigacao', rotulo: 'Fumigação', tipo: 'mono' },
        { chave: 'fumigadora', rotulo: 'Fumigadora' },
        { chave: 'data', rotulo: 'Data', tipo: 'data' },
        { chave: 'status', rotulo: 'Situação', tipo: 'status' },
        { chave: 'quantidade_kg', rotulo: 'Qtd. (t)', tipo: 'toneladas' },
        { chave: 'custo_tonelada', rotulo: 'Custo/t', tipo: 'dinheiro' },
        { chave: 'valor_total', rotulo: 'Valor', tipo: 'dinheiro' },
        { chave: 'conta_pagar', rotulo: 'Título', tipo: 'mono' },
        { chave: 'situacao_pagamento', rotulo: 'Pagamento', tipo: 'status' },
      ],
      linhas,
      totalizar: ['quantidade_kg', 'valor_total'],
      voltar: '/relatorios',
    });
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------------- carregamentos
router.get('/carregamentos', exigir('relatorios.visualizar'), async (req, res, next) => {
  try {
    const { de, ate } = periodo(req);
    const linhas = await muitos(
      `SELECT cg.numero, cg.data, cli.razao_social AS cliente, pr.descricao AS produto,
              cg.destino, cg.placa, cg.status, cg.quantidade_kg,
              ce.numero_certificado AS certificado
         FROM carregamentos cg
         LEFT JOIN parceiros cli ON cli.id = cg.cliente_id
         JOIN produtos pr ON pr.id = cg.produto_id
         LEFT JOIN certificados_fumigacao ce ON ce.id = cg.certificado_id
        WHERE cg.data BETWEEN $1 AND $2
        ORDER BY cg.data, cg.id`,
      [de, ate]
    );

    res.render('relatorios/tabela', {
      titulo: 'Carregamentos e exportações',
      subtitulo: `Período de ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}`,
      periodo: { de, ate },
      colunas: [
        { chave: 'numero', rotulo: 'Nº', tipo: 'mono' },
        { chave: 'data', rotulo: 'Data', tipo: 'data' },
        { chave: 'cliente', rotulo: 'Cliente' },
        { chave: 'produto', rotulo: 'Produto' },
        { chave: 'destino', rotulo: 'Destino' },
        { chave: 'placa', rotulo: 'Placa', tipo: 'mono' },
        { chave: 'certificado', rotulo: 'Certificado', tipo: 'mono' },
        { chave: 'status', rotulo: 'Situação', tipo: 'status' },
        { chave: 'quantidade_kg', rotulo: 'Qtd. (t)', tipo: 'toneladas' },
      ],
      linhas,
      totalizar: ['quantidade_kg'],
      voltar: '/relatorios',
    });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------------------------ financeiro
router.get('/financeiro', exigir('relatorios.visualizar'), async (req, res, next) => {
  try {
    const { de, ate } = periodo(req);
    const linhas = await muitos(
      `SELECT t.tipo, t.numero, t.descricao, p.razao_social AS parceiro,
              cat.nome AS categoria, m.codigo AS moeda, t.emissao, t.vencimento, t.valor,
              t.valor_base_brl, t.valor_liquidado_brl, t.saldo_brl, t.status
         FROM vw_titulos t
         JOIN moedas m ON m.id=t.moeda_id
         LEFT JOIN parceiros p ON p.id = t.parceiro_id
         LEFT JOIN categorias_financeiras cat ON cat.id = t.categoria_id
        WHERE t.vencimento BETWEEN $1 AND $2
        ORDER BY t.vencimento, t.tipo, t.numero`,
      [de, ate]
    );

    res.render('relatorios/tabela', {
      titulo: 'Contas a pagar e receber',
      subtitulo: `Vencimentos de ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}`,
      periodo: { de, ate },
      colunas: [
        { chave: 'tipo', rotulo: 'Tipo' },
        { chave: 'numero', rotulo: 'Nº', tipo: 'mono' },
        { chave: 'descricao', rotulo: 'Descrição' },
        { chave: 'parceiro', rotulo: 'Parceiro' },
        { chave: 'categoria', rotulo: 'Categoria' },
        { chave: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
        { chave: 'moeda', rotulo: 'Moeda' },
        { chave: 'valor', rotulo: 'Valor', tipo: 'dinheiro' },
        { chave: 'valor_base_brl', rotulo: 'Valor em BRL', tipo: 'dinheiro' },
        { chave: 'valor_liquidado_brl', rotulo: 'Liquidado BRL', tipo: 'dinheiro' },
        { chave: 'saldo_brl', rotulo: 'Saldo BRL', tipo: 'dinheiro' },
        { chave: 'status', rotulo: 'Situação', tipo: 'status' },
      ],
      linhas,
      totalizar: ['valor_base_brl', 'valor_liquidado_brl', 'saldo_brl'],
      voltar: '/relatorios',
    });
  } catch (e) {
    next(e);
  }
});

// ----------------------------------------------------------- fluxo caixa
router.get('/fluxo-caixa', exigir('relatorios.visualizar'), async (req, res, next) => {
  try {
    const { de, ate } = periodo(req);
    const linhas = await muitos(
      `SELECT cm.data, cb.nome AS conta, cm.historico,
              CASE WHEN cm.tipo = 'ENTRADA' THEN cm.valor ELSE 0 END AS entrada,
              CASE WHEN cm.tipo = 'SAIDA'   THEN cm.valor ELSE 0 END AS saida
         FROM caixa_movimentos cm
         JOIN contas_bancarias cb ON cb.id = cm.conta_bancaria_id
        WHERE NOT cm.estornado AND cm.data BETWEEN $1 AND $2
        ORDER BY cm.data, cm.id`,
      [de, ate]
    );

    res.render('relatorios/tabela', {
      titulo: 'Fluxo de caixa',
      subtitulo: `Período de ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}`,
      periodo: { de, ate },
      colunas: [
        { chave: 'data', rotulo: 'Data', tipo: 'data' },
        { chave: 'conta', rotulo: 'Conta' },
        { chave: 'historico', rotulo: 'Histórico' },
        { chave: 'entrada', rotulo: 'Entrada', tipo: 'dinheiro' },
        { chave: 'saida', rotulo: 'Saída', tipo: 'dinheiro' },
      ],
      linhas,
      totalizar: ['entrada', 'saida'],
      voltar: '/relatorios',
    });
  } catch (e) {
    next(e);
  }
});

// ------------------------------------------ relatorios dos modulos finais
const rotasModulares = {
  compras: {
    titulo: 'Compras por fornecedor',
    sql: `SELECT pc.numero,pc.data,p.razao_social AS fornecedor,pc.tipo,pc.moeda,
                 pc.valor_total,pc.previsao_entrega,pc.status FROM pedidos_compra pc
            JOIN parceiros p ON p.id=pc.fornecedor_id WHERE pc.data BETWEEN $1 AND $2 ORDER BY pc.data,pc.id`,
    colunas: [['numero','Nº','mono'],['data','Data','data'],['fornecedor','Fornecedor'],['tipo','Tipo'],
      ['moeda','Moeda'],['valor_total','Valor','dinheiro'],['previsao_entrega','Entrega','data'],['status','Situação','status']],
    totais:['valor_total'],
  },
  vendas: {
    titulo: 'Vendas por cliente',
    sql: `SELECT pv.numero,pv.data,p.razao_social AS cliente,pv.destino,pv.moeda,pv.valor_total,
                 pv.previsao_embarque,pv.status FROM pedidos_venda pv JOIN parceiros p ON p.id=pv.cliente_id
            WHERE pv.data BETWEEN $1 AND $2 ORDER BY pv.data,pv.id`,
    colunas: [['numero','Nº','mono'],['data','Data','data'],['cliente','Cliente'],['destino','Destino'],
      ['moeda','Moeda'],['valor_total','Valor','dinheiro'],['previsao_embarque','Embarque','data'],['status','Situação','status']],
    totais:['valor_total'],
  },
  combustivel: {
    titulo: 'Combustível e consumo',
    sql: `SELECT a.numero,a.data,v.placa,m.nome AS motorista,t.nome AS combustivel,a.quantidade_litros,
                 a.preco_litro,a.valor_total,a.quilometragem,a.status FROM abastecimentos a
            JOIN veiculos v ON v.id=a.veiculo_id LEFT JOIN motoristas m ON m.id=a.motorista_id
            JOIN tipos_combustivel t ON t.id=a.combustivel_id WHERE a.data BETWEEN $1 AND $2 ORDER BY a.data,a.id`,
    colunas: [['numero','Nº','mono'],['data','Data','data'],['placa','Placa','mono'],['motorista','Motorista'],
      ['combustivel','Combustível'],['quantidade_litros','Litros'],['preco_litro','Preço/l','dinheiro'],
      ['valor_total','Total','dinheiro'],['quilometragem','Km'],['status','Situação','status']],
    totais:['valor_total'],
  },
  viagens: {
    titulo: 'Viagens, margem e consumo',
    sql: `SELECT r.numero,r.data_saida_prevista,v.placa,m.nome AS motorista,r.origem,r.destino,
                 r.receita_prevista,r.custo_direto,r.margem_prevista,r.distancia_km,r.km_litro,r.status
            FROM vw_viagens_resultado r JOIN veiculos v ON v.id=r.veiculo_id JOIN motoristas m ON m.id=r.motorista_id
           WHERE r.data_saida_prevista BETWEEN $1 AND $2 ORDER BY r.data_saida_prevista,r.id`,
    colunas: [['numero','Nº','mono'],['data_saida_prevista','Saída','data'],['placa','Placa','mono'],['motorista','Motorista'],
      ['origem','Origem'],['destino','Destino'],['receita_prevista','Frete','dinheiro'],['custo_direto','Custos','dinheiro'],
      ['margem_prevista','Margem','dinheiro'],['distancia_km','Km'],['km_litro','Km/l'],['status','Situação','status']],
    totais:['receita_prevista','custo_direto','margem_prevista'],
  },
  manutencao: {
    titulo: 'Manutenção da frota',
    sql: `SELECT o.numero,o.data,v.placa,o.tipo,o.descricao,p.razao_social AS oficina,o.valor_total,
                 o.previsao_conclusao,o.status FROM ordens_manutencao o JOIN veiculos v ON v.id=o.veiculo_id
            LEFT JOIN parceiros p ON p.id=o.oficina_id WHERE o.data BETWEEN $1 AND $2 ORDER BY o.data,o.id`,
    colunas: [['numero','Nº','mono'],['data','Data','data'],['placa','Placa','mono'],['tipo','Tipo'],['descricao','Descrição'],
      ['oficina','Oficina'],['valor_total','Valor','dinheiro'],['previsao_conclusao','Previsão','data'],['status','Situação','status']],
    totais:['valor_total'],
  },
  rh: {
    titulo: 'Folha por funcionário',
    sql: `SELECT f.numero,f.competencia,fu.matricula,fu.nome AS funcionario,i.total_proventos,i.total_descontos,
                 i.valor_liquido,cp.numero AS conta_pagar,cp.status AS pagamento,f.status
            FROM folhas_competencia f JOIN folha_funcionarios i ON i.folha_id=f.id
            JOIN funcionarios fu ON fu.id=i.funcionario_id LEFT JOIN contas_pagar cp ON cp.id=i.conta_pagar_id
           WHERE f.competencia BETWEEN $1 AND $2 ORDER BY f.competencia,fu.nome`,
    colunas: [['numero','Folha','mono'],['competencia','Competência','data'],['matricula','Matrícula','mono'],
      ['funcionario','Funcionário'],['total_proventos','Proventos','dinheiro'],['total_descontos','Descontos','dinheiro'],
      ['valor_liquido','Líquido','dinheiro'],['conta_pagar','Título','mono'],['pagamento','Pagamento','status'],['status','Folha','status']],
    totais:['total_proventos','total_descontos','valor_liquido'],
  },
  obrigacoes: {
    titulo: 'Agenda de obrigações',
    sql: `SELECT o.numero,t.natureza,t.nome AS tipo,o.descricao,o.competencia,o.vencimento,m.codigo AS moeda,
                 o.valor,o.valor*o.taxa_cambio AS valor_brl,o.status FROM obrigacoes o
            JOIN tipos_obrigacao t ON t.id=o.tipo_id JOIN moedas m ON m.id=o.moeda_id
           WHERE o.vencimento BETWEEN $1 AND $2 ORDER BY o.vencimento,o.id`,
    colunas: [['numero','Nº','mono'],['natureza','Natureza'],['tipo','Tipo'],['descricao','Descrição'],
      ['competencia','Competência','data'],['vencimento','Vencimento','data'],['moeda','Moeda'],['valor','Valor','dinheiro'],
      ['valor_brl','Em BRL','dinheiro'],['status','Situação','status']], totais:['valor_brl'],
  },
};

for (const [rota,def] of Object.entries(rotasModulares)) {
  router.get(`/${rota}`, exigir('relatorios.visualizar'), async (req,res,next)=>{try{
    const {de,ate}=periodo(req);const linhas=await muitos(def.sql,[de,ate]);
    res.render('relatorios/tabela',{titulo:def.titulo,subtitulo:`Período de ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}`,
      periodo:{de,ate},colunas:def.colunas.map(([chave,rotulo,tipo])=>({chave,rotulo,tipo})),linhas,totalizar:def.totais,voltar:'/relatorios'});
  }catch(e){next(e);}});
}

// -------------------------------------------------- exportacao para CSV
router.get('/:relatorio/csv', exigir('relatorios.exportar'), async (req, res, next) => {
  try {
    const mapa = {
      estoque: {
        sql: `SELECT produto_codigo AS "Código", produto_descricao AS "Produto",
                     local_nome AS "Local", lote_codigo AS "Lote",
                     fisico_kg AS "Físico (kg)", reservado_kg AS "Reservado (kg)",
                     disponivel_kg AS "Disponível (kg)", fumigado_saldo_kg AS "Fumigado (kg)"
                FROM vw_estoque_posicao ORDER BY produto_descricao`,
        params: [],
      },
      fumigacao: {
        sql: `SELECT f.numero AS "Nº", f.numero_comunicado AS "Comunicado",
                     p.razao_social AS "Fumigadora", pr.descricao AS "Produto",
                     f.status AS "Situação", f.quantidade_kg AS "Fumigado (kg)",
                     f.quantidade_certificada_kg AS "Certificado (kg)",
                     f.quantidade_kg - f.quantidade_certificada_kg AS "Saldo (kg)"
                FROM fumigacoes f
                JOIN parceiros p ON p.id = f.fumigadora_id
                JOIN produtos pr ON pr.id = f.produto_id
               ORDER BY f.id`,
        params: [],
      },
      certificados: {
        sql: `SELECT c.numero AS "Nº interno", c.numero_certificado AS "Certificado",
                     f.numero AS "Fumigação", p.razao_social AS "Fumigadora",
                     c.data AS "Data", c.quantidade_kg AS "Quantidade (kg)",
                     c.custo_tonelada AS "Custo/t", c.valor_total AS "Valor",
                     c.status AS "Situação"
                FROM certificados_fumigacao c
                JOIN fumigacoes f ON f.id = c.fumigacao_id
                JOIN parceiros p ON p.id = c.fumigadora_id
               ORDER BY c.id`,
        params: [],
      },
      carregamentos: {
        sql: `SELECT cg.numero AS "Nº", cg.data AS "Data", cli.razao_social AS "Cliente",
                     pr.descricao AS "Produto", cg.destino AS "Destino", cg.placa AS "Placa",
                     cg.quantidade_kg AS "Quantidade (kg)", cg.status AS "Situação"
                FROM carregamentos cg
                LEFT JOIN parceiros cli ON cli.id = cg.cliente_id
                JOIN produtos pr ON pr.id = cg.produto_id
               ORDER BY cg.id`,
        params: [],
      },
      financeiro: {
        sql: `SELECT t.tipo AS "Tipo", t.numero AS "Nº", t.descricao AS "Descrição",
                     p.razao_social AS "Parceiro", t.emissao AS "Emissão",
                     t.vencimento AS "Vencimento", t.valor AS "Valor",
                     t.valor_liquidado AS "Liquidado", t.saldo AS "Saldo", t.status AS "Situação"
                FROM vw_titulos t
                LEFT JOIN parceiros p ON p.id = t.parceiro_id
               ORDER BY t.vencimento`,
        params: [],
      },
    };

    let def = mapa[req.params.relatorio];
    if (!def && rotasModulares[req.params.relatorio]) {
      const { de, ate } = periodo(req);
      def = { sql: rotasModulares[req.params.relatorio].sql, params: [de, ate] };
    }
    if (!def) return next();

    const linhas = await muitos(def.sql, def.params);

    await transacao((cx) =>
      registrar(cx, {
        usuario: req.usuario,
        acao: ACOES.EXPORTAR,
        modulo: 'relatorios',
        descricao: `Exportação do relatório "${req.params.relatorio}" (${linhas.length} linha(s)).`,
        ip: req.ip,
        sessao: req.sessionID,
      })
    );

    // CSV com ; e BOM: abre direto no Excel em português sem bagunçar acentos
    const colunas = linhas.length ? Object.keys(linhas[0]) : [];
    const escapar = (v) => {
      if (v === null || v === undefined) return '';
      const texto = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      return `"${texto.replace(/"/g, '""')}"`;
    };
    const csv = [
      colunas.join(';'),
      ...linhas.map((l) => colunas.map((c) => escapar(l[c])).join(';')),
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="shkt-${req.params.relatorio}-${hojeISO()}.csv"`
    );
    res.send('﻿' + csv);
  } catch (e) {
    next(e);
  }
});

export default router;
