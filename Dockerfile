# ── build ──
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── run ──
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# receipts PDF worker thread (bundled by npm run build)
COPY --from=build /app/workers ./workers
# migrations + runner (applied on every start, safe to repeat)
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/db-migrate.js ./scripts/db-migrate.js
# first admin login:  docker compose exec app node scripts/create-account.js admin you@mail.com "Trust Name" Pass12345
COPY --from=build /app/scripts/create-account.js ./scripts/create-account.js
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/db-migrate.js && node server.js"]
