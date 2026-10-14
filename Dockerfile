# Version web (serveur + interface), pour un hébergement accessible depuis
# n'importe quel navigateur, y compris sur mobile (installable en PWA).
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data
VOLUME /app/data
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
