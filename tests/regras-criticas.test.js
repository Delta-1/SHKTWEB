/**
 * Testes das regras críticas (seção 34 do documento de requisitos).
 *
 * Cada teste aqui existe para provar que uma regra de negócio é impossível de
 * violar — não apenas que a tela esconde o botão.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  prepararBanco,
  limparOperacional,
  usuarioTeste,
  referencias,
  query,
  um,
  muitos,
  encerrar,
  t,
} from './ambiente.js';

const estoque = await import('../src/services/estoque.js');
const fumigacaoSvc = await import('../src/services/fumigacao.js');
const certificadoSvc = await import('../src/services/certificados.js');
const carregamentoSvc = await import('../src/services/carregamento.js');
const financeiro = await import('../src/services/financeiro.js');
const { proximoNumero } = await import('../src/lib/numeracao.js');
const { transacao } = await import('../src/db/index.js');
const { temPermissao } = await import('../src/lib/auth.js');
const { Decimal } = await import('../src/lib/decimal.js');

let usuario;
let ref;

before(async () => {
  await prepararBanco();
  usuario = await usuarioTeste();
  ref = await referencias();
});

beforeEach(async () => {
  await limparOperacional();
});

after(async () => {
  await encerrar();
});

// Helpers ---------------------------------------------------------------

async function darEntrada(toneladas) {
  return estoque.ajustar(
    {
      tipo: 'SALDO_INICIAL',
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: String(toneladas),
      unidadeId: ref.tonId,
      motivo: 'Preparação de teste',
    },
    usuario
  );
}

async function fumigacaoValidada(toneladas, comunicado = 'COM-TESTE') {
  const f = await fumigacaoSvc.criar(
    {
      fumigadoraId: ref.fumigadoraId,
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: String(toneladas),
      unidadeId: ref.tonId,
      moedaId: ref.brlId,
      custoTonelada: '10',
    },
    usuario
  );
  return fumigacaoSvc.validar(
    f.id,
    { numeroComunicado: `${comunicado}-${f.id}`, termino: new Date().toISOString() },
    usuario
  );
}

// -----------------------------------------------------------------------
// Estoque
// -----------------------------------------------------------------------

test('impedir saldo de estoque negativo', async () => {
  await darEntrada(100);

  await assert.rejects(
    () =>
      estoque.ajustar(
        {
          tipo: 'AJUSTE_SAIDA',
          produtoId: ref.produtoId,
          localId: ref.localId,
          quantidade: '150',
          unidadeId: ref.tonId,
          motivo: 'Tentativa de saída acima do saldo',
        },
        usuario
      ),
    /Estoque insuficiente/
  );

  const pos = await um('SELECT * FROM vw_estoque_posicao WHERE produto_id = $1', [ref.produtoId]);
  assert.equal(pos.fisico_kg, t(100), 'o saldo não pode ter sido alterado pela tentativa');
});

test('estoque disponível considera reservas: não é possível reservar duas vezes o mesmo saldo', async () => {
  await darEntrada(100);

  const c1 = await carregamentoSvc.criar(
    { produtoId: ref.produtoId, localId: ref.localId, quantidade: '80', unidadeId: ref.tonId },
    usuario
  );
  await carregamentoSvc.programar(c1.id, usuario);

  const c2 = await carregamentoSvc.criar(
    { produtoId: ref.produtoId, localId: ref.localId, quantidade: '50', unidadeId: ref.tonId },
    usuario
  );

  await assert.rejects(
    () => carregamentoSvc.programar(c2.id, usuario),
    /Estoque disponível insuficiente/
  );
});

test('movimentos de estoque são imutáveis: correção só por estorno', async () => {
  await darEntrada(50);
  const mov = await um('SELECT id FROM estoque_movimentos ORDER BY id DESC LIMIT 1');

  await assert.rejects(
    () => query('UPDATE estoque_movimentos SET quantidade_kg = 1 WHERE id = $1', [mov.id]),
    /nao podem ser alterados/
  );
  await assert.rejects(
    () => query('DELETE FROM estoque_movimentos WHERE id = $1', [mov.id]),
    /nao podem ser alterados/
  );

  await estoque.estornar(mov.id, 'Lançamento indevido', usuario);
  const pos = await um('SELECT * FROM vw_estoque_posicao WHERE produto_id = $1', [ref.produtoId]);
  assert.equal(pos.fisico_kg, '0.000', 'o estorno zera o saldo preservando os dois movimentos');

  const movs = await muitos('SELECT * FROM estoque_movimentos ORDER BY id');
  assert.equal(movs.length, 2);
  assert.equal(movs[1].estorno_de_id, mov.id);
});

test('transferência entre locais não cria nem destrói mercadoria', async () => {
  await darEntrada(100);
  const destino = await um(
    `INSERT INTO locais_estoque (codigo, nome) VALUES ('TESTE-L2','Armazém 2')
     ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`
  );

  await estoque.transferir(
    {
      produtoId: ref.produtoId,
      localOrigemId: ref.localId,
      localDestinoId: destino.id,
      quantidade: '30',
      unidadeId: ref.tonId,
    },
    usuario
  );

  const total = await um(
    'SELECT COALESCE(SUM(fisico_kg),0) AS total FROM vw_estoque_posicao WHERE produto_id = $1',
    [ref.produtoId]
  );
  assert.equal(total.total, t(100), 'o total não muda');

  const origem = await um(
    'SELECT fisico_kg FROM vw_estoque_posicao WHERE produto_id = $1 AND local_id = $2',
    [ref.produtoId, ref.localId]
  );
  assert.equal(origem.fisico_kg, t(70));
});

// -----------------------------------------------------------------------
// Fumigação
// -----------------------------------------------------------------------

test('validar Comunicado obrigatório', async () => {
  const f = await fumigacaoSvc.criar(
    {
      fumigadoraId: ref.fumigadoraId,
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: '100',
      unidadeId: ref.tonId,
      moedaId: ref.brlId,
    },
    usuario
  );

  await assert.rejects(
    () => fumigacaoSvc.validar(f.id, { termino: new Date().toISOString() }, usuario),
    /Comunicado de Fumigação é obrigatório/
  );

  // A regra vive no banco: nem um UPDATE direto consegue validar sem comunicado
  await assert.rejects(
    () => query(`UPDATE fumigacoes SET status = 'VALIDADA' WHERE id = $1`, [f.id]),
    /Comunicado de Fumigação é obrigatório/
  );

  const depois = await um('SELECT status FROM fumigacoes WHERE id = $1', [f.id]);
  assert.equal(depois.status, 'RASCUNHO');
});

test('informar o Comunicado pela edição tira a fumigação do rascunho', async () => {
  // Este é o caminho que o operador usa de verdade: abre a fumigação e digita
  // o número do Comunicado quando ele chega. Sem isto funcionar, o passo mais
  // importante do fluxo fica inacessível pela tela.
  const f = await fumigacaoSvc.criar(
    {
      fumigadoraId: ref.fumigadoraId,
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: '100',
      unidadeId: ref.tonId,
      moedaId: ref.brlId,
    },
    usuario
  );
  assert.equal(f.status, 'RASCUNHO');

  const dados = {
    numeroComunicado: 'COM-2026-0001',
    fumigadoraId: ref.fumigadoraId,
    produtoId: ref.produtoId,
    localId: ref.localId,
    quantidade: '100',
    unidadeId: ref.tonId,
    moedaId: ref.brlId,
  };
  const comComunicado = await fumigacaoSvc.atualizar(f.id, dados, usuario);

  assert.equal(comComunicado.numero_comunicado, 'COM-2026-0001');
  assert.equal(comComunicado.status, 'EM_ANDAMENTO', 'o comunicado tira do rascunho sozinho');

  // Salvar de novo sem mexer no comunicado não pode reverter a situação
  const denovo = await fumigacaoSvc.atualizar(f.id, dados, usuario);
  assert.equal(denovo.status, 'EM_ANDAMENTO');

  // E agora a validação passa
  await fumigacaoSvc.validar(f.id, { termino: new Date().toISOString() }, usuario);
  const validada = await um('SELECT status FROM fumigacoes WHERE id = $1', [f.id]);
  assert.equal(validada.status, 'VALIDADA');
});

test('impedir certificado acima do saldo fumigado', async () => {
  const f = await fumigacaoValidada(500);

  await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '300', unidadeId: ref.tonId, moedaId: ref.brlId, custoTonelada: '10',
      numeroCertificado: 'CF-1' },
    usuario
  ).then((c) => certificadoSvc.validar(c.id, usuario));

  const c2 = await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '150', unidadeId: ref.tonId, moedaId: ref.brlId, custoTonelada: '10',
      numeroCertificado: 'CF-2' },
    usuario
  );
  await certificadoSvc.validar(c2.id, usuario);

  const saldo = await um('SELECT saldo_kg FROM vw_fumigacao_saldos WHERE id = $1', [f.id]);
  assert.equal(saldo.saldo_kg, t(50), '500 − 300 − 150 = 50 t');

  // O terceiro certificado ultrapassa o saldo e deve ser recusado já na criação
  await assert.rejects(
    () =>
      certificadoSvc.criar(
        { fumigacaoId: f.id, quantidade: '100', unidadeId: ref.tonId, moedaId: ref.brlId,
          custoTonelada: '10', numeroCertificado: 'CF-3' },
        usuario
      ),
    /Saldo fumigado insuficiente/
  );

  // E também na validação, caso o saldo mude entre a criação e a validação
  const c4 = await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '50', unidadeId: ref.tonId, moedaId: ref.brlId,
      custoTonelada: '10', numeroCertificado: 'CF-4' },
    usuario
  );
  const c5 = await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '50', unidadeId: ref.tonId, moedaId: ref.brlId,
      custoTonelada: '10', numeroCertificado: 'CF-5' },
    usuario
  );
  await certificadoSvc.validar(c4.id, usuario);
  await assert.rejects(() => certificadoSvc.validar(c5.id, usuario), /Saldo fumigado insuficiente/);
});

test('não é possível emitir certificado de fumigação não validada', async () => {
  const f = await fumigacaoSvc.criar(
    {
      fumigadoraId: ref.fumigadoraId,
      produtoId: ref.produtoId,
      localId: ref.localId,
      quantidade: '100',
      unidadeId: ref.tonId,
      moedaId: ref.brlId,
    },
    usuario
  );

  await assert.rejects(
    () =>
      certificadoSvc.criar(
        { fumigacaoId: f.id, quantidade: '10', unidadeId: ref.tonId, moedaId: ref.brlId },
        usuario
      ),
    /ainda não está validada/
  );
});

test('cancelar fumigação com certificado ativo é bloqueado', async () => {
  const f = await fumigacaoValidada(100);
  const c = await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '10', unidadeId: ref.tonId, moedaId: ref.brlId,
      custoTonelada: '10', numeroCertificado: 'CF-X' },
    usuario
  );
  await certificadoSvc.validar(c.id, usuario);

  await assert.rejects(
    () => fumigacaoSvc.cancelar(f.id, 'Teste', usuario),
    /certificado\(s\) ativo\(s\)/
  );
});

// -----------------------------------------------------------------------
// Financeiro
// -----------------------------------------------------------------------

test('impedir lançamento financeiro duplicado a partir da mesma origem', async () => {
  const f = await fumigacaoValidada(100);
  const c = await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '10', unidadeId: ref.tonId, moedaId: ref.brlId,
      custoTonelada: '10', numeroCertificado: 'CF-DUP' },
    usuario
  );
  await certificadoSvc.validar(c.id, usuario);

  // Validar de novo não pode gerar um segundo título
  await assert.rejects(() => certificadoSvc.validar(c.id, usuario), /já está validado/);

  const titulos = await muitos(
    `SELECT * FROM contas_pagar WHERE origem_tipo = 'CERTIFICADO_FUMIGACAO' AND origem_id = $1`,
    [c.id]
  );
  assert.equal(titulos.length, 1, 'deve existir exatamente um título para o certificado');

  // Nem mesmo forçando por fora do serviço
  await assert.rejects(
    () =>
      transacao((cx) =>
        financeiro.criarContaPagar(
          cx,
          {
            descricao: 'Tentativa de duplicidade',
            origem: 'FUMIGACAO',
            origemTipo: 'CERTIFICADO_FUMIGACAO',
            origemId: c.id,
            origemNumero: c.numero,
            vencimento: '2026-12-31',
            valor: '100',
            moedaId: ref.brlId,
          },
          usuario
        )
      ),
    /não pode ser duplicado/
  );
});

test('cálculo financeiro do certificado é exato e reproduzível', () => {
  // 100 t × R$ 12,50 = R$ 1.250,00
  assert.equal(certificadoSvc.calcularValor(t(100), '12.50'), '1250.0000');
  // 333,333 t × 7,77 — sem erro de ponto flutuante
  assert.equal(certificadoSvc.calcularValor('333333', '7.77'), '2589.9974');
  // O clássico 0.1 + 0.2
  assert.equal(Decimal.de('0.1', 4).mais('0.2').paraSql(4), '0.3000');
  // Entrada no formato brasileiro
  assert.equal(Decimal.de('1.234,56', 2).paraSql(2), '1234.56');
});

test('baixa parcial, quitação e estorno mantêm o saldo coerente', async () => {
  const titulo = await financeiro.criarTituloManual(
    'CP',
    {
      descricao: 'Despesa de teste',
      vencimento: '2026-12-31',
      valor: '1000',
      moedaId: ref.brlId,
    },
    usuario
  );
  const conta = await um(`SELECT id FROM contas_bancarias WHERE codigo = 'CAIXA'`);

  await financeiro.baixar('CP', titulo.id, { valor: '400', contaBancariaId: conta.id }, usuario);
  let t1 = await um('SELECT * FROM contas_pagar WHERE id = $1', [titulo.id]);
  assert.equal(t1.status, 'PARCIAL');
  assert.equal(t1.valor_pago, '400.0000');

  // Não pode pagar mais do que o saldo
  await assert.rejects(
    () => financeiro.baixar('CP', titulo.id, { valor: '700', contaBancariaId: conta.id }, usuario),
    /maior que o saldo/
  );

  const baixa2 = await financeiro.baixar(
    'CP',
    titulo.id,
    { valor: '600', contaBancariaId: conta.id },
    usuario
  );
  t1 = await um('SELECT * FROM contas_pagar WHERE id = $1', [titulo.id]);
  assert.equal(t1.status, 'PAGO');

  const saldoConta = await um('SELECT saldo_atual FROM vw_contas_saldos WHERE id = $1', [conta.id]);
  assert.equal(saldoConta.saldo_atual, '-1000.0000', 'as duas baixas saíram do caixa');

  await financeiro.estornarBaixa(baixa2.id, 'Pagamento em duplicidade', usuario);
  t1 = await um('SELECT * FROM contas_pagar WHERE id = $1', [titulo.id]);
  assert.equal(t1.status, 'PARCIAL');
  assert.equal(t1.valor_pago, '400.0000');

  const saldoApos = await um('SELECT saldo_atual FROM vw_contas_saldos WHERE id = $1', [conta.id]);
  assert.equal(saldoApos.saldo_atual, '-400.0000', 'o estorno devolve o valor ao caixa');
});

test('título com baixa não pode ser cancelado', async () => {
  const titulo = await financeiro.criarTituloManual(
    'CP',
    { descricao: 'Teste', vencimento: '2026-12-31', valor: '100', moedaId: ref.brlId },
    usuario
  );
  const conta = await um(`SELECT id FROM contas_bancarias WHERE codigo = 'CAIXA'`);
  await financeiro.baixar('CP', titulo.id, { valor: '50', contaBancariaId: conta.id }, usuario);

  await assert.rejects(
    () => financeiro.cancelarTitulo('CP', titulo.id, 'Teste', usuario),
    /Estorne as baixas antes/
  );
});

// -----------------------------------------------------------------------
// Cancelamentos e estornos em cadeia
// -----------------------------------------------------------------------

test('cancelar certificado devolve o saldo fumigado e cancela o título gerado', async () => {
  const f = await fumigacaoValidada(500);
  const c = await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '100', unidadeId: ref.tonId, moedaId: ref.brlId,
      custoTonelada: '12.50', numeroCertificado: 'CF-CANC' },
    usuario
  );
  const { contaPagar } = await certificadoSvc.validar(c.id, usuario);

  let saldo = await um('SELECT saldo_kg FROM vw_fumigacao_saldos WHERE id = $1', [f.id]);
  assert.equal(saldo.saldo_kg, t(400));

  await certificadoSvc.cancelar(c.id, 'Erro de digitação na quantidade', usuario);

  saldo = await um('SELECT saldo_kg FROM vw_fumigacao_saldos WHERE id = $1', [f.id]);
  assert.equal(saldo.saldo_kg, t(500), 'o saldo fumigado volta ao valor original');

  const cp = await um('SELECT * FROM contas_pagar WHERE id = $1', [contaPagar.id]);
  assert.equal(cp.status, 'CANCELADO', 'o título gerado é cancelado junto');

  // O histórico é preservado: o certificado continua existindo
  const cert = await um('SELECT * FROM certificados_fumigacao WHERE id = $1', [c.id]);
  assert.equal(cert.status, 'CANCELADO');
  assert.match(cert.motivo_cancelamento, /Erro de digitação/);

  // A conta-corrente de fumigação mostra entrada, saída e estorno
  const movs = await muitos(
    'SELECT tipo FROM fumigacao_movimentos WHERE fumigacao_id = $1 ORDER BY id',
    [f.id]
  );
  assert.deepEqual(movs.map((m) => m.tipo), ['ENTRADA', 'SAIDA', 'ESTORNO']);
});

test('certificado com título já pago não pode ser cancelado', async () => {
  const f = await fumigacaoValidada(100);
  const c = await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '10', unidadeId: ref.tonId, moedaId: ref.brlId,
      custoTonelada: '10', numeroCertificado: 'CF-PG' },
    usuario
  );
  const { contaPagar } = await certificadoSvc.validar(c.id, usuario);
  const conta = await um(`SELECT id FROM contas_bancarias WHERE codigo = 'CAIXA'`);
  await financeiro.baixar('CP', contaPagar.id, { valor: '100', contaBancariaId: conta.id }, usuario);

  await assert.rejects(
    () => certificadoSvc.cancelar(c.id, 'Teste', usuario),
    /já possui pagamento/
  );
});

test('cancelar carregamento expedido devolve a mercadoria ao estoque', async () => {
  await darEntrada(200);
  const cg = await carregamentoSvc.criar(
    { produtoId: ref.produtoId, localId: ref.localId, quantidade: '50', unidadeId: ref.tonId,
      tipoOperacao: 'VENDA_INTERNA' },
    usuario
  );
  await carregamentoSvc.programar(cg.id, usuario);
  await carregamentoSvc.expedir(cg.id, {}, usuario);

  let pos = await um('SELECT * FROM vw_estoque_posicao WHERE produto_id = $1', [ref.produtoId]);
  assert.equal(pos.fisico_kg, t(150));

  await carregamentoSvc.cancelar(cg.id, 'Cliente recusou a carga', usuario);

  pos = await um('SELECT * FROM vw_estoque_posicao WHERE produto_id = $1', [ref.produtoId]);
  assert.equal(pos.fisico_kg, t(200), 'a mercadoria volta ao estoque');

  const movs = await muitos(
    `SELECT tipo FROM estoque_movimentos WHERE produto_id = $1 ORDER BY id`,
    [ref.produtoId]
  );
  assert.deepEqual(movs.map((m) => m.tipo), ['SALDO_INICIAL', 'CARREGAMENTO', 'ESTORNO']);
});

test('não duplicar baixa de estoque: expedir duas vezes é bloqueado', async () => {
  await darEntrada(100);
  const cg = await carregamentoSvc.criar(
    { produtoId: ref.produtoId, localId: ref.localId, quantidade: '40', unidadeId: ref.tonId,
      tipoOperacao: 'VENDA_INTERNA' },
    usuario
  );
  await carregamentoSvc.programar(cg.id, usuario);
  await carregamentoSvc.expedir(cg.id, {}, usuario);

  await assert.rejects(() => carregamentoSvc.expedir(cg.id, {}, usuario), /já foi expedido/);

  const pos = await um('SELECT * FROM vw_estoque_posicao WHERE produto_id = $1', [ref.produtoId]);
  assert.equal(pos.fisico_kg, t(60), 'apenas uma baixa foi aplicada');
});

test('produto que exige fumigação não é exportado sem certificado', async () => {
  await darEntrada(100);
  const cg = await carregamentoSvc.criar(
    { produtoId: ref.produtoId, localId: ref.localId, quantidade: '10', unidadeId: ref.tonId,
      tipoOperacao: 'EXPORTACAO' },
    usuario
  );
  await carregamentoSvc.programar(cg.id, usuario);

  await assert.rejects(
    () => carregamentoSvc.expedir(cg.id, {}, usuario),
    /exige certificado de fumigação/
  );
});

test('carregamento não pode consumir mais do que o certificado cobre', async () => {
  await darEntrada(500);
  const f = await fumigacaoValidada(200);
  const c = await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '100', unidadeId: ref.tonId, moedaId: ref.brlId,
      custoTonelada: '10', numeroCertificado: 'CF-LIM' },
    usuario
  );
  await certificadoSvc.validar(c.id, usuario);

  await carregamentoSvc.criar(
    { produtoId: ref.produtoId, localId: ref.localId, quantidade: '70', unidadeId: ref.tonId,
      certificadoId: c.id, tipoOperacao: 'EXPORTACAO' },
    usuario
  );

  await assert.rejects(
    () =>
      carregamentoSvc.criar(
        { produtoId: ref.produtoId, localId: ref.localId, quantidade: '50', unidadeId: ref.tonId,
          certificadoId: c.id, tipoOperacao: 'EXPORTACAO' },
        usuario
      ),
    /excede o saldo do certificado/
  );
});

// -----------------------------------------------------------------------
// Numeração documental e concorrência
// -----------------------------------------------------------------------

test('impedir números documentais duplicados sob concorrência', async () => {
  const ano = 2031;
  const total = 40;

  const numeros = await Promise.all(
    Array.from({ length: total }, () =>
      transacao((cx) => proximoNumero(cx, 'TESTE_CONCORRENCIA', ano))
    )
  );

  assert.equal(new Set(numeros).size, total, 'todos os números devem ser únicos');
  assert.ok(numeros.every((n) => /^\d{4}-2031$/.test(n)), 'formato 0001-2031');

  const ordenados = [...numeros].sort();
  assert.equal(ordenados[0], '0001-2031');
  assert.equal(ordenados[total - 1], String(total).padStart(4, '0') + '-2031');
});

test('a numeração reinicia a cada ano', async () => {
  const a = await transacao((cx) => proximoNumero(cx, 'TESTE_ANO', 2026));
  const b = await transacao((cx) => proximoNumero(cx, 'TESTE_ANO', 2026));
  const c = await transacao((cx) => proximoNumero(cx, 'TESTE_ANO', 2027));
  assert.equal(a, '0001-2026');
  assert.equal(b, '0002-2026');
  assert.equal(c, '0001-2027');
});

test('concorrência em operação crítica: duas expedições simultâneas não furam o estoque', async () => {
  await darEntrada(100);

  const c1 = await carregamentoSvc.criar(
    { produtoId: ref.produtoId, localId: ref.localId, quantidade: '60', unidadeId: ref.tonId,
      tipoOperacao: 'VENDA_INTERNA' },
    usuario
  );
  const c2 = await carregamentoSvc.criar(
    { produtoId: ref.produtoId, localId: ref.localId, quantidade: '60', unidadeId: ref.tonId,
      tipoOperacao: 'VENDA_INTERNA' },
    usuario
  );

  const resultados = await Promise.allSettled([
    carregamentoSvc.expedir(c1.id, {}, usuario),
    carregamentoSvc.expedir(c2.id, {}, usuario),
  ]);

  const sucessos = resultados.filter((r) => r.status === 'fulfilled').length;
  assert.equal(sucessos, 1, 'apenas uma das duas expedições pode passar');

  const pos = await um('SELECT * FROM vw_estoque_posicao WHERE produto_id = $1', [ref.produtoId]);
  assert.equal(pos.fisico_kg, t(40), 'o estoque nunca fica negativo');
});

test('concorrência: dois certificados simultâneos não estouram o saldo fumigado', async () => {
  const f = await fumigacaoValidada(100);

  const c1 = await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '60', unidadeId: ref.tonId, moedaId: ref.brlId,
      custoTonelada: '10', numeroCertificado: 'CC-1' },
    usuario
  );
  const c2 = await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '60', unidadeId: ref.tonId, moedaId: ref.brlId,
      custoTonelada: '10', numeroCertificado: 'CC-2' },
    usuario
  );

  const resultados = await Promise.allSettled([
    certificadoSvc.validar(c1.id, usuario),
    certificadoSvc.validar(c2.id, usuario),
  ]);

  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);

  const saldo = await um('SELECT * FROM vw_fumigacao_saldos WHERE id = $1', [f.id]);
  assert.equal(saldo.quantidade_certificada_kg, t(60));
  assert.equal(saldo.saldo_kg, t(40), 'o saldo fumigado nunca fica negativo');
});

// -----------------------------------------------------------------------
// Transacionalidade
// -----------------------------------------------------------------------

test('falha no meio da operação não deixa alteração parcial', async () => {
  const f = await fumigacaoValidada(100);

  // Certificado sem número externo: a validação falha DEPOIS de existir o
  // rascunho, mas ANTES de consumir saldo e gerar título.
  const c = await certificadoSvc.criar(
    { fumigacaoId: f.id, quantidade: '50', unidadeId: ref.tonId, moedaId: ref.brlId, custoTonelada: '10' },
    usuario
  );

  await assert.rejects(() => certificadoSvc.validar(c.id, usuario), /número do certificado/);

  const saldo = await um('SELECT * FROM vw_fumigacao_saldos WHERE id = $1', [f.id]);
  assert.equal(saldo.saldo_kg, t(100), 'nenhum saldo foi consumido');

  const titulos = await muitos(`SELECT * FROM contas_pagar WHERE origem_id = $1`, [c.id]);
  assert.equal(titulos.length, 0, 'nenhum título foi gerado');

  const cert = await um('SELECT status FROM certificados_fumigacao WHERE id = $1', [c.id]);
  assert.equal(cert.status, 'RASCUNHO', 'o certificado continua em rascunho');
});

// -----------------------------------------------------------------------
// Permissões
// -----------------------------------------------------------------------

test('permissões: perfil sem a permissão não executa a ação', async () => {
  const consulta = await um(`SELECT id FROM perfis WHERE codigo = 'CONSULTA'`);
  const permissoes = (
    await muitos('SELECT permissao FROM perfil_permissoes WHERE perfil_id = $1', [consulta.id])
  ).map((r) => r.permissao);
  const leitor = { id: 999, nome: 'Leitor', perfil_nome: 'Consulta', permissoes };

  assert.equal(temPermissao(leitor, 'certificados.visualizar'), true);
  assert.equal(temPermissao(leitor, 'certificados.aprovar'), false);
  assert.equal(temPermissao(leitor, 'financeiro.liquidar'), false);
  assert.equal(temPermissao(leitor, 'admin.administrar'), false);

  const fumigador = {
    id: 998,
    nome: 'Fumigação',
    permissoes: (
      await muitos(
        `SELECT permissao FROM perfil_permissoes
          WHERE perfil_id = (SELECT id FROM perfis WHERE codigo = 'FUMIGACAO')`
      )
    ).map((r) => r.permissao),
  };
  assert.equal(temPermissao(fumigador, 'certificados.aprovar'), true);
  assert.equal(temPermissao(fumigador, 'financeiro.liquidar'), false);

  const admin = { id: 1, nome: 'Admin', permissoes: ['admin.administrar'] };
  assert.equal(temPermissao(admin, 'financeiro.liquidar'), true, 'admin tem acesso total');
});

// -----------------------------------------------------------------------
// Auditoria
// -----------------------------------------------------------------------

test('auditoria é imutável', async () => {
  await darEntrada(10);
  const log = await um('SELECT id FROM auditoria ORDER BY id DESC LIMIT 1');

  await assert.rejects(
    () => query(`UPDATE auditoria SET descricao = 'adulterado' WHERE id = $1`, [log.id]),
    /nao podem ser alterados/
  );
  await assert.rejects(
    () => query('DELETE FROM auditoria WHERE id = $1', [log.id]),
    /nao podem ser alterados/
  );
});
