FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28-alpine
# Readable by the unprivileged nginx user whatever the checkout's permissions: the VM
# deploy clones with umask 077, so the file arrives as owner-only.
COPY --chmod=644 nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
