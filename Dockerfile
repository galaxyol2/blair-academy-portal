FROM node:20-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/src ./backend/src

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "backend/src/server.js"]

