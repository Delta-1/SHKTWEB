/* ERP SHKT - comportamentos de tela.
   Sem dependencias externas: o sistema precisa funcionar em conexao ruim
   e em navegador de celular antigo. */
(function () {
  'use strict';

  var doc = document;
  var raiz = doc.documentElement;

  function svg(nome, classe) {
    return '<svg class="ic' + (classe ? ' ' + classe : '') + '" aria-hidden="true"><use href="#i-' + nome + '"/></svg>';
  }

  // ------------------------------------------------------------- tema
  // A escolha do usuario vale mais que a do sistema operacional, e vale para
  // sempre (localStorage). O tema inicial ja foi aplicado no <head>.
  doc.addEventListener('click', function (ev) {
    if (!ev.target.closest('[data-tema]')) return;
    var escuro = raiz.classList.toggle('escuro');
    try { localStorage.setItem('shkt-tema', escuro ? 'escuro' : 'claro'); } catch (e) { /* sem storage */ }
    var cor = doc.querySelector('meta[name=theme-color]:not([media])');
    if (cor) cor.setAttribute('content', escuro ? '#09090b' : '#ffffff');
  });

  // ------------------------------------------------------------- avisos
  // Confirmacoes rapidas aparecem flutuando e somem sozinhas; erros ficam
  // fixos no topo da pagina, porque exigem leitura.
  function avisar(texto, tipo, segundos) {
    var torre = doc.getElementById('avisos');
    if (!torre) return;
    var caixa = doc.createElement('div');
    caixa.className = 'toast ' + (tipo || 'ok');
    caixa.innerHTML = svg(tipo === 'erro' ? 'erro' : tipo === 'atencao' ? 'atencao' : 'ok') +
      '<span></span>';
    caixa.lastChild.textContent = texto;
    torre.appendChild(caixa);
    requestAnimationFrame(function () { caixa.classList.add('visivel'); });
    setTimeout(function () {
      caixa.classList.remove('visivel');
      setTimeout(function () { caixa.remove(); }, 300);
    }, (segundos || 4) * 1000);
  }
  window.avisar = avisar;

  // Mensagem de sucesso vinda do servidor vira toast: nao empurra a tela
  // para baixo nem exige que o operador feche nada.
  doc.addEventListener('DOMContentLoaded', function () {
    var faixa = doc.querySelector('[data-vira-toast]');
    if (!faixa) return;
    var tipo = faixa.classList.contains('erro') ? 'erro'
      : faixa.classList.contains('atencao') ? 'atencao' : 'ok';
    avisar(faixa.textContent.trim(), tipo, tipo === 'ok' ? 4 : 7);
    faixa.remove();
  });

  // ------------------------------------------------------------- menu movel
  doc.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-abrir-menu]')) {
      doc.body.classList.toggle('menu-aberto');
      return;
    }
    if (doc.body.classList.contains('menu-aberto') && !ev.target.closest('.lateral')) {
      doc.body.classList.remove('menu-aberto');
    }
  });

  doc.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') doc.body.classList.remove('menu-aberto');
  });

  // ---------------------------------------------------- confirmacao de acao
  // Uso: <button data-confirmar="Cancelar o certificado 0003-2026?">
  doc.addEventListener('submit', function (ev) {
    var form = ev.target;
    var pedido = form.getAttribute('data-confirmar');
    var botao = form.querySelector('[type=submit]:focus') || doc.activeElement;
    if (!pedido && botao && botao.form === form) pedido = botao.getAttribute('data-confirmar');
    if (pedido && !window.confirm(pedido)) {
      ev.preventDefault();
      return;
    }
    travarEnvio(form);
  });

  // Impede duplo clique gerando dois documentos, e mostra que algo esta
  // acontecendo — em conexao lenta, a tela parada parece travada.
  function travarEnvio(form) {
    var botoes = form.querySelectorAll('button[type=submit], input[type=submit]');
    setTimeout(function () {
      for (var i = 0; i < botoes.length; i++) {
        botoes[i].disabled = true;
        if (botoes[i].tagName === 'BUTTON' && !botoes[i].dataset.textoOriginal) {
          botoes[i].dataset.textoOriginal = botoes[i].innerHTML;
          botoes[i].innerHTML = svg('atualizar', 'girando') + ' Gravando...';
        }
      }
    }, 0);
    // Se a navegacao nao acontecer (erro de validacao do navegador), libera
    setTimeout(function () {
      for (var i = 0; i < botoes.length; i++) {
        botoes[i].disabled = false;
        if (botoes[i].dataset.textoOriginal) botoes[i].innerHTML = botoes[i].dataset.textoOriginal;
      }
    }, 12000);
  }

  // ------------------------------------------------------- campos numericos
  // Aceita virgula como separador decimal e formata ao sair do campo.
  function formatarNumero(valor, casas) {
    var texto = String(valor).trim();
    if (!texto) return '';
    texto = texto.replace(/\s/g, '');
    if (texto.indexOf(',') > -1) texto = texto.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(texto);
    if (isNaN(n)) return valor;
    return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }

  doc.addEventListener(
    'blur',
    function (ev) {
      var campo = ev.target;
      if (!campo.classList || !campo.classList.contains('numerico')) return;
      if (campo.type === 'number') return;
      var casas = parseInt(campo.getAttribute('data-casas') || '2', 10);
      campo.value = formatarNumero(campo.value, casas);
      recalcular(campo.form);
    },
    true
  );

  // -------------------------------------------------- calculos automaticos
  function numeroDe(campo) {
    if (!campo) return 0;
    var t = String(campo.value || '').trim().replace(/\s/g, '');
    if (t.indexOf(',') > -1) t = t.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }

  function recalcular(form) {
    if (!form) return;

    // Total = quantidade (t) x custo por tonelada
    var alvo = form.querySelector('[data-total-tonelada]');
    if (alvo) {
      var qtd = form.querySelector('[name=quantidade]');
      var unidade = form.querySelector('[name=unidade_id]');
      var custo = form.querySelector('[name=custo_tonelada]') || form.querySelector('[name=preco_tonelada]');
      var fator = unidade && unidade.selectedOptions[0]
        ? parseFloat(unidade.selectedOptions[0].getAttribute('data-fator') || '1')
        : 1;
      var toneladas = (numeroDe(qtd) * fator) / 1000;
      var total = toneladas * numeroDe(custo);
      alvo.value = total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Peso liquido = bruto - tara
    var liquido = form.querySelector('[name=peso_liquido]');
    if (liquido) {
      var bruto = form.querySelector('[name=peso_bruto]');
      var tara = form.querySelector('[name=peso_tara]');
      if (bruto && tara && (numeroDe(bruto) || numeroDe(tara))) {
        var l = numeroDe(bruto) - numeroDe(tara);
        liquido.value = l.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
      }
    }

    // Equivalencia em kg/t exibida ao lado da quantidade
    var eco = form.querySelector('[data-eco-kg]');
    if (eco) {
      var q = form.querySelector('[name=quantidade]');
      var u = form.querySelector('[name=unidade_id]');
      var f = u && u.selectedOptions[0] ? parseFloat(u.selectedOptions[0].getAttribute('data-fator') || '1') : 1;
      var kg = numeroDe(q) * f;
      eco.textContent = kg
        ? '= ' + kg.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + ' kg  ·  ' +
          (kg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + ' t'
        : '';
    }
  }

  doc.addEventListener('input', function (ev) {
    if (ev.target.form) recalcular(ev.target.form);
  });
  doc.addEventListener('change', function (ev) {
    if (ev.target.form) recalcular(ev.target.form);
  });

  // ------------------------------------------------ linhas de item (pedidos)
  // Um pedido tem varias linhas. Adicionar e remover linha acontece na tela,
  // sem ida ao servidor: quem esta digitando um pedido de dez itens nao pode
  // esperar dez recarregamentos.
  function tabelaDe(nome) {
    return doc.querySelector('[data-linhas="' + nome + '"]');
  }

  function limparLinha(tr) {
    var campos = tr.querySelectorAll('input, select, textarea');
    for (var i = 0; i < campos.length; i++) {
      if (campos[i].tagName === 'SELECT') {
        // Mantem a unidade escolhida: quase sempre e a mesma do item anterior
        if (!campos[i].hasAttribute('data-item-unidade')) campos[i].selectedIndex = 0;
      } else {
        campos[i].value = '';
      }
    }
    var total = tr.querySelector('[data-item-total]');
    if (total) total.textContent = '0,00';
  }

  doc.addEventListener('click', function (ev) {
    var add = ev.target.closest('[data-adicionar-linha]');
    if (add) {
      ev.preventDefault();
      var tabela = tabelaDe(add.getAttribute('data-adicionar-linha'));
      if (!tabela) return;
      var corpo = tabela.tBodies[0];
      var modelo = corpo.rows[corpo.rows.length - 1];
      if (!modelo) return;
      var nova = modelo.cloneNode(true);
      limparLinha(nova);
      corpo.appendChild(nova);
      var primeiro = nova.querySelector('input, select');
      if (primeiro) primeiro.focus();
      somarLinhas(tabela);
      return;
    }

    var rem = ev.target.closest('[data-remover-linha]');
    if (rem) {
      ev.preventDefault();
      var linha = rem.closest('[data-linha]');
      var tab = rem.closest('table');
      if (!linha || !tab) return;
      // Nunca deixa o pedido sem nenhuma linha: a ultima e limpa, nao apagada
      if (tab.tBodies[0].rows.length === 1) limparLinha(linha);
      else linha.remove();
      somarLinhas(tab);
    }
  });

  function somarLinhas(tabela) {
    if (!tabela) return;
    var linhas = tabela.tBodies[0] ? tabela.tBodies[0].rows : [];
    var total = 0;

    for (var i = 0; i < linhas.length; i++) {
      var qtd = linhas[i].querySelector('[data-item-quantidade]');
      var preco = linhas[i].querySelector('[data-item-preco]');
      var celula = linhas[i].querySelector('[data-item-total]');
      if (!celula) continue;

      var valor = numeroDe(qtd) * numeroDe(preco);
      total += valor;
      celula.textContent = valor.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    var rodape = tabela.querySelector('[data-total-linhas]');
    if (rodape) {
      rodape.textContent = total.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
  }

  // Escolher o produto ja preenche descricao e unidade: menos digitacao,
  // menos erro de cadastro divergente.
  doc.addEventListener('change', function (ev) {
    var sel = ev.target;
    if (!sel.hasAttribute || !sel.hasAttribute('data-item-produto')) return;
    var linha = sel.closest('[data-linha]');
    if (!linha) return;

    var opcao = sel.selectedOptions[0];
    if (!opcao || !opcao.value) return;

    var descricao = linha.querySelector('[name=item_descricao]');
    if (descricao && !descricao.value.trim()) {
      descricao.value = opcao.getAttribute('data-descricao') || '';
    }
    var unidade = linha.querySelector('[data-item-unidade]');
    var padrao = opcao.getAttribute('data-unidade');
    if (unidade && padrao) unidade.value = padrao;
  });

  doc.addEventListener('input', function (ev) {
    var tab = ev.target.closest ? ev.target.closest('table[data-linhas]') : null;
    if (tab) somarLinhas(tab);
  });

  // --------------------------------------------------- busca instantanea
  // Filtra as linhas ja carregadas, sem ir ao servidor. Serve para achar um
  // item numa lista de 200 sem esperar recarregar a pagina.
  //   <input data-busca-viva="#tabela-lotes" ...>
  function filtrar(campo) {
    var tabela = doc.querySelector(campo.getAttribute('data-busca-viva'));
    if (!tabela) return;
    var termo = campo.value.trim().toLowerCase();
    var linhas = tabela.tBodies[0] ? tabela.tBodies[0].rows : [];
    var achou = 0;
    for (var i = 0; i < linhas.length; i++) {
      var bate = !termo || linhas[i].textContent.toLowerCase().indexOf(termo) > -1;
      linhas[i].classList.toggle('oculto-filtro', !bate);
      if (bate) achou++;
    }
    var contador = doc.querySelector('[data-busca-contador]');
    if (contador) {
      contador.textContent = termo
        ? achou + (achou === 1 ? ' linha encontrada' : ' linhas encontradas')
        : '';
    }
    var nada = doc.querySelector('[data-busca-vazio]');
    if (nada) nada.classList.toggle('oculto', achou > 0);
  }

  doc.addEventListener('input', function (ev) {
    if (ev.target.hasAttribute && ev.target.hasAttribute('data-busca-viva')) filtrar(ev.target);
  });

  // Barra "/" leva o cursor direto para a busca da tela, como nos sistemas
  // que o operador ja usa no navegador.
  doc.addEventListener('keydown', function (ev) {
    if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var alvo = ev.target.tagName;
    if (alvo === 'INPUT' || alvo === 'TEXTAREA' || alvo === 'SELECT') return;
    var busca = doc.querySelector('[data-busca-viva], input[type=search]');
    if (busca) { ev.preventDefault(); busca.focus(); busca.select(); }
  });

  // ----------------------------------------------------- modais de motivo
  doc.addEventListener('click', function (ev) {
    var abrir = ev.target.closest('[data-modal]');
    if (abrir) {
      ev.preventDefault();
      var dlg = doc.querySelector(abrir.getAttribute('data-modal'));
      if (dlg && dlg.showModal) dlg.showModal();
      var campo = dlg && dlg.querySelector('textarea, input[type=text]');
      if (campo) setTimeout(function () { campo.focus(); }, 60);
    }
    var fechar = ev.target.closest('[data-fechar-modal]');
    if (fechar) {
      ev.preventDefault();
      var d = fechar.closest('dialog');
      if (d) d.close();
    }
  });

  // Fecha o modal ao clicar fora dele
  doc.addEventListener('click', function (ev) {
    if (ev.target.tagName !== 'DIALOG') return;
    var caixa = ev.target.getBoundingClientRect();
    var fora = ev.clientX < caixa.left || ev.clientX > caixa.right ||
               ev.clientY < caixa.top || ev.clientY > caixa.bottom;
    if (fora) ev.target.close();
  });

  // ------------------------------------------------- filtros que se aplicam
  doc.addEventListener('change', function (ev) {
    if (ev.target.closest('[data-filtro-auto]')) ev.target.form.submit();
  });

  // --------------------------------------------------------------- imprimir
  doc.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-imprimir]')) {
      ev.preventDefault();
      window.print();
    }
  });

  // ------------------------------------------------------------ copiar texto
  // Uso: <button data-copiar="0001-2026">
  doc.addEventListener('click', function (ev) {
    var alvo = ev.target.closest('[data-copiar]');
    if (!alvo || !navigator.clipboard) return;
    ev.preventDefault();
    navigator.clipboard.writeText(alvo.getAttribute('data-copiar')).then(function () {
      avisar('Copiado: ' + alvo.getAttribute('data-copiar'));
    });
  });

  // ------------------------------------------------------------- ao carregar
  doc.addEventListener('DOMContentLoaded', function () {
    var forms = doc.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) recalcular(forms[i]);

    var primeiro = doc.querySelector('[data-foco]');
    if (primeiro) primeiro.focus();

    var tabelas = doc.querySelectorAll('table[data-linhas]');
    for (var t = 0; t < tabelas.length; t++) somarLinhas(tabelas[t]);

    // Barras de saldo crescem a partir do zero: o olho percebe a proporcao
    var barras = doc.querySelectorAll('.barra .parte[data-largura]');
    for (var b = 0; b < barras.length; b++) {
      (function (barra) {
        barra.style.width = '0';
        requestAnimationFrame(function () {
          barra.style.width = barra.getAttribute('data-largura');
        });
      })(barras[b]);
    }
  });

  // ------------------------------------------------- instalar como aplicativo
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/estatico/sw.js', { scope: '/' }).catch(function () {
        /* sem service worker o sistema funciona igual, so nao instala */
      });
    });
  }

  var convite = null;
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    convite = ev;
    var botao = doc.querySelector('[data-instalar]');
    if (botao) botao.classList.remove('oculto');
  });

  doc.addEventListener('click', function (ev) {
    if (!ev.target.closest('[data-instalar]') || !convite) return;
    ev.preventDefault();
    convite.prompt();
    convite = null;
    var botao = doc.querySelector('[data-instalar]');
    if (botao) botao.classList.add('oculto');
  });
})();
