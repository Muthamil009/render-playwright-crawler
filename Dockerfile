# Use Playwright base image (includes browsers)
FROM mcr.microsoft.com/playwright:latest

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package.json package-lock.json* ./

# Install deps
RUN npm ci --unsafe-perm

# Copy rest
COPY . .

# Expose port
EXPOSE 3000

# Use non-root uid in Playwright image if you like; but default should work
CMD ["node", "server.js"]
