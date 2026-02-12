FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY README.md ./
COPY .env.example ./

# Runtime files (state + runtime config) should be mounted as volumes in production.
RUN mkdir -p data config

CMD ["node", "src/index.js"]

