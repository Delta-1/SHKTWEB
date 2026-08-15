FROM node:22-alpine

# Fuso horário do Brasil para que datas e horários dos documentos batam
# com a operação, não com o UTC do servidor.
RUN apk add --no-cache tzdata postgresql16-client && \
    cp /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime && \
    echo "America/Sao_Paulo" > /etc/timezone
ENV TZ=America/Sao_Paulo

WORKDIR /app

# Camada de dependências separada: rebuilds de código não reinstalam pacotes
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/uploads /app/backups && chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
