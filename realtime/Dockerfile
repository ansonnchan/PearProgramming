FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node src ./src

USER node
EXPOSE 1235

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:1235/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.cjs"]
