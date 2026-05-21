FROM node:22-alpine

# Set environment variable for Hugging Face Spaces port
ENV PORT=7860
EXPOSE 7860

# Create application directory
WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install packages
RUN npm ci --only=production

# Copy source code (except gitignored files via .dockerignore)
COPY . .

# Generate Bloom filter and Wallet table binaries from data/wallets.csv
RUN npm run build:wallets

# Adjust file permissions for non-root 'node' user used by Hugging Face
RUN chown -R node:node /app

# Run as non-root user
USER node

# Start the cloud miner script
CMD ["node", "scripts/cloud-miner.js"]
