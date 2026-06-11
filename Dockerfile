# Multi-stage build for SilentOps Next.js 16 application
# Stage 1: Build stage
FROM node:22-alpine AS builder

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

WORKDIR /app

# Copy dependency files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build application (uses webpack as per package.json scripts)
RUN pnpm build

# Stage 2: Runtime stage
FROM node:22-alpine

# Install pnpm via corepack for the runtime (next start requires it)
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

WORKDIR /app

# Set production environment and enable demo seed mode by default
ENV NODE_ENV=production
ENV DEMO_SEED_MODE=true
ENV PORT=8080

# Copy built application from builder stage
# Next.js 16 standalone output (if configured in next.config.ts)
# Fallback: copy .next directory and node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public

# Expose port (Cloud Run will use PORT env var)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/status', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start the application
# next start reads PORT from the environment
CMD ["pnpm", "start"]
