# Dev container for the "just run it" path: `docker compose up`.
# Pinned to a specific Node so a clone builds identically years from now.
FROM node:22-bookworm-slim

WORKDIR /app

# Install deps first so this layer caches across source edits.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173
# --host is set in vite.config, but pass it here too so the container is reachable.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
