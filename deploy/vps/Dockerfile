# Hub de Gestão · imagem de produção (padrão do Certato).
# Construída no runner descartável do GitHub, sem segredos de runtime: os segredos ficam
# só em /opt/hub-gestao/shared/.env.production na VPS. Contexto do build: a pasta app/.
# A imagem roda sem root e com o sistema de arquivos somente leitura (docker-compose.yml).

FROM node:22.23.1-bookworm-slim AS dependencias

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.23.1-bookworm-slim AS construcao

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

ARG APP_VERSION=desenvolvimento
ARG NEXT_PUBLIC_APP_URL=https://hub.harmonydigital.com.br
ARG NEXT_PUBLIC_SUPABASE_URL=https://supabase.harmonydigital.com.br
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=

ENV APP_VERSION=$APP_VERSION
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

COPY --from=dependencias /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22.23.1-bookworm-slim AS execucao

ARG APP_VERSION=desenvolvimento

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV APP_VERSION=$APP_VERSION

LABEL org.opencontainers.image.source="https://github.com/Harmony-Digital/hub-gestao"
LABEL org.opencontainers.image.revision=$APP_VERSION

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home-dir /app nextjs

COPY --from=construcao --chown=nextjs:nodejs /app/public ./public
COPY --from=construcao --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=construcao --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=construcao --chown=nextjs:nodejs /app/scripts/cron-tick.mjs ./scripts/cron-tick.mjs

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
