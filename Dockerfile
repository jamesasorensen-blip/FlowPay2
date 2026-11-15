FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY index.html server.js manifest.json icon-192.png icon-512.png ./
COPY scripts/ ./scripts/
COPY manual-account.mjs manual-budget-store.mjs manual-ledger.mjs manual-mfa.mjs manual-mfa-ui.mjs ./
RUN node scripts/build-manual-account.mjs
EXPOSE 10000
USER node
CMD ["node", "server.js"]
