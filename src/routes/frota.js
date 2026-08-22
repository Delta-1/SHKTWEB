import { Router } from 'express';
import { exigir } from '../lib/auth.js';
import { carregar } from '../lib/referencias.js';
import * as validar from '../lib/validar.js';
import * as frota from '../services/frota.js';
import { muitos } from '../db/index.js';
import { ErroNaoEncontrado } from '../lib/erros.js';
import { hojeISO } from '../lib/formato.js';

const router = Router();
const ctx = (req) => ({ ip: req.ip, sessao: req.sessionID });

const referencias = () => carregar([
  'operacoes', 'clientes', 'fornecedores', 'oficinas', 'veiculos', 'motoristas',
  'moedas', 'categorias', 'centrosCusto', 'combustiveis',
]);

function lerViagem(c) {
  return {
    operacaoId: validar.id(c.operacao_id, 'Operação', { obrigatorio: true }),
    carregamentoId: validar.id(c.carregamento_id, 'Carregamento'),
    clienteId: validar.id(c.cliente_id, 'Cliente'),
    veiculoId: validar.id(c.veiculo_id, 'Veículo', { obrigatorio: true }),
    motoristaId: validar.id(c.motorista_id, 'Motorista', { obrigatorio: true }),
    origem: validar.texto(c.origem, 'Origem', { obrigatorio: true, max: 180 }),
    destino: validar.texto(c.destino, 'Destino', { obrigatorio: true, max: 180 }),
    dataSaidaPrevista: validar.data(c.data_saida_prevista, 'Data prevista', { obrigatorio: true }),
    kmInicial: validar.decimal(c.km_inicial, 'Quilometragem inicial', { escala: 1, min: 0 }),
    valorFrete: validar.dinheiro(c.valor_frete, 'Valor do frete', { min: 0 }) || '0',
    moedaId: validar.id(c.moeda_id, 'Moeda', { obrigatorio: true }),
    centroCustoId: validar.id(c.centro_custo_id, 'Centro de custo'),
    condicaoPagamento: validar.texto(c.condicao_pagamento, 'Condição de pagamento', { max: 120 }),
    vencimentoFrete: validar.data(c.vencimento_frete, 'Vencimento do frete'),
    observacoes: validar.texto(c.observacoes, 'Observações'),
  };
}

router.get('/', exigir('frota.visualizar'), async (req, res, next) => {
  try {
    const filtros = {
      status: req.query.status || null,
      veiculoId: req.query.veiculo || null,
      motoristaId: req.query.motorista || null,
      de: req.query.de || null,
      ate: req.query.ate || null,
      busca: req.query.busca || null,
    };
    const [lista, indicadores, ref] = await Promise.all([
      frota.listar(filtros), frota.indicadores(), carregar(['veiculos', 'motoristas']),
    ]);
    res.render('frota/indice', { titulo: 'SHKT Transportes', lista, indicadores, ref, filtros });
  } catch (e) { next(e); }
});

router.get('/viagens/nova', exigir('frota.criar'), async (req, res, next) => {
  try {
    const [ref, carregamentos] = await Promise.all([
      referencias(),
      muitos(`SELECT id, numero, destino, placa FROM carregamentos
               WHERE status IN ('RASCUNHO','PROGRAMADO','EM_CARREGAMENTO')
               ORDER BY data DESC, id DESC LIMIT 100`),
    ]);
    const operacao = ref.operacoes.find((o) => o.codigo === 'SHKT-TRANSP') || ref.operacoes[0];
    const brl = ref.moedas.find((m) => m.codigo === 'BRL') || ref.moedas[0];
    const centro = ref.centrosCusto.find((c) => c.codigo === 'FROTA') || ref.centrosCusto[0];
    res.render('frota/viagem-form', {
      titulo: 'Nova viagem', ref, carregamentos, novo: true,
      viagem: {
        operacao_id: operacao?.id, moeda_id: brl?.id, centro_custo_id: centro?.id,
        data_saida_prevista: hojeISO(), carregamento_id: req.query.carregamento || null,
      },
    });
  } catch (e) { next(e); }
});

router.post('/viagens/nova', exigir('frota.criar'), async (req, res, next) => {
  try {
    const v = await frota.criarViagem(lerViagem(req.body), req.usuario, ctx(req));
    res.avisar(`Viagem ${v.numero} criada. Confira e programe quando estiver pronta.`);
    req.session.save(() => res.redirect(`/frota/viagens/${v.id}`));
  } catch (e) { next(e); }
});

router.get('/viagens/:id/editar', exigir('frota.editar'), async (req, res, next) => {
  try {
    const [viagem, ref, carregamentos] = await Promise.all([
      frota.buscar(req.params.id), referencias(),
      muitos(`SELECT id, numero, destino, placa FROM carregamentos
               WHERE status <> 'CANCELADO' ORDER BY data DESC, id DESC LIMIT 100`),
    ]);
    if (!viagem) throw new ErroNaoEncontrado('Viagem não encontrada.');
    res.render('frota/viagem-form', {
      titulo: `Editar viagem ${viagem.numero}`, ref, carregamentos, novo: false, viagem,
    });
  } catch (e) { next(e); }
});

router.post('/viagens/:id/editar', exigir('frota.editar'), async (req, res, next) => {
  try {
    await frota.atualizarViagem(req.params.id, lerViagem(req.body), req.usuario, ctx(req));
    res.avisar('Viagem atualizada.');
    req.session.save(() => res.redirect(`/frota/viagens/${req.params.id}`));
  } catch (e) { next(e); }
});

router.get('/viagens/:id', exigir('frota.visualizar'), async (req, res, next) => {
  try {
    const viagem = await frota.buscar(req.params.id);
    if (!viagem) throw new ErroNaoEncontrado('Viagem não encontrada.');
    res.render('frota/viagem-detalhe', { titulo: `Viagem ${viagem.numero}`, viagem });
  } catch (e) { next(e); }
});

router.post('/viagens/:id/programar', exigir('frota.aprovar'), async (req, res, next) => {
  try {
    await frota.programar(req.params.id, req.usuario, ctx(req));
    res.avisar('Viagem programada. A receita do frete foi enviada ao Contas a Receber.');
    req.session.save(() => res.redirect(`/frota/viagens/${req.params.id}`));
  } catch (e) { next(e); }
});

router.post('/viagens/:id/iniciar', exigir('frota.aprovar'), async (req, res, next) => {
  try {
    await frota.iniciar(req.params.id, {
      dataSaida: validar.dataHora(req.body.data_saida, 'Saída'),
      kmInicial: validar.decimal(req.body.km_inicial, 'Km inicial', { escala: 1, min: 0 }),
    }, req.usuario, ctx(req));
    res.avisar('Boa viagem. O acompanhamento foi iniciado.');
    req.session.save(() => res.redirect(`/frota/viagens/${req.params.id}`));
  } catch (e) { next(e); }
});

router.post('/viagens/:id/concluir', exigir('frota.aprovar'), async (req, res, next) => {
  try {
    await frota.concluir(req.params.id, {
      dataRetorno: validar.dataHora(req.body.data_retorno, 'Retorno'),
      kmFinal: validar.decimal(req.body.km_final, 'Km final', { obrigatorio: true, escala: 1, min: 0 }),
    }, req.usuario, ctx(req));
    res.avisar('Viagem concluída. O resultado já considera os custos confirmados.');
    req.session.save(() => res.redirect(`/frota/viagens/${req.params.id}`));
  } catch (e) { next(e); }
});

router.post('/viagens/:id/cancelar', exigir('frota.cancelar'), async (req, res, next) => {
  try {
    const motivo = validar.texto(req.body.motivo, 'Motivo', { obrigatorio: true, min: 5 });
    await frota.cancelarViagem(req.params.id, motivo, req.usuario, ctx(req));
    res.avisar('Viagem cancelada sem apagar o histórico.');
    req.session.save(() => res.redirect(`/frota/viagens/${req.params.id}`));
  } catch (e) { next(e); }
});

router.get('/viagens/:id/abastecimentos/novo', exigir('frota.criar'), async (req, res, next) => {
  try {
    const [viagem, ref] = await Promise.all([frota.buscar(req.params.id), referencias()]);
    if (!viagem) throw new ErroNaoEncontrado('Viagem não encontrada.');
    const combustivel = ref.combustiveis[0];
    res.render('frota/abastecimento-form', {
      titulo: `Abastecer — ${viagem.numero}`, viagem, ref,
      registro: { data: hojeISO(), viagem_id: viagem.id, operacao_id: viagem.operacao_id,
        veiculo_id: viagem.veiculo_id, motorista_id: viagem.motorista_id,
        combustivel_id: combustivel?.id, centro_custo_id: viagem.centro_custo_id },
    });
  } catch (e) { next(e); }
});

router.post('/viagens/:id/abastecimentos/novo', exigir('frota.criar'), async (req, res, next) => {
  try {
    const a = await frota.criarAbastecimento({
      viagemId: validar.id(req.params.id, 'Viagem', { obrigatorio: true }),
      operacaoId: validar.id(req.body.operacao_id, 'Operação', { obrigatorio: true }),
      data: validar.data(req.body.data, 'Data', { obrigatorio: true }),
      veiculoId: validar.id(req.body.veiculo_id, 'Veículo', { obrigatorio: true }),
      motoristaId: validar.id(req.body.motorista_id, 'Motorista'),
      combustivelId: validar.id(req.body.combustivel_id, 'Combustível', { obrigatorio: true }),
      fornecedorId: validar.id(req.body.fornecedor_id, 'Posto/fornecedor'),
      quantidadeLitros: validar.decimal(req.body.quantidade_litros, 'Litros', { obrigatorio: true, escala: 3, positivo: true }),
      precoLitro: validar.dinheiro(req.body.preco_litro, 'Preço por litro', { obrigatorio: true, positivo: true }),
      quilometragem: validar.decimal(req.body.quilometragem, 'Quilometragem', { escala: 1, min: 0 }),
      centroCustoId: validar.id(req.body.centro_custo_id, 'Centro de custo'),
      observacoes: validar.texto(req.body.observacoes, 'Observações'),
    }, req.usuario, ctx(req));
    res.avisar(`Abastecimento ${a.numero} salvo. Confirme para gerar o Contas a Pagar.`, 'atencao');
    req.session.save(() => res.redirect(`/frota/viagens/${req.params.id}`));
  } catch (e) { next(e); }
});

router.post('/abastecimentos/:id/confirmar', exigir('frota.aprovar'), async (req, res, next) => {
  try {
    await frota.confirmarAbastecimento(req.params.id, req.usuario, ctx(req));
    res.avisar('Abastecimento confirmado e enviado ao Contas a Pagar.');
    req.session.save(() => res.redirect(req.get('referer') || '/frota'));
  } catch (e) { next(e); }
});

router.get('/viagens/:id/despesas/nova', exigir('frota.criar'), async (req, res, next) => {
  try {
    const [viagem, ref] = await Promise.all([frota.buscar(req.params.id), referencias()]);
    if (!viagem) throw new ErroNaoEncontrado('Viagem não encontrada.');
    const brl = ref.moedas.find((m) => m.codigo === 'BRL') || ref.moedas[0];
    const categoria = ref.categorias.find((c) => c.codigo === 'VIAGEM');
    res.render('frota/despesa-form', {
      titulo: `Nova despesa — ${viagem.numero}`, viagem, ref,
      registro: { data: hojeISO(), moeda_id: brl?.id, categoria_id: categoria?.id,
        centro_custo_id: viagem.centro_custo_id },
    });
  } catch (e) { next(e); }
});

router.post('/viagens/:id/despesas/nova', exigir('frota.criar'), async (req, res, next) => {
  try {
    const d = await frota.criarDespesa({
      viagemId: validar.id(req.params.id, 'Viagem', { obrigatorio: true }),
      data: validar.data(req.body.data, 'Data', { obrigatorio: true }),
      tipo: validar.escolha(req.body.tipo, 'Tipo', ['ADIANTAMENTO','ALIMENTACAO','PEDAGIO','HOSPEDAGEM','MANUTENCAO_EMERGENCIAL','DOCUMENTACAO','OUTRO'], { obrigatorio: true }),
      descricao: validar.texto(req.body.descricao, 'Descrição', { obrigatorio: true }),
      parceiroId: validar.id(req.body.parceiro_id, 'Beneficiário'),
      categoriaId: validar.id(req.body.categoria_id, 'Categoria'),
      centroCustoId: validar.id(req.body.centro_custo_id, 'Centro de custo'),
      valor: validar.dinheiro(req.body.valor, 'Valor', { obrigatorio: true, positivo: true }),
      moedaId: validar.id(req.body.moeda_id, 'Moeda', { obrigatorio: true }),
      observacoes: validar.texto(req.body.observacoes, 'Observações'),
    }, req.usuario, ctx(req));
    res.avisar(`Despesa ${d.numero} salva. Confirme para gerar o Contas a Pagar.`, 'atencao');
    req.session.save(() => res.redirect(`/frota/viagens/${req.params.id}`));
  } catch (e) { next(e); }
});

router.post('/despesas/:id/confirmar', exigir('frota.aprovar'), async (req, res, next) => {
  try {
    await frota.confirmarDespesa(req.params.id, req.usuario, ctx(req));
    res.avisar('Despesa confirmada e enviada ao Contas a Pagar.');
    req.session.save(() => res.redirect(req.get('referer') || '/frota'));
  } catch (e) { next(e); }
});

router.get('/manutencoes', exigir('frota.visualizar'), async (req, res, next) => {
  try {
    const filtros = {
      status: req.query.status || null,
      veiculoId: req.query.veiculo || null,
      busca: req.query.busca || null,
    };
    const [lista, ref] = await Promise.all([
      frota.listarManutencoes(filtros), carregar(['veiculos']),
    ]);
    res.render('frota/manutencoes', {
      titulo: 'Manutenção da frota', lista, ref, filtros,
    });
  } catch (e) { next(e); }
});

router.get('/manutencoes/nova', exigir('frota.criar'), async (req, res, next) => {
  try {
    const [ref, viagem] = await Promise.all([
      referencias(), req.query.viagem ? frota.buscar(req.query.viagem) : Promise.resolve(null),
    ]);
    const operacao = ref.operacoes.find((o) => o.codigo === 'SHKT-TRANSP') || ref.operacoes[0];
    const brl = ref.moedas.find((m) => m.codigo === 'BRL') || ref.moedas[0];
    const categoria = ref.categorias.find((c) => c.codigo === 'MANUTENCAO');
    res.render('frota/manutencao-form', {
      titulo: 'Nova ordem de manutenção', ref, viagem,
      registro: { data: hojeISO(), viagem_id: viagem?.id, veiculo_id: viagem?.veiculo_id,
        operacao_id: viagem?.operacao_id || operacao?.id, moeda_id: brl?.id,
        categoria_id: categoria?.id, centro_custo_id: viagem?.centro_custo_id },
    });
  } catch (e) { next(e); }
});

router.post('/manutencoes/nova', exigir('frota.criar'), async (req, res, next) => {
  try {
    const m = await frota.criarManutencao({
      operacaoId: validar.id(req.body.operacao_id, 'Operação', { obrigatorio: true }),
      viagemId: validar.id(req.body.viagem_id, 'Viagem'),
      veiculoId: validar.id(req.body.veiculo_id, 'Veículo', { obrigatorio: true }),
      oficinaId: validar.id(req.body.oficina_id, 'Oficina'),
      data: validar.data(req.body.data, 'Data', { obrigatorio: true }),
      quilometragem: validar.decimal(req.body.quilometragem, 'Quilometragem', { escala: 1, min: 0 }),
      tipo: validar.escolha(req.body.tipo, 'Tipo', ['PREVENTIVA','CORRETIVA','EMERGENCIAL','REVISAO','OUTRA'], { obrigatorio: true }),
      descricao: validar.texto(req.body.descricao, 'Descrição', { obrigatorio: true }),
      valorPecas: validar.dinheiro(req.body.valor_pecas, 'Peças', { min: 0 }),
      valorServicos: validar.dinheiro(req.body.valor_servicos, 'Serviços', { min: 0 }),
      valorMaoObra: validar.dinheiro(req.body.valor_mao_obra, 'Mão de obra', { min: 0 }),
      previsaoConclusao: validar.data(req.body.previsao_conclusao, 'Previsão'),
      categoriaId: validar.id(req.body.categoria_id, 'Categoria'),
      centroCustoId: validar.id(req.body.centro_custo_id, 'Centro de custo'),
      moedaId: validar.id(req.body.moeda_id, 'Moeda', { obrigatorio: true }),
      observacoes: validar.texto(req.body.observacoes, 'Observações'),
    }, req.usuario, ctx(req));
    res.avisar(`Ordem ${m.numero} criada. Aprove para gerar o Contas a Pagar.`, 'atencao');
    req.session.save(() => res.redirect(m.viagem_id ? `/frota/viagens/${m.viagem_id}` : '/frota/manutencoes'));
  } catch (e) { next(e); }
});

router.post('/manutencoes/:id/aprovar', exigir('frota.aprovar'), async (req, res, next) => {
  try {
    await frota.aprovarManutencao(req.params.id, req.usuario, ctx(req));
    res.avisar('Manutenção aprovada e enviada ao Contas a Pagar.');
    req.session.save(() => res.redirect(req.get('referer') || '/frota'));
  } catch (e) { next(e); }
});

export default router;
