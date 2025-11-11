# Stage 1: Builder
# Build the TypeScript application
FROM node:20-bookworm-slim AS builder

WORKDIR /build

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Compile TypeScript to JavaScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Stage 2: Runtime
# Create minimal production image with LibreOffice
FROM debian:bookworm-slim

# Install Node.js 20 from NodeSource repository
RUN apt-get update && \
    apt-get install -y ca-certificates curl gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list

# Enable contrib repository for ttf-mscorefonts-installer
RUN echo "deb http://deb.debian.org/debian bookworm contrib" >> /etc/apt/sources.list

# Install runtime dependencies:
# - nodejs: Node.js runtime
# - libreoffice-writer-nogui: LibreOffice without GUI for document conversion
# - libreoffice-java-common: Java support for LibreOffice
# - ghostscript: PDF processing
# - fonts-dejavu fonts-liberation: Common fonts
# - ttf-mscorefonts-installer: Microsoft core fonts (Arial, Times New Roman, etc.)
# - curl: For health checks
RUN apt-get update && \
    echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections && \
    apt-get install -y \
        nodejs \
        libreoffice-writer-nogui \
        libreoffice-java-common \
        ghostscript \
        fonts-dejavu \
        fonts-liberation \
        ttf-mscorefonts-installer \
        curl \
        && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user with fixed UID/GID
RUN groupadd -r -g 1000 appuser && \
    useradd -r -u 1000 -g appuser -m -s /bin/bash appuser

# Set working directory
WORKDIR /app

# Copy compiled code from builder
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package*.json ./

# Create /tmp directory and set permissions
# LibreOffice and document conversion need write access to /tmp
RUN mkdir -p /tmp && \
    chmod 1777 /tmp && \
    chown -R appuser:appuser /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV TMPDIR=/tmp

# Expose application port
EXPOSE 8080

# Add health check
# Check every 30 seconds, timeout after 10 seconds, start after 60 seconds, allow 3 retries
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/healthz || exit 1

# Switch to non-root user
USER appuser

# Start the application
CMD ["node", "dist/server.js"]
