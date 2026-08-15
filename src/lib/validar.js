/**
 * Validacao e normalizacao de dados vindos de formularios.
 * Sempre aplicada no servidor: o navegador ajuda o usuario, mas nao protege
 * o banco de dados.
 */
import { Decimal } from './decimal.js';
import { ErroValidacao } from './erros.js';

/** Texto obrigatorio. */
export function texto(valor, campo, { obrigatorio = false, max = null, min = null } = {}) {
  const v = valor === null || valor === undefined ? '' : String(valor).trim();
  if (!v) {
    if (obrigatorio) throw new ErroValidacao(`O campo "${campo}" é obrigatório.`, campo);
    return null;
  }
  if (max && v.length > max)
    throw new ErroValidacao(`O campo "${campo}" deve ter no máximo ${max} caracteres.`, campo);
  if (min && v.length < min)
    throw new ErroValidacao(`O campo "${campo}" deve ter no mínimo ${min} caracteres.`, campo);
  return v;
}

/** Numero decimal (aceita 1.234,56). Retorna string pronta para o Postgres. */
export function decimal(
  valor,
  campo,
  { obrigatorio = false, escala = 4, min = null, max = null, positivo = false } = {}
) {
  const bruto = valor === null || valor === undefined ? '' : String(valor).trim();
  if (!bruto) {
    if (obrigatorio) throw new ErroValidacao(`O campo "${campo}" é obrigatório.`, campo);
    return null;
  }

  let d;
  try {
    d = Decimal.de(bruto, escala);
  } catch {
    throw new ErroValidacao(`O campo "${campo}" contém um número inválido: "${bruto}".`, campo);
  }
  if (!d) {
    if (obrigatorio) throw new ErroValidacao(`O campo "${campo}" é obrigatório.`, campo);
    return null;
  }

  if (positivo && !d.ehPositivo())
    throw new ErroValidacao(`O campo "${campo}" deve ser maior que zero.`, campo);
  if (min !== null && d.menorQue(min))
    throw new ErroValidacao(`O campo "${campo}" não pode ser menor que ${min}.`, campo);
  if (max !== null && d.maiorQue(max))
    throw new ErroValidacao(`O campo "${campo}" não pode ser maior que ${max}.`, campo);

  return d.paraSql(escala);
}

/** Quantidade (escala 3, sempre em kg apos conversao). */
export const quantidade = (valor, campo, opcoes = {}) =>
  decimal(valor, campo, { escala: 3, positivo: true, ...opcoes });

/** Valor monetario (escala 4). */
export const dinheiro = (valor, campo, opcoes = {}) => decimal(valor, campo, { escala: 4, ...opcoes });

/** Inteiro / id de chave estrangeira. */
export function inteiro(valor, campo, { obrigatorio = false, min = null, max = null } = {}) {
  const bruto = valor === null || valor === undefined ? '' : String(valor).trim();
  if (!bruto) {
    if (obrigatorio) throw new ErroValidacao(`O campo "${campo}" é obrigatório.`, campo);
    return null;
  }
  if (!/^-?\d+$/.test(bruto))
    throw new ErroValidacao(`O campo "${campo}" deve ser um número inteiro.`, campo);
  const n = Number(bruto);
  if (min !== null && n < min)
    throw new ErroValidacao(`O campo "${campo}" não pode ser menor que ${min}.`, campo);
  if (max !== null && n > max)
    throw new ErroValidacao(`O campo "${campo}" não pode ser maior que ${max}.`, campo);
  return n;
}

/** Chave estrangeira obrigatoria ou nao. */
export const id = (valor, campo, opcoes = {}) => inteiro(valor, campo, { min: 1, ...opcoes });

/** Data no formato ISO (yyyy-mm-dd) ou brasileiro (dd/mm/yyyy). */
export function data(valor, campo, { obrigatorio = false } = {}) {
  const bruto = valor === null || valor === undefined ? '' : String(valor).trim();
  if (!bruto) {
    if (obrigatorio) throw new ErroValidacao(`O campo "${campo}" é obrigatório.`, campo);
    return null;
  }

  let iso = bruto;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(bruto)) {
    const [d, m, a] = bruto.split('/');
    iso = `${a}-${m}-${d}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso))
    throw new ErroValidacao(`O campo "${campo}" contém uma data inválida.`, campo);

  const dt = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(dt.getTime()))
    throw new ErroValidacao(`O campo "${campo}" contém uma data inválida.`, campo);

  return iso;
}

/** Data e hora (<input type="datetime-local">). */
export function dataHora(valor, campo, { obrigatorio = false } = {}) {
  const bruto = valor === null || valor === undefined ? '' : String(valor).trim();
  if (!bruto) {
    if (obrigatorio) throw new ErroValidacao(`O campo "${campo}" é obrigatório.`, campo);
    return null;
  }
  const dt = new Date(bruto);
  if (Number.isNaN(dt.getTime()))
    throw new ErroValidacao(`O campo "${campo}" contém uma data/hora inválida.`, campo);
  return dt.toISOString();
}

/** Valor obrigatoriamente dentro de uma lista. */
export function escolha(valor, campo, opcoes, { obrigatorio = false, padrao = null } = {}) {
  const bruto = valor === null || valor === undefined ? '' : String(valor).trim();
  if (!bruto) {
    if (obrigatorio) throw new ErroValidacao(`O campo "${campo}" é obrigatório.`, campo);
    return padrao;
  }
  if (!opcoes.includes(bruto))
    throw new ErroValidacao(`O valor informado em "${campo}" não é válido.`, campo);
  return bruto;
}

/** Checkbox de formulario HTML. */
export function booleano(valor) {
  return ['1', 'true', 'on', 'sim'].includes(String(valor ?? '').toLowerCase());
}

/** E-mail (validacao pratica, nao academica). */
export function email(valor, campo, { obrigatorio = false } = {}) {
  const v = texto(valor, campo, { obrigatorio });
  if (!v) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    throw new ErroValidacao(`O campo "${campo}" contém um e-mail inválido.`, campo);
  return v.toLowerCase();
}

/** Remove tudo que nao for digito (CPF/CNPJ/telefone). */
export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** Valida CPF ou CNPJ brasileiro pelos digitos verificadores. */
export function cpfCnpj(valor, campo, { obrigatorio = false, estrangeiro = false } = {}) {
  const v = texto(valor, campo, { obrigatorio });
  if (!v) return null;
  if (estrangeiro) return v; // RUC e documentos estrangeiros nao seguem a regra brasileira

  const d = soDigitos(v);
  if (d.length === 11) {
    if (!validarCPF(d)) throw new ErroValidacao(`O CPF informado em "${campo}" é inválido.`, campo);
    return d;
  }
  if (d.length === 14) {
    if (!validarCNPJ(d)) throw new ErroValidacao(`O CNPJ informado em "${campo}" é inválido.`, campo);
    return d;
  }
  throw new ErroValidacao(`O campo "${campo}" deve conter um CPF (11) ou CNPJ (14 dígitos).`, campo);
}

function validarCPF(cpf) {
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(cpf[i]) * (10 - i);
  let dv = ((soma * 10) % 11) % 10;
  if (dv !== Number(cpf[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(cpf[i]) * (11 - i);
  dv = ((soma * 10) % 11) % 10;
  return dv === Number(cpf[10]);
}

function validarCNPJ(cnpj) {
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base) => {
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const dv1 = calc(cnpj.slice(0, 12));
  if (dv1 !== Number(cnpj[12])) return false;
  const dv2 = calc(cnpj.slice(0, 13));
  return dv2 === Number(cnpj[13]);
}

/** Placa brasileira (ABC1234) ou Mercosul (ABC1D23). Aceita tambem estrangeiras. */
export function placa(valor, campo, { obrigatorio = false } = {}) {
  const v = texto(valor, campo, { obrigatorio, max: 10 });
  if (!v) return null;
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export default {
  texto,
  decimal,
  quantidade,
  dinheiro,
  inteiro,
  id,
  data,
  dataHora,
  escolha,
  booleano,
  email,
  cpfCnpj,
  placa,
  soDigitos,
};
