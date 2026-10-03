FROM node:22.22.2-alpine

ENV NODE_ENV=production
WORKDIR /app

# Sólo dependencias de runtime (typeorm, pg): Node ejecuta el TypeScript directo, sin build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

USER node
EXPOSE 3000

# Liveness: la API responde. Con la BD caída /health da 503 y eso no reinicia la API.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r => process.exit(r.status === 200 || r.status === 503 ? 0 : 1), () => process.exit(1))"

CMD ["node", "src/main.ts"]
