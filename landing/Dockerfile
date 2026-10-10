# ── Xiaolee Landing Page ── standalone static service
# Pure static HTML — fully decoupled from the Next.js frontend build.
FROM node:18-alpine
RUN npm install -g serve
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
WORKDIR /app
COPY *.html *.txt ./
COPY assets ./assets
RUN chown -R appuser:appgroup /app
USER appuser
EXPOSE 3000
CMD ["sh", "-c", "serve . -l ${PORT:-3000}"]
