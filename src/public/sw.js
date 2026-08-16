/* ERP SHKT - service worker.
 *
 * REGRA DE OURO: este arquivo guarda em cache APENAS arquivos estáticos
 * (CSS, JS, fontes, ícones). Nenhuma página, nenhum dado do ERP.
 *
 * Motivo: saldo de estoque, saldo fumigado e títulos financeiros mudam a cada
 * operação. Um ERP que mostra número velho porque veio do cache é pior do que
 * um ERP fora do ar — o usuário toma decisão errada achando que está certo.
 *
 * SOBRE A VERSÃO DOS ARQUIVOS
 *
 * O HTML pede os estáticos com a impressão digital do conteúdo no endereço
 * (/estatico/css/app.css?v=1a2b3c4d). Endereço com marca é imutável: se o
 * conteúdo muda, o endereço muda junto. Por isso:
 *
 *   - endereço COM marca  -> cache primeiro (é sempre a versão certa);
 *   - endereço SEM marca  -> rede primeiro, cache só como rede de segurança.
 *
 * Sem essa distinção acontece o pior dos mundos, que foi o que aconteceu:
 * HTML novo servido com CSS velho do cache, e a tela chega quebrada para
 * quem já tinha usado o sistema antes.
 */
const VERSAO = 'shkt-estatico-v3';

self.addEventListener('install', () => self.skipWaiting());

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

  if (url.searchParams.has('v')) {
    // Imutável: responde do cache; se não tiver, busca e guarda.
    evento.respondWith(
      caches.match(req).then(
        (guardado) =>
          guardado ||
          fetch(req).then((resposta) => {
            if (resposta.ok) {
              const copia = resposta.clone();
              caches.open(VERSAO).then((c) => c.put(req, copia));
            }
            return resposta;
          })
      )
    );
    return;
  }

  // Sem marca (manifest, ícones soltos): rede primeiro, cache se a rede falhar
  evento.respondWith(
    fetch(req)
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(VERSAO).then((c) => c.put(req, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(req))
  );
});
