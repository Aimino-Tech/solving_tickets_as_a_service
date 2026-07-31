# =============================================================================
# STAS Website — Static Site Dockerfile
# Serves the production website via Nginx (~20MB final image)
# =============================================================================

FROM nginx:1.27-alpine

# Remove default config
RUN rm -f /etc/nginx/conf.d/default.conf && \
    rm -rf /usr/share/nginx/html/*

# Custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy website files
COPY . /usr/share/nginx/html/

# Fix permissions
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

EXPOSE 80

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ || exit 1

LABEL maintainer="STAS Team"
LABEL description="STAS Production Website — stas.aimino.io"
LABEL org.opencontainers.image.source="https://github.com/Aimino-Tech/solving_tickets_as_a_service"
LABEL org.opencontainers.image.title="STAS Website"
LABEL org.opencontainers.image.licenses="MIT"
