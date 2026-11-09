FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY index.html manifest.webmanifest server.js ./
COPY icon-192.png icon-512.png ./
EXPOSE 10000
USER node
CMD ["node", "server.js"]
