/**
 * Endereco versionado dos arquivos estaticos.
 *
 * POR QUE ISTO EXISTE
 *
 * O sistema guarda CSS e JS em cache (service worker, para funcionar em
 * conexao ruim). Se a folha de estilo muda mas o endereco continua o mesmo,
 * o navegador serve a versao velha junto com o HTML novo — e a tela chega
 * inteira quebrada para quem ja tinha aberto o sistema antes.
 *
 * A correcao e o endereco carregar a impressao digital do conteudo:
 *
 *   /estatico/css/app.css?v=1a2b3c4d
 *
 * Mudou o arquivo, muda o endereco, e nao existe cache velho para ser
 * servido. Como o endereco passa a ser imutavel, guardar em cache para
 * sempre vira a coisa certa a fazer, e nao um risco.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from '../config.js';

const RAIZ = path.join(ROOT, 'src', 'public');
const cache = new Map();

function impressaoDigital(caminhoRelativo) {
  if (cache.has(caminhoRelativo)) return cache.get(caminhoRelativo);

  let marca;
  try {
    const conteudo = fs.readFileSync(path.join(RAIZ, caminhoRelativo));
    marca = crypto.createHash('sha1').update(conteudo).digest('hex').slice(0, 10);
  } catch {
    // Arquivo ausente nao pode derrubar a pagina: cai para o endereco simples
    marca = null;
  }

  cache.set(caminhoRelativo, marca);
  return marca;
}

/**
 * @param {string} caminho relativo a src/public, ex.: 'css/app.css'
 * @returns {string} '/estatico/css/app.css?v=1a2b3c4d'
 */
export function estatico(caminho) {
  const limpo = String(caminho).replace(/^\/+/, '');
  const marca = impressaoDigital(limpo);
  return `/estatico/${limpo}${marca ? `?v=${marca}` : ''}`;
}

/** Lista de enderecos versionados que o service worker deve guardar. */
export function paraCache(caminhos) {
  return caminhos.map(estatico);
}

export default estatico;
