# syntax=docker/dockerfile:1
# ---------- Build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# Install deps first (better layer caching). npm ci uses the committed lockfile
# for fast, reproducible installs; the cache mount keeps the npm cache warm.
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Build the production bundle
COPY . .
RUN npm run build

# ---------- Serve stage ----------
FROM nginx:alpine
# SPA routing + /api reverse-proxy to the backend container
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
