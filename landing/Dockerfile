# ── Xiaolee Landing Page ── standalone service (Vite + React), decoupled from frontend/
# Build context is landing/. Stage 1 builds the bundle, stage 2 serves only the static output.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
# Pinned: caching/compression behaviour (public/serve.json, ETag/304, brotli) was verified on this version.
RUN npm install -g serve@14.2.6
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
WORKDIR /app
COPY --from=build /app/dist ./
RUN chown -R appuser:appgroup /app
USER appuser
EXPOSE 3000
CMD ["sh", "-c", "serve . -l ${PORT:-3000}"]
