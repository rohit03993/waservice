FROM node:20-alpine AS builder

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
# First build can take 10–20+ min on Windows; cache mount speeds later rebuilds.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --loglevel=info

COPY frontend/ ./
ENV API_INTERNAL_URL=http://backend:8000
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV API_INTERNAL_URL=http://backend:8000

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.js ./next.config.js

EXPOSE 3010
CMD ["npm", "run", "start"]
