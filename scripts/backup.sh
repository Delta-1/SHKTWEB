#!/bin/sh
# =====================================================================
# Backup do banco do ERP SHKT (seção 30).
#
# Gera um dump comprimido, VERIFICA a integridade do arquivo gerado e
# remove os backups mais antigos que RETENCAO_DIAS.
#
# Backup que nunca foi restaurado não é backup. Veja em README.md como
# testar a restauração — faça esse teste pelo menos uma vez por mês.
# =====================================================================
set -eu

BANCO="${DB_NAME:-shkt_erp}"
USUARIO="${DB_USER:-shkt}"
SERVIDOR="${DB_HOST:-banco}"
DESTINO="${BACKUP_DIR:-/backups}"
RETENCAO="${RETENCAO_DIAS:-30}"

CARIMBO=$(date +%Y%m%d-%H%M%S)
ARQUIVO="$DESTINO/shkt-$CARIMBO.dump"
REGISTRO="$DESTINO/backups.log"

mkdir -p "$DESTINO"

registrar() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') | $1" >> "$REGISTRO"
  echo "$1"
}

registrar "iniciando backup de $BANCO"

# Formato custom (-Fc): comprimido e restaurável seletivamente com pg_restore
if pg_dump -h "$SERVIDOR" -U "$USUARIO" -d "$BANCO" -Fc -f "$ARQUIVO"; then
  TAMANHO=$(du -h "$ARQUIVO" | cut -f1)

  # Verificação de integridade: se o pg_restore não conseguir ler o índice
  # do arquivo, o backup está corrompido e não serve para nada.
  if pg_restore --list "$ARQUIVO" > /dev/null 2>&1; then
    registrar "OK   $ARQUIVO ($TAMANHO) - integridade verificada"
  else
    registrar "ERRO $ARQUIVO falhou na verificação de integridade"
    exit 1
  fi
else
  registrar "ERRO falha ao gerar o dump de $BANCO"
  exit 1
fi

# Retenção
REMOVIDOS=$(find "$DESTINO" -name 'shkt-*.dump' -mtime "+$RETENCAO" -print -delete | wc -l)
[ "$REMOVIDOS" -gt 0 ] && registrar "retenção: $REMOVIDOS backup(s) com mais de $RETENCAO dias removido(s)"

registrar "backup concluído"
