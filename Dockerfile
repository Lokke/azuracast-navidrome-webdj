# Multi-stage build for WebDJ application
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Set build-time environment variables (will be passed from docker-compose)
ARG VITE_STREAM_USERNAME
ARG VITE_STREAM_PASSWORD
ARG VITE_STREAM_SERVER
ARG VITE_STREAM_PORT
ARG VITE_STREAM_MOUNT
ARG VITE_NAVIDROME_URL
ARG VITE_NAVIDROME_USERNAME
ARG VITE_NAVIDROME_PASSWORD
ARG VITE_USE_UNIFIED_LOGIN
ARG VITE_UNIFIED_USERNAME
ARG VITE_UNIFIED_PASSWORD

# Create .env file for Vite build only if variables are provided
RUN if [ -n "$VITE_STREAM_USERNAME" ]; then \
        echo "VITE_STREAM_USERNAME=${VITE_STREAM_USERNAME}" > .env && \
        echo "VITE_STREAM_PASSWORD=${VITE_STREAM_PASSWORD}" >> .env && \
        echo "VITE_STREAM_SERVER=${VITE_STREAM_SERVER}" >> .env && \
        echo "VITE_STREAM_PORT=${VITE_STREAM_PORT}" >> .env && \
        echo "VITE_STREAM_MOUNT=${VITE_STREAM_MOUNT}" >> .env; \
    fi && \
    if [ -n "$VITE_NAVIDROME_URL" ]; then \
        echo "VITE_NAVIDROME_URL=${VITE_NAVIDROME_URL}" >> .env && \
        echo "VITE_NAVIDROME_USERNAME=${VITE_NAVIDROME_USERNAME}" >> .env && \
        echo "VITE_NAVIDROME_PASSWORD=${VITE_NAVIDROME_PASSWORD}" >> .env; \
    fi && \
    if [ -n "$VITE_USE_UNIFIED_LOGIN" ]; then \
        echo "VITE_USE_UNIFIED_LOGIN=${VITE_USE_UNIFIED_LOGIN}" >> .env && \
        echo "VITE_UNIFIED_USERNAME=${VITE_UNIFIED_USERNAME}" >> .env && \
        echo "VITE_UNIFIED_PASSWORD=${VITE_UNIFIED_PASSWORD}" >> .env; \
    fi

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS runtime

# Install dumb-init and wget for proper signal handling and health checks
RUN apk add --no-cache dumb-init wget

# Set working directory first
WORKDIR /app

# Create app user and set ownership BEFORE copying files
RUN addgroup -g 1001 -S nodejs && \
    adduser -S webdj -u 1001 && \
    chown -R webdj:nodejs /app

# Copy built application from builder stage
COPY --from=builder --chown=webdj:nodejs /app/dist ./dist
COPY --from=builder --chown=webdj:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=webdj:nodejs /app/package*.json ./
COPY --from=builder --chown=webdj:nodejs /app/unified-server.js ./

# Copy environment template and start script
COPY --chown=webdj:nodejs .env.example .env.example
COPY --chown=webdj:nodejs start-services.sh ./
RUN chmod +x start-services.sh

# Create directory for user config
RUN mkdir -p /app/config && chown webdj:nodejs /app/config

# Expose ports
EXPOSE 5173 8082

# Switch to non-root user
USER webdj

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5173/ || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["./start-services.sh"]