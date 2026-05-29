# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Generate PWA icons with ImageMagick
RUN apk add --no-cache imagemagick

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p public/icons && \
    convert -size 192x192 xc:"#000000" \
      -fill "#00ff88" -draw "roundrectangle 16,16 176,176 20,20" \
      -fill "#000000" -font DejaVu-Sans-Bold -pointsize 28 \
      -gravity center -annotate 0 "WOD\nCAM" \
      public/icons/icon-192.png && \
    convert -size 512x512 xc:"#000000" \
      -fill "#00ff88" -draw "roundrectangle 40,40 472,472 48,48" \
      -fill "#000000" -font DejaVu-Sans-Bold -pointsize 72 \
      -gravity center -annotate 0 "WOD\nCAM" \
      public/icons/icon-512.png

RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
