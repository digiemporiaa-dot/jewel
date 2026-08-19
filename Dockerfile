# ─── Maya Jewellers — production Docker image (Next.js standalone) ───────────
# Multi-stage build. Produces a small runtime image using Next.js `output:
# standalone`. Coolify-compatible.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ─── deps ───────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
# The `postinstall` script runs `prisma generate`, which needs the schema.
# Without this COPY, `npm ci` fails before any dependency is usable.
COPY prisma ./prisma
RUN npm ci

# ─── builder ────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma client is generated as part of `npm run build`.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── runner ─────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV AUTH_TRUST_HOST=true
ENV PORT=3000
# Next.js standalone binds to $HOSTNAME. Docker sets HOSTNAME to the container
# id, so the server would listen only on the container's own IP and the
# healthcheck against 127.0.0.1 would be refused. Bind to all interfaces.
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server + static assets + public.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma client runtime + engine, needed by the app at request time.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

# The migration CLI lives in its own prefix. Copying node_modules/prisma out of
# the builder does not work: the CLI pulls in a large dependency tree (effect,
# @prisma/config and friends) that a cherry-picked copy always leaves behind.
# Installing it here keeps that tree intact without dragging the whole builder
# node_modules into the runtime image. Keep the version in step with the
# `prisma` devDependency in package.json.
RUN npm install --prefix /opt/prisma-cli prisma@6.19.3 \
  && npm cache clean --force

USER nextjs
EXPOSE 3000

# Readiness probe — Coolify and `docker compose` both read this. `wget` ships with
# BusyBox in the alpine base, so no extra package is needed. The generous
# start-period covers first boot while migrations run.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

# `server.js` is emitted by Next.js standalone output.
# `npx` resolves through node_modules/.bin, which this stage does not copy, so
# the Prisma CLI is invoked directly at its package entry point instead.
CMD ["sh", "-c", "node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema=/app/prisma/schema.prisma && node server.js"]
