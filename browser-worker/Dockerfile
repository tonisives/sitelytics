FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY worker.mjs extract.mjs ./
USER node
CMD ["node", "worker.mjs"]
