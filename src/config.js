import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');

const bool = (v, padrao = false) => {
  if (v === undefined || v === null || v === '') return padrao;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(String(v).toLowerCase());
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  porta: Number(process.env.PORT || 3000),

  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://shkt:shkt@127.0.0.1:5432/shkt_erp',

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
  },

  timezone: process.env.TZ_APP || 'America/Sao_Paulo',
};

export default config;
