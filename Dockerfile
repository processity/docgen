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

# Enable contrib repository for ttf-mscorefonts-installer and backports for LibreOffice.
# Bookworm ships LibreOffice 7.4.7, which silently drops the table row that lands on a
# page boundary when a table splits across pages (OTO-4027: quote totals disappeared).
# Backports provides 25.2.x, which paginates those tables correctly.
RUN echo "deb http://deb.debian.org/debian bookworm contrib" >> /etc/apt/sources.list && \
    echo "deb http://deb.debian.org/debian bookworm-backports main" >> /etc/apt/sources.list

# Install runtime dependencies:
# - nodejs: Node.js runtime
# - libreoffice-writer-nogui: LibreOffice without GUI for document conversion (from backports)
# - libreoffice-java-common: Java support for LibreOffice (from backports, kept in step with core)
# - ghostscript: PDF processing
# - fonts-dejavu fonts-liberation: Common fonts
# - fonts-noto-cjk: Japanese regular/bold fallback when licensed Meiryo UI files are unavailable
# - ttf-mscorefonts-installer: Microsoft core fonts (Arial, Times New Roman, etc.)
# - fontconfig: Font discovery and Meiryo UI fallback configuration
# - curl: For health checks
RUN apt-get update && \
    echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections && \
    apt-get install -y -t bookworm-backports \
        libreoffice-writer-nogui \
        libreoffice-java-common \
        && \
    apt-get install -y \
        nodejs \
        ghostscript \
        fonts-dejavu \
        fonts-liberation \
        fonts-noto-cjk \
        ttf-mscorefonts-installer \
        fontconfig \
        curl \
        && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Include locally supplied, licensed Meiryo font files when present. The repository
# intentionally does not distribute Microsoft's proprietary font binaries.
COPY docker/fonts/ /usr/local/share/fonts/docgen/
COPY docker/fontconfig/60-docgen-japanese-fonts.conf /etc/fonts/conf.d/60-docgen-japanese-fonts.conf
RUN fc-cache -f

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
