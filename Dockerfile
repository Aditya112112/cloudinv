FROM node:18-alpine

WORKDIR /app

# Copy package files first (for caching)
COPY backend/package*.json ./backend/

RUN cd backend && npm install

# Copy all source files
COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 3000

CMD ["node", "backend/server.js"]