# ✅ Use Node 20 (Baileys requires >=18)
FROM node:20

# Create app directory
WORKDIR /app

# Copy package files first (for caching)
COPY package*.json ./

# Install dependencies using npm ci for faster & consistent builds
RUN npm ci --only=production

# Copy all project files
COPY . .

# Expose port (if your app runs a web/Express server)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV TZ=Asia/Kolkata

# Ensure session files persist across container restarts
VOLUME [ "/app/session" ]

# Optional: health check (ensures Railway auto-restarts if container fails)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('fs').accessSync('/app/index.js', fs.constants.R_OK)"

# ✅ Start the bot using npm
CMD ["npm", "start"]
