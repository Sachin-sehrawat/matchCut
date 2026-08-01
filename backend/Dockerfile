FROM node:20-alpine
WORKDIR /app
# python3/make/g++ let better-sqlite3 (optionalDependency, used only when
# DB_DRIVER=sqlite) build from source if no prebuilt binary matches this arch.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
EXPOSE 4000
CMD ["node", "server.js"]
