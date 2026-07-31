FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Vite inlines env vars at build time, so these must be present here — not at
# container start. Defaults suit the docker-compose setup, where nginx proxies
# /api to the backend service.
ARG VITE_API_BASE_URL=/api
ARG VITE_ALGORAND_NETWORK=testnet
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_ALGORAND_NETWORK=$VITE_ALGORAND_NETWORK

RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
