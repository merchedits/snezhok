FROM node:20 AS builder

WORKDIR /app

# Copy workspace config and package.json files
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

# Install dependencies using npm (disable progress bar and audits to prevent hangs)
RUN npm config set progress=false && npm ci --no-audit --no-fund

# Copy source code
COPY . .

# Build frontend and backend
RUN npm run build

# Production image
FROM node:20-slim AS runner

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/web/package.json ./apps/web/

# Install only production dependencies
RUN npm config set progress=false && npm ci --omit=dev --no-audit --no-fund

# Copy compiled backend and frontend
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Also copy drizzle migrations folder so they run on startup
COPY --from=builder /app/apps/server/drizzle ./apps/server/drizzle

# Create directory for SQLite DB and file uploads
RUN mkdir -p /app/data/uploads

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL=/app/data/snezhok.db

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "apps/server"]
