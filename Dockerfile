FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --chown=node:node server.mjs integrations.mjs auth.mjs db.mjs ./
COPY --chown=node:node public ./public
USER node
CMD ["node", "server.mjs"]
