# ── Stage 1: Install dependencies ─────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# ── Stage 2: Build Next.js ─────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
# Uses Debian Bookworm (glibc) so Bedrock binary also works.
FROM node:22-bookworm-slim AS runner

# Install Java 21 for Minecraft Java Edition.
# Remove this block if you only use Bedrock.
RUN apt-get update && apt-get install -y --no-install-recommends \
        openjdk-21-jre-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Default Minecraft directory (overridable via docker-compose / env file)
ENV MINECRAFT_DIR=/opt/minecraft

# Copy Next.js standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static  ./.next/static
COPY --from=builder /app/public        ./public

# Ensure Minecraft mount point exists
RUN mkdir -p /opt/minecraft

# Panel UI
EXPOSE 3000
# Minecraft Java Edition
EXPOSE 25565
# Minecraft Bedrock Edition (UDP)
EXPOSE 19132/udp

CMD ["node", "server.js"]
