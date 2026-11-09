FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY index.html server.js ./
EXPOSE 10000
USER node
CMD ["node", "server.js"]
