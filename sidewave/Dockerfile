# --- 1. asama: React arayuzunu derle -----------------------------------
FROM node:22.22.0-slim AS derleme
WORKDIR /derleme

# Bagimliliklar once — kaynak degisince npm install tekrar calismasin
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY web/ ./
RUN npm run build          # -> /derleme/dist

# --- 2. asama: calisma imaji -------------------------------------------
FROM node:22.22.0-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY server.js ./
COPY src/ ./src/
COPY openapi.json ./
COPY --from=derleme /derleme/dist ./public

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/sidewave.sqlite
ENV JOBS_ROOT=/jobs
EXPOSE 4444
HEALTHCHECK --interval=30s --timeout=15s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4444/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
