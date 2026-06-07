FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .
RUN mkdir -p /app/data/media && chown -R node:node /app/data

ENV NODE_ENV=production
ENV PORT=5173

EXPOSE 5173

USER node

CMD ["npm", "start"]
