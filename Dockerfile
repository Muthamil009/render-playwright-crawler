# Dockerfile (Option B) - Node base + install system deps + Playwright browsers
FROM node:18-slim

# Install required OS packages for Playwright browsers
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    gnupg2 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    fonts-liberation \
    libappindicator3-1 \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install node modules (use npm ci if you have lockfile)
# Use --unsafe-perm because Playwright may need to run native install steps as root inside container
RUN if [ -f package-lock.json ]; then npm ci --unsafe-perm; else npm install --unsafe-perm; fi

# Install Playwright browser binaries (matching the installed playwright version).
# --with-deps attempts to ensure required OS deps — but we already installed many above.
RUN npx playwright install --with-deps

# Copy application code
COPY . .

# Expose port (Render provides PORT env var)
ENV PORT=3000
EXPOSE 3000

# Start command
CMD ["node", "server.js"]
