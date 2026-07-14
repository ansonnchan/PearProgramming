FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG VITE_API_URL
ARG VITE_STOMP_URL
ARG VITE_YJS_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_STOMP_URL=${VITE_STOMP_URL}
ENV VITE_YJS_URL=${VITE_YJS_URL}
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --output-document=/dev/null http://127.0.0.1:8080/health || exit 1
