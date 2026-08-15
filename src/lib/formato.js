/**
 * Formatacao e conversao usadas nas telas e documentos.
 * Todas as datas sao tratadas como data pura (sem fuso) quando vem de campos
 * DATE, evitando o classico "documento de 01/03 aparecendo como 28/02".
 */
import { Decimal, formatar } from './decimal.js';

export { formatar };

/** '2026-03-15' | Date -> '15/03/2026' */
export function data(valor) {
  if (!valor) return '';
  if (valor instanceof Date) {
    const a = valor.getFullYear();
    const m = String(valor.getMonth() + 1).padStart(2, '0');
    const d = String(valor.getDate()).padStart(2, '0');
    return `${d}/${m}/${a}`;
  }
  const texto = String(valor).slice(0, 10);
  const [a, m, d] = texto.split('-');
  return d ? `${d}/${m}/${a}` : texto;
}

/** Timestamp -> '15/03/2026 14:32' */
export function dataHora(valor) {
  if (!valor) return '';
  const dt = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const aa = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${aa} ${hh}:${mi}`;
}

/** Data para o atributo value de <input type="date"> */
export function dataInput(valor) {
  if (!valor) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

/** Timestamp para <input type="datetime-local"> */
export function dataHoraInput(valor) {
  if (!valor) return '';
  const dt = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(dt.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

export const hojeISO = () => new Date().toISOString().slice(0, 10);

/** Soma dias a uma data ISO. somarDias('2026-03-15', 10) -> '2026-03-25' */
export function somarDias(dataISO, dias) {
  const d = new Date(`${String(dataISO).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(dias || 0));
  return d.toISOString().slice(0, 10);
}

/** Diferenca em dias entre hoje e uma data (positivo = vencido ha N dias). */
export function diasVencidos(dataISO) {
  if (!dataISO) return 0;
  const alvo = new Date(`${String(dataISO).slice(0, 10)}T12:00:00Z`);
  const hoje = new Date(`${hojeISO()}T12:00:00Z`);
  return Math.round((hoje - alvo) / 86_400_000);
}

/** Dinheiro com simbolo. moeda('1234.5', 'R$') -> 'R$ 1.234,50' */
export function moeda(valor, simbolo = 'R$', casas = 2) {
  if (valor === null || valor === undefined || valor === '') return '';
  return `${simbolo} ${formatar(valor, casas)}`;
}

/** Quantidade em kg -> "500.000,000 kg" */
export function kg(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return `${formatar(valor, 3)} kg`;
}

/** Quantidade em kg exibida em toneladas -> "500,000 t" */
export function toneladas(valorKg, casas = 3) {
  if (valorKg === null || valorKg === undefined || valorKg === '') return '';
  const d = Decimal.de(valorKg, 6);
  return `${formatar(d.divididoPor('1000'), casas)} t`;
}

/** Converte kg para a unidade escolhida, usando o fator do cadastro. */
export function deKgPara(valorKg, fatorKg, casas = 3) {
  const d = Decimal.de(valorKg, 6);
  if (!d) return '';
  return formatar(d.divididoPor(fatorKg || 1), casas);
}

/** Rotulos amigaveis de status. */
export const STATUS_ROTULOS = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  AGUARDANDO_COMUNICADO: 'Aguardando comunicado',
  EM_ANDAMENTO: 'Em andamento',
  APROVADO: 'Aprovado',
  VALIDADA: 'Validada',
  VALIDADO: 'Validado',
  PROGRAMADO: 'Programado',
  EM_CARREGAMENTO: 'Em carregamento',
  EXPEDIDO: 'Expedido',
  PARCIALMENTE_RECEBIDO: 'Parcialmente recebido',
  RECEBIDO: 'Recebido',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
  CANCELADA: 'Cancelada',
  ABERTO: 'Aberto',
  PARCIAL: 'Parcial',
  PAGO: 'Pago',
  ATIVA: 'Ativa',
  CONSUMIDA: 'Consumida',
};

/** Classe CSS do "pill" de status. */
export const STATUS_CLASSES = {
  RASCUNHO: 'neutro',
  AGUARDANDO_APROVACAO: 'atencao',
  AGUARDANDO_COMUNICADO: 'atencao',
  EM_ANDAMENTO: 'info',
  EM_CARREGAMENTO: 'info',
  PROGRAMADO: 'info',
  APROVADO: 'ok',
  VALIDADA: 'ok',
  VALIDADO: 'ok',
  EXPEDIDO: 'ok',
  RECEBIDO: 'ok',
  CONCLUIDO: 'ok',
  PAGO: 'ok',
  ABERTO: 'atencao',
  PARCIAL: 'atencao',
  CANCELADO: 'erro',
  CANCELADA: 'erro',
};

export const rotuloStatus = (s) => STATUS_ROTULOS[s] || s || '';
export const classeStatus = (s) => STATUS_CLASSES[s] || 'neutro';

/** Escapa texto para uso em HTML gerado manualmente. */
export function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default {
  data,
  dataHora,
  dataInput,
  dataHoraInput,
  hojeISO,
  somarDias,
  diasVencidos,
  moeda,
  kg,
  toneladas,
  deKgPara,
  formatar,
  rotuloStatus,
  classeStatus,
  escapar,
};
