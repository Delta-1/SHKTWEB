/* ERP SHKT - service worker.
 *
 * REGRA DE OURO: este arquivo guarda em cache APENAS arquivos estáticos
 * (CSS, JS, ícones). Nenhuma página, nenhum dado do ERP.
 *
 * Motivo: saldo de estoque, saldo fumigado e títulos financeiros mudam a cada
 * operação. Um ERP que mostra número velho porque veio do cache é pior do que
 * um ERP fora do ar — o usuário toma decisão errada achando que está certo.
 */
const VERSAO = 'shkt-estatico-v1';
const ESTATICOS = [
  '/estatico/css/app.css',
  '/estatico/js/app.js',
  '/estatico/img/logo.svg',
  '/estatico/img/icone-192.png',
  '/estatico/img/icone-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ESTATICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  const url = new URL(req.url);

  // Tudo que não for arquivo estático vai direto para a rede, sempre.
  const ehEstatico =
    req.method === 'GET' &&
    url.origin === self.location.origin &&
    url.pathname.startsWith('/estatico/');

  if (!ehEstatico) return;

  // Estáticos: responde do cache e atualiza em segundo plano
  evento.respondWith(
    caches.match(req).then((guardado) => {
      const daRede = fetch(req)
        .then((resposta) => {
          if (resposta.ok) {
            const copia = resposta.clone();
            caches.open(VERSAO).then((c) => c.put(req, copia));
          }
          return resposta;
        })
        .catch(() => guardado);
      return guardado || daRede;
    })
  );
});
