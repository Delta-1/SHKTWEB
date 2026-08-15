/**
 * Aritmetica decimal exata baseada em BigInt.
 *
 * Valores monetarios e quantidades NUNCA usam ponto flutuante binario
 * (secao 27 do documento de requisitos). Internamente cada numero e
 * guardado como um inteiro escalonado: 1.234,56 com escala 4 vira
 * 12345600n.
 *
 * Entrada aceita formato brasileiro ("1.234,56") e formato ISO ("1234.56").
 */

const ESCALA_PADRAO = 6;

function potencia10(n) {
  return 10n ** BigInt(n);
}

export class Decimal {
  /** @param {bigint} bruto valor ja escalonado @param {number} escala */
  constructor(bruto, escala = ESCALA_PADRAO) {
    this.bruto = bruto;
    this.escala = escala;
  }

  static zero(escala = ESCALA_PADRAO) {
    return new Decimal(0n, escala);
  }

  /**
   * Converte texto/numero para Decimal.
   * Aceita "1.234,56", "1234,56", "1234.56", 1234.56, null.
   */
  static de(valor, escala = ESCALA_PADRAO) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (valor instanceof Decimal) return valor.comEscala(escala);

    let texto = String(valor).trim();
    if (texto === '') return null;

    texto = texto.replace(/\s/g, '').replace(/[R$US]/gi, '');

    const temVirgula = texto.includes(',');
    const temPonto = texto.includes('.');

    if (temVirgula && temPonto) {
      // O ultimo separador que aparece e o decimal
      if (texto.lastIndexOf(',') > texto.lastIndexOf('.')) {
        texto = texto.replace(/\./g, '').replace(',', '.');
      } else {
        texto = texto.replace(/,/g, '');
      }
    } else if (temVirgula) {
      texto = texto.replace(',', '.');
    }
    // Se so tem ponto, assume que ja e o separador decimal.

    if (!/^-?\d*(\.\d*)?$/.test(texto)) {
      throw new ErroDecimal(`Número inválido: "${valor}"`);
    }

    const negativo = texto.startsWith('-');
    if (negativo) texto = texto.slice(1);

    const [inteira = '0', fracao = ''] = texto.split('.');
    const fracaoAjustada = (fracao + '0'.repeat(escala)).slice(0, escala);
    // Arredondamento "half up" a partir do primeiro digito descartado
    const proximoDigito = fracao.length > escala ? Number(fracao[escala]) : 0;

    let bruto = BigInt(inteira || '0') * potencia10(escala) + BigInt(fracaoAjustada || '0');
    if (proximoDigito >= 5) bruto += 1n;
    if (negativo) bruto = -bruto;

    return new Decimal(bruto, escala);
  }

  comEscala(novaEscala) {
    if (novaEscala === this.escala) return this;
    if (novaEscala > this.escala) {
      return new Decimal(this.bruto * potencia10(novaEscala - this.escala), novaEscala);
    }
    const divisor = potencia10(this.escala - novaEscala);
    const q = this.bruto / divisor;
    const r = this.bruto % divisor;
    const ajuste = (r < 0n ? -r : r) * 2n >= divisor ? (this.bruto < 0n ? -1n : 1n) : 0n;
    return new Decimal(q + ajuste, novaEscala);
  }

  mais(outro) {
    const b = Decimal.de(outro, this.escala);
    return new Decimal(this.bruto + (b ? b.bruto : 0n), this.escala);
  }

  menos(outro) {
    const b = Decimal.de(outro, this.escala);
    return new Decimal(this.bruto - (b ? b.bruto : 0n), this.escala);
  }

  vezes(outro) {
    const b = Decimal.de(outro, this.escala);
    if (!b) return Decimal.zero(this.escala);
    const produto = this.bruto * b.bruto; // escala dobrada
    return new Decimal(produto, this.escala * 2).comEscala(this.escala);
  }

  divididoPor(outro) {
    const b = Decimal.de(outro, this.escala);
    if (!b || b.bruto === 0n) throw new ErroDecimal('Divisão por zero.');
    // Amplia antes de dividir para preservar precisao
    const ampliado = this.bruto * potencia10(this.escala + 1);
    const q = ampliado / b.bruto;
    return new Decimal(q, this.escala + 1).comEscala(this.escala);
  }

  negado() {
    return new Decimal(-this.bruto, this.escala);
  }

  absoluto() {
    return new Decimal(this.bruto < 0n ? -this.bruto : this.bruto, this.escala);
  }

  ehZero() {
    return this.bruto === 0n;
  }
  ehPositivo() {
    return this.bruto > 0n;
  }
  ehNegativo() {
    return this.bruto < 0n;
  }

  compara(outro) {
    const b = Decimal.de(outro, this.escala);
    const bb = b ? b.bruto : 0n;
    return this.bruto === bb ? 0 : this.bruto > bb ? 1 : -1;
  }

  maiorQue(o) {
    return this.compara(o) > 0;
  }
  menorQue(o) {
    return this.compara(o) < 0;
  }
  igual(o) {
    return this.compara(o) === 0;
  }

  /** String no formato do Postgres NUMERIC: "1234.5600" */
  paraSql(casas = this.escala) {
    const d = this.comEscala(casas);
    const negativo = d.bruto < 0n;
    const abs = (negativo ? -d.bruto : d.bruto).toString().padStart(casas + 1, '0');
    const inteira = abs.slice(0, abs.length - casas) || '0';
    const fracao = casas > 0 ? '.' + abs.slice(abs.length - casas) : '';
    return `${negativo ? '-' : ''}${inteira}${fracao}`;
  }

  toString() {
    return this.paraSql();
  }

  toJSON() {
    return this.paraSql();
  }

  paraNumero() {
    return Number(this.paraSql());
  }
}

export class ErroDecimal extends Error {}

/** Atalho: Decimal.de com escala 4 (monetario). */
export const dinheiro = (v) => Decimal.de(v, 4);

/** Atalho: Decimal.de com escala 3 (quantidades em kg). */
export const quantidade = (v) => Decimal.de(v, 3);

/**
 * Formata um valor (string do Postgres, numero ou Decimal) no padrao pt-BR.
 * Ex.: formatar('1234.5', 2) => "1.234,50"
 */
export function formatar(valor, casas = 2) {
  if (valor === null || valor === undefined || valor === '') return '';
  const d = valor instanceof Decimal ? valor : Decimal.de(valor, Math.max(casas, 6));
  if (!d) return '';
  const texto = d.paraSql(casas);
  const negativo = texto.startsWith('-');
  const semSinal = negativo ? texto.slice(1) : texto;
  const [inteira, fracao] = semSinal.split('.');
  const comMilhar = inteira.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}${comMilhar}${fracao ? ',' + fracao : ''}`;
}

/** Formata quantidade em kg exibindo tambem toneladas. Ex.: "500.000,000 kg" */
export const formatarKg = (v) => formatar(v, 3);

/** Converte kg para toneladas formatadas. Ex.: '500000' => "500,000" */
export function kgParaToneladas(kg, casas = 3) {
  const d = Decimal.de(kg, 6);
  if (!d) return '';
  return formatar(d.divididoPor('1000'), casas);
}

export default Decimal;
