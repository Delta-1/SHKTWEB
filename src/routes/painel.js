import { Router } from 'express';
import { um, muitos } from '../db/index.js';
import { exigir } from '../lib/auth.js';
import { hojeISO, somarDias } from '../lib/formato.js';
import * as onboarding from '../services/onboarding.js';
import * as panoramaSvc from '../services/panorama.js';

const router = Router();

/**
 * Panorama do grupo — a tela inicial.
 *
 * Responde, nesta ordem: quanto entrou e quanto saiu de cada operação,
 * o que está travando alguém, e o extrato linha a linha de onde esses
 * números vieram.
 */

/** Atalhos de período: quase sempre é um destes. */
function periodos(de, ate) {
  const hoje = hojeISO();
  const mes = hoje.slice(0, 8);
  const inicioMes = `${mes}01`;

  const mesPassado = new Date(`${inicioMes}T12:00:00Z`);
  mesPassado.setUTCMonth(mesPassado.getUTCMonth() - 1);
  const inicioMesPassado = mesPassado.toISOString().slice(0, 10);
  const fimMesPassado = somarDias(inicioMes, -1);

  const opcoes = [
    { nome: 'Hoje', de: hoje, ate: hoje },
    { nome: '7 dias', de: somarDias(hoje, -6), ate: hoje },
    { nome: 'Este mês', de: inicioMes, ate: hoje },
    { nome: 'Mês passado', de: inicioMesPassado, ate: fimMesPassado },
    { nome: 'Este ano', de: `${hoje.slice(0, 4)}-01-01`, ate: hoje },
  ];

  return opcoes.map((o) => ({ ...o, ativo: o.de === de && o.ate === ate }));
}

router.get('/', exigir('dashboard.visualizar'), async (req, res, next) => {
  try {
    const hoje = hojeISO();
    const de = req.query.de || `${hoje.slice(0, 8)}01`;
    const ate = req.query.ate || hoje;

    const [panorama, movimento, primeirosPassos, financeiro, comercial] = await Promise.all([
      panoramaSvc.porOperacao(de, ate),
      panoramaSvc.movimento(de, ate),
      onboarding.resumo(),

      um(`SELECT
            COALESCE(SUM(valor - valor_liquidado) FILTER (WHERE tipo = 'CP'), 0) AS pagar,
            COALESCE(SUM(valor - valor_liquidado) FILTER (WHERE tipo = 'CR'), 0) AS receber,
            COALESCE(SUM(valor - valor_liquidado)
                     FILTER (WHERE tipo = 'CP' AND vencimento < CURRENT_DATE), 0) AS pagar_vencido,
            COUNT(*) FILTER (WHERE vencimento < CURRENT_DATE)::INT AS qtd_vencidos
          FROM vw_titulos WHERE status IN ('ABERTO','PARCIAL')`),

      um(`SELECT
            (SELECT COUNT(*)::INT FROM pedidos_compra WHERE status = 'AGUARDANDO_APROVACAO') AS compras_aguardando,
            (SELECT COUNT(*)::INT FROM pedidos_venda  WHERE status = 'AGUARDANDO_APROVACAO') AS vendas_aguardando,
            (SELECT COUNT(*)::INT FROM recebimentos   WHERE status = 'RASCUNHO')             AS recebimentos_pendentes`),
    ]);

    // Pendências: só o que realmente trava alguém hoje
    const [vencidos, semComunicado, certificadosRascunho, estoqueBaixo, carregamentosAbertos] =
      await Promise.all([
        muitos(
          `SELECT t.numero FROM vw_titulos t
            WHERE t.status IN ('ABERTO','PARCIAL') AND t.vencimento < CURRENT_DATE
            ORDER BY t.vencimento LIMIT 20`
        ),
        muitos(
          `SELECT f.id FROM fumigacoes f
            WHERE f.status IN ('RASCUNHO','EM_ANDAMENTO','AGUARDANDO_COMUNICADO')
              AND (f.numero_comunicado IS NULL OR btrim(f.numero_comunicado) = '')
            LIMIT 20`
        ),
        muitos(`SELECT id FROM certificados_fumigacao WHERE status = 'RASCUNHO' LIMIT 20`),
        muitos(
          `SELECT produto_descricao FROM vw_estoque_posicao
            WHERE estoque_minimo_kg > 0 AND disponivel_kg < estoque_minimo_kg LIMIT 20`
        ),
        muitos(
          `SELECT id FROM carregamentos
            WHERE status IN ('RASCUNHO','PROGRAMADO','EM_CARREGAMENTO') LIMIT 20`
        ),
      ]);

    res.render('painel', {
      titulo: 'Panorama',
      de,
      ate,
      atalhosPeriodo: periodos(de, ate),
      panorama,
      movimento,
      primeirosPassos,
      financeiro,
      comercial,
      vencidos,
      semComunicado,
      certificadosRascunho,
      estoqueBaixo,
      carregamentosAbertos,
      rotuloOrigem: (o) => panoramaSvc.ROTULOS_ORIGEM[o] || o,
      caminhoOrigem: (o) => panoramaSvc.CAMINHOS_ORIGEM[o] || '#',
      // Marcadores da barra de ícones e dos menus
      alertaVencidos: financeiro.qtd_vencidos,
      alertaFumigacao: semComunicado.length,
      alertaCompras: comercial.compras_aguardando + comercial.recebimentos_pendentes,
      alertaVendas: comercial.vendas_aguardando,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
