# ── Stage 1: production dependencies only ─────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
# Skip husky git-hooks init (no .git in image; husky is a devDependency)
ENV HUSKY=0
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: build (TypeScript compilation) ───────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
ENV HUSKY=0
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 3: production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist

# swagger.yaml is resolved at runtime as dist/docs/swagger.yaml
# (src/app.ts uses new URL('../docs/swagger.yaml', import.meta.url) from dist/src/app.js)
COPY docs ./dist/docs

COPY package.json ./

RUN chown -R node:node /app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

USER node

CMD ["node", "dist/src/main.js"]
