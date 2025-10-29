FROM nginx:alpine

# Install security updates
RUN apk update && apk upgrade && rm -rf /var/cache/apk/*

# Copy custom nginx configuration
COPY conf/default.conf /etc/nginx/conf.d/default.conf
COPY conf/security.conf /etc/nginx/conf.d/security.conf
COPY conf/ssl.conf /etc/nginx/conf.d/ssl.conf

# Create nginx user with proper permissions
RUN addgroup -g 101 -S nginx || true
RUN adduser -S -D -H -u 101 -h /var/cache/nginx -s /sbin/nologin -G nginx -g nginx nginx || true

# Set proper permissions
RUN chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    chown -R nginx:nginx /etc/nginx/conf.d

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]