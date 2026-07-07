# ── Salon Platform ──
FROM node:20-bookworm-slim

# better-sqlite3 needs build tools for its native addon
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# Persist database + uploads on a mounted volume (Railway/Render disk at /data).
# PORT is provided by the host at runtime; don't hardcode it.
ENV DB_PATH=/data/salon.db
ENV UPLOAD_DIR=/data/uploads
ENV NODE_ENV=production
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "server.js"]
