FROM node:22-slim AS development
WORKDIR /app
RUN apt update && apt install -y procps
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "start:dev"]

FROM development AS builder
WORKDIR /app
RUN npm run build

FROM node:22-slim AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/main"]