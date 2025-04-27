# Stage 1: Build the Playwright TypeScript code
FROM node:20 AS playwright_builder
WORKDIR /app/playwright_build

# Copy Playwright package manager files and install dependencies
# Assuming package-lock.json is the primary lock file based on playwright/Dockerfile using npm install
COPY playwright/package.json playwright/package-lock.json* ./
# If you use yarn or bun primarily, adjust the COPY line above and the RUN command below

COPY playwright/ .

RUN npm install

# Download Playwright browsers - the cache will be copied in the final stage
RUN npx playwright install --with-deps firefox

# Stage 2: Final application image with Python and Node.js runtime
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# Install Node.js (v20), curl/gpg for setup, and OS dependencies for Playwright/Firefox
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl gnupg ca-certificates && \
    # Add NodeSource repository for Node.js 20
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    NODE_MAJOR=20 && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    # Install Node.js and Playwright OS deps
    apt-get update && \
    apt-get install -y nodejs \
    libgtk-3-0 \
    libgbm-dev \
    libasound2 \
    libnss3 \
    libxss1 \
    libxtst6 \
    libx11-xcb1 \
    libdbus-glib-1-2 \
    # Clean up APT cache and remove temporary packages
    && apt-get purge -y --auto-remove curl gnupg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy Python application files and dependencies
COPY pyproject.toml .
COPY README.md .
COPY uv.lock .
COPY src/ src/

# Copy built Playwright app, node_modules, and browser cache from the builder stage
COPY --from=playwright_builder /app/playwright_build/dist /app/playwright/dist
COPY --from=playwright_builder /app/playwright_build/node_modules /app/playwright/node_modules
COPY --from=playwright_builder /root/.cache /root/.cache
# Copy package.json too, might be needed by the node script at runtime
COPY --from=playwright_builder /app/playwright_build/package.json /app/playwright/package.json

# Command to run the Python app using uv
# uv run should handle installing Python dependencies based on uv.lock/pyproject.toml
CMD ["uv", "run", "src/cerdo/agent/main.py"]