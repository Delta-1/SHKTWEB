import { Router } from 'express';
import { um, muitos } from '../db/index.js';
import { exigir } from '../lib/auth.js';
import { hojeISO } from '../lib/formato.js';
import * as onboarding from '../services/onboarding.js';

const router = Router();

/**
 * Painel - somente leitura (secao 21).
 * Reune os numeros que a diretoria precisa ver ao abrir o sistema e os
 * alertas do que esta travando a operacao.
 */
router.get('/', exigir('dashboard.visualizar'), async (req, res, next) => {
  try {
    const hoje = hojeISO();
    const de = req.query.de || hoje.slice(0, 8) + '01';
    const ate = req.query.ate || hoje;

    const [estoque, fumigado, financeiro, exportacao, custoFumigacao, resultado] = await Promise.all([
      um(`SELECT COALESCE(SUM(fisico_kg),0)     AS fisico_kg,
                 COALESCE(SUM(disponivel_kg),0) AS disponivel_kg,
                 COALESCE(SUM(reservado_kg),0)  AS reservado_kg
            FROM vw_estoque_posicao`),

      um(`SELECT COALESCE(SUM(quantidade_kg - quantidade_certificada_kg),0) AS saldo_kg,
                 COALESCE(SUM(quantidade_kg),0)                             AS total_kg,
                 COUNT(*)::INT                                              AS lotes
            FROM fumigacoes WHERE status = 'VALIDADA'`),

      um(`SELECT
            COALESCE(SUM(valor - valor_liquidado) FILTER (WHERE tipo = 'CP'), 0) AS pagar,
            COALESCE(SUM(valor - valor_liquidado) FILTER (WHERE tipo = 'CR'), 0) AS receber,
            COALESCE(SUM(valor - valor_liquidado)
                     FILTER (WHERE tipo = 'CP' AND vencimento < CURRENT_DATE), 0) AS pagar_vencido,
            COALESCE(SUM(valor - valor_liquidado)
                     FILTER (WHERE tipo = 'CR' AND vencimento < CURRENT_DATE), 0) AS receber_vencido,
            COUNT(*) FILTER (WHERE vencimento < CURRENT_DATE)::INT AS qtd_vencidos
          FROM vw_titulos WHERE status IN ('ABERTO','PARCIAL')`),

      um(`SELECT COALESCE(SUM(quantidade_kg),0) AS kg, COUNT(*)::INT AS operacoes
            FROM carregamentos
           WHERE status = 'EXPEDIDO' AND data BETWEEN $1 AND $2`, [de, ate]),

      um(`SELECT COALESCE(SUM(valor_total),0) AS valor, COALESCE(SUM(quantidade_kg),0) AS kg
            FROM certificados_fumigacao
           WHERE status = 'VALIDADO' AND data BETWEEN $1 AND $2`, [de, ate]),

      um(`SELECT
            COALESCE(SUM(t.valor) FILTER (WHERE t.tipo = 'CR'), 0) AS receitas,
            COALESCE(SUM(t.valor) FILTER (WHERE t.tipo = 'CP'), 0) AS despesas
          FROM vw_titulos t
         WHERE COALESCE(t.emissao, CURRENT_DATE) BETWEEN $1 AND $2`, [de, ate]),
    ]);

    // Enquanto faltar configuração, a tela inicial mostra o que falta.
    const primeirosPassos = await onboarding.resumo();

    // Fase 2: o que o comercial deixou em aberto
    const comercial = await um(
      `SELECT
         (SELECT COUNT(*)::INT FROM pedidos_compra
           WHERE status = 'AGUARDANDO_APROVACAO')                       AS compras_aguardando,
         (SELECT COUNT(*)::INT FROM pedidos_venda
           WHERE status = 'AGUARDANDO_APROVACAO')                       AS vendas_aguardando,
         (SELECT COALESCE(SUM(i.quantidade_kg - i.recebido_kg), 0)
            FROM pedido_compra_itens i JOIN pedidos_compra p ON p.id = i.pedido_id
           WHERE p.status IN ('APROVADO','PARCIALMENTE_RECEBIDO'))::NUMERIC(18,3) AS a_receber_kg,
         (SELECT COALESCE(SUM(i.quantidade_kg - i.atendido_kg), 0)
            FROM pedido_venda_itens i JOIN pedidos_venda p ON p.id = i.pedido_id
           WHERE p.status IN ('APROVADO','PARCIALMENTE_ATENDIDO'))::NUMERIC(18,3) AS a_embarcar_kg,
         (SELECT COUNT(*)::INT FROM recebimentos WHERE status = 'RASCUNHO') AS recebimentos_pendentes`
    );

    const [saldosContas, vencidos, semComunicado, certificadosRascunho, estoqueBaixo, carregamentosAbertos] =
      await Promise.all([
        muitos('SELECT * FROM vw_contas_saldos WHERE ativo ORDER BY tipo DESC, nome'),

        muitos(
          `SELECT t.*, p.razao_social AS parceiro, m.simbolo AS moeda_simbolo,
                  (CURRENT_DATE - t.vencimento) AS dias_atraso
             FROM vw_titulos t
             LEFT JOIN parceiros p ON p.id = t.parceiro_id
             JOIN moedas m ON m.id = t.moeda_id
            WHERE t.status IN ('ABERTO','PARCIAL') AND t.vencimento < CURRENT_DATE
            ORDER BY t.vencimento
            LIMIT 8`
        ),

        muitos(
          `SELECT f.id, f.numero, f.quantidade_kg, f.criado_em, p.descricao AS produto
             FROM fumigacoes f JOIN produtos p ON p.id = f.produto_id
            WHERE f.status IN ('RASCUNHO','EM_ANDAMENTO','AGUARDANDO_COMUNICADO')
              AND (f.numero_comunicado IS NULL OR btrim(f.numero_comunicado) = '')
            ORDER BY f.criado_em LIMIT 8`
        ),

        muitos(
          `SELECT c.id, c.numero, c.quantidade_kg, c.valor_total, m.simbolo AS moeda_simbolo,
                  f.numero AS fumigacao_numero
             FROM certificados_fumigacao c
             JOIN moedas m ON m.id = c.moeda_id
             JOIN fumigacoes f ON f.id = c.fumigacao_id
            WHERE c.status = 'RASCUNHO'
            ORDER BY c.id LIMIT 8`
        ),

        muitos(
          `SELECT * FROM vw_estoque_posicao
            WHERE estoque_minimo_kg > 0 AND disponivel_kg < estoque_minimo_kg
            ORDER BY disponivel_kg LIMIT 8`
        ),

        muitos(
          `SELECT cg.id, cg.numero, cg.data, cg.quantidade_kg, cg.destino, cg.status,
                  p.descricao AS produto, cli.razao_social AS cliente
             FROM carregamentos cg
             JOIN produtos p ON p.id = cg.produto_id
             LEFT JOIN parceiros cli ON cli.id = cg.cliente_id
            WHERE cg.status IN ('RASCUNHO','PROGRAMADO','EM_CARREGAMENTO')
            ORDER BY cg.data, cg.id LIMIT 8`
        ),
      ]);

    res.render('painel', {
      titulo: 'Início',
      de,
      ate,
      estoque,
      fumigado,
      financeiro,
      exportacao,
      custoFumigacao,
      resultado,
      saldosContas,
      vencidos,
      semComunicado,
      certificadosRascunho,
      estoqueBaixo,
      carregamentosAbertos,
      comercial,
      primeirosPassos,
      alertaFumigacao: semComunicado.length,
      alertaVencidos: financeiro.qtd_vencidos,
      alertaCompras: comercial.compras_aguardando + comercial.recebimentos_pendentes,
      alertaVendas: comercial.vendas_aguardando,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
