FROM node:20-alpine AS build

WORKDIR /app

# npm install, not npm ci: package-lock.json is stale until someone with Node
# runs npm install once. See CLAUDE.md "Current state".
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
# The container keeps its own disk, so it uses the disk store rather than Blobs.
ENV NETFILESHARE_STORE=disk

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server ./server
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/storage /app/server-data

EXPOSE 8787

CMD ["npm", "run", "server"]
