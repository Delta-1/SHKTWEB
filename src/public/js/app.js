/* ERP SHKT - comportamentos de tela.
   Sem dependencias externas: o sistema precisa funcionar em conexao ruim
   e em navegador de celular antigo. */
(function () {
  'use strict';

  // ------------------------------------------------------------- menu movel
  document.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-abrir-menu]')) {
      document.body.classList.toggle('menu-aberto');
      return;
    }
    // fecha ao tocar fora
    if (document.body.classList.contains('menu-aberto') && !ev.target.closest('.lateral')) {
      document.body.classList.remove('menu-aberto');
    }
  });

  // ---------------------------------------------------- confirmacao de acao
  // Uso: <button data-confirmar="Cancelar o certificado 0003-2026?">
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    var pedido = form.getAttribute('data-confirmar');
    var botao = form.querySelector('[type=submit]:focus') || document.activeElement;
    if (!pedido && botao && botao.form === form) pedido = botao.getAttribute('data-confirmar');
    if (pedido && !window.confirm(pedido)) {
      ev.preventDefault();
      return;
    }
    travarEnvio(form);
  });

  // Impede duplo clique gerando dois documentos
  function travarEnvio(form) {
    var botoes = form.querySelectorAll('button[type=submit], input[type=submit]');
    setTimeout(function () {
      for (var i = 0; i < botoes.length; i++) {
        botoes[i].disabled = true;
        if (botoes[i].tagName === 'BUTTON' && !botoes[i].dataset.textoOriginal) {
          botoes[i].dataset.textoOriginal = botoes[i].innerHTML;
          botoes[i].innerHTML = 'Aguarde...';
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

  document.addEventListener(
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
  // Uso: data-calc-total="quantidade*preco" nos campos envolvidos.
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
      var custo = form.querySelector('[name=custo_tonelada]');
      var fator = unidade && unidade.selectedOptions[0]
        ? parseFloat(unidade.selectedOptions[0].getAttribute('data-fator') || '1')
        : 1;
      var toneladas = (numeroDe(qtd) * fator) / 1000;
      var total = toneladas * numeroDe(custo);
      alvo.value = total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Peso líquido = bruto − tara
    var liquido = form.querySelector('[name=peso_liquido]');
    if (liquido) {
      var bruto = form.querySelector('[name=peso_bruto]');
      var tara = form.querySelector('[name=peso_tara]');
      if (bruto && tara && (numeroDe(bruto) || numeroDe(tara))) {
        var l = numeroDe(bruto) - numeroDe(tara);
        liquido.value = l.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
      }
    }

    // Equivalência em kg/t exibida ao lado da quantidade
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

  document.addEventListener('input', function (ev) {
    if (ev.target.form) recalcular(ev.target.form);
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.form) recalcular(ev.target.form);
  });
  document.addEventListener('DOMContentLoaded', function () {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) recalcular(forms[i]);

    // Foco no primeiro campo util
    var primeiro = document.querySelector('[data-foco]');
    if (primeiro) primeiro.focus();
  });

  // ----------------------------------------------------- modais de motivo
  // Uso: <button data-modal="#modal-cancelar">
  document.addEventListener('click', function (ev) {
    var abrir = ev.target.closest('[data-modal]');
    if (abrir) {
      ev.preventDefault();
      var dlg = document.querySelector(abrir.getAttribute('data-modal'));
      if (dlg && dlg.showModal) dlg.showModal();
      var campo = dlg && dlg.querySelector('textarea, input[type=text]');
      if (campo) setTimeout(function () { campo.focus(); }, 50);
    }
    var fechar = ev.target.closest('[data-fechar-modal]');
    if (fechar) {
      ev.preventDefault();
      var d = fechar.closest('dialog');
      if (d) d.close();
    }
  });

  // ------------------------------------------------- filtros que se aplicam
  document.addEventListener('change', function (ev) {
    if (ev.target.closest('[data-filtro-auto]')) ev.target.form.submit();
  });

  // --------------------------------------------------------------- imprimir
  document.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-imprimir]')) {
      ev.preventDefault();
      window.print();
    }
  });

  // ------------------------------------------------- instalar como aplicativo
  // Só faz sentido em HTTPS (ou localhost). Guarda em cache apenas os arquivos
  // estáticos — nunca dados do ERP. Ver src/public/sw.js.
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/estatico/sw.js', { scope: '/' }).catch(function () {
        /* sem service worker o sistema funciona igual, só não instala */
      });
    });
  }

  // Botão "Instalar aplicativo" na tela de login, quando o navegador oferecer
  var convite = null;
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    convite = ev;
    var botao = document.querySelector('[data-instalar]');
    if (botao) botao.classList.remove('oculto');
  });

  document.addEventListener('click', function (ev) {
    if (!ev.target.closest('[data-instalar]') || !convite) return;
    ev.preventDefault();
    convite.prompt();
    convite = null;
    var botao = document.querySelector('[data-instalar]');
    if (botao) botao.classList.add('oculto');
  });
})();
