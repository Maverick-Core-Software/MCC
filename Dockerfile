FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3010
ENV PROMETHEUS_URL=http://192.168.1.12:9090
ENV LLAMA_SERVER_URL=http://192.168.1.10:8080
COPY --from=build /app/dist ./dist
COPY server.mjs ./
EXPOSE 3010
CMD ["node", "server.mjs"]
