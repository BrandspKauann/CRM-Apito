FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node server.mjs integrations.mjs index.html app.js style.css ./
RUN mkdir data && chown node:node data
USER node
CMD ["node", "server.mjs"]
