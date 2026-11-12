FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY index.html server.js manifest.json icon-192.png icon-512.png ./
COPY scripts/build-guest-demo.mjs scripts/guest-workspace-runtime.txt ./scripts/
RUN node scripts/build-guest-demo.mjs
EXPOSE 10000
USER node
CMD ["node", "server.js"]
