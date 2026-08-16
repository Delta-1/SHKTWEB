import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');

const bool = (v, padrao = false) => {
  if (v === undefined || v === null || v === '') return padrao;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(String(v).toLowerCase());
};

const ambiente = process.env.NODE_ENV || 'development';

/**
 * Em producao, faltar DATABASE_URL e erro de configuracao - nao pode virar
 * uma tentativa silenciosa de conectar no proprio container (127.0.0.1), que
 * produz um "ECONNREFUSED" confuso no log da hospedagem. Melhor parar na hora
 * dizendo exatamente o que falta.
 */
function urlDoBanco() {
  const url = process.env.DATABASE_URL;
  if (url) return url;

  if (ambiente === 'production') {
    throw new Error(
      'DATABASE_URL não está configurada.\n' +
        'Defina a variável de ambiente com o endereço do PostgreSQL.\n' +
        'No Railway, use a referência ao serviço do banco, por exemplo:\n' +
        '  DATABASE_URL = ${{Postgres.DATABASE_URL}}\n' +
        'Veja docs/PUBLICAR.md.'
    );
  }

  // Desenvolvimento: banco local padrao
  return 'postgres://shkt:shkt@127.0.0.1:5432/shkt_erp';
}

export const config = {
  env: ambiente,
  porta: Number(process.env.PORT || 3000),

  databaseUrl: urlDoBanco(),

  // Em provedores gerenciados (Supabase, Render, Neon) e necessario SSL.
  dbSsl: bool(process.env.DATABASE_SSL, false),

  sessao: {
    segredo: process.env.SESSION_SECRET || 'shkt-erp-desenvolvimento-trocar-em-producao',
    // horas de inatividade ate o logout automatico
    duracaoHoras: Number(process.env.SESSION_HOURS || 12),
    // exige HTTPS no cookie (ligar em producao atras de HTTPS)
    seguro: bool(process.env.SESSION_SECURE, false),
  },

  uploads: {
    diretorio: process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'),
    tamanhoMaxMb: Number(process.env.UPLOAD_MAX_MB || 20),
  },

  empresa: {
    nome: process.env.EMPRESA_NOME || 'SHKT INDÚSTRIA IMPORTAÇÃO & EXPORTAÇÃO LTDA',
    nomeCurto: process.env.EMPRESA_NOME_CURTO || 'SHKT',
    cnpj: process.env.EMPRESA_CNPJ || '',
    endereco: process.env.EMPRESA_ENDERECO || '',
    cidade: process.env.EMPRESA_CIDADE || '',
    telefone: process.env.EMPRESA_TELEFONE || '',
    email: process.env.EMPRESA_EMAIL || '',
  },

  regras: {
    // Vencimento padrao do titulo gerado pelo Certificado de Fumigacao (secao 11)
    diasVencimentoCertificado: Number(process.env.DIAS_VENCIMENTO_CERTIFICADO || 10),
    // Prazo padrao do titulo previsto ao aprovar um pedido de compra (secao 32)
    diasVencimentoCompra: Number(process.env.DIAS_VENCIMENTO_COMPRA || 30),
    // Prazo padrao do titulo previsto ao aprovar um pedido de venda
    diasVencimentoVenda: Number(process.env.DIAS_VENCIMENTO_VENDA || 30),
  },

  timezone: process.env.TZ_APP || 'America/Sao_Paulo',
};

export default config;
