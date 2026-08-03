# =============================================================================
# Custom RabbitMQ image with automatic initialization.
#
# Extends rabbitmq:4-management-alpine with:
#   1. The init script (scripts/init-rabbitmq.sh) that creates syntaro-monitor
#      user, /syntaro-dev vhost, and sets permissions
#   2. An entrypoint wrapper that runs the init script after the server
#      is ready, then hands over to RabbitMQ
#
# Build:
#   docker build -t syntaro-rabbitmq -f docker/rabbitmq/Dockerfile .
#
# Or used directly in docker-compose.yml via the build context.
# =============================================================================

FROM rabbitmq:4-management-alpine

# Copy initialization script
COPY scripts/init-rabbitmq.sh /opt/rabbitmq/init-rabbitmq.sh
RUN chmod +x /opt/rabbitmq/init-rabbitmq.sh

# Copy entrypoint wrapper
COPY docker/rabbitmq/entrypoint-wrapper.sh /opt/rabbitmq/entrypoint-wrapper.sh
RUN chmod +x /opt/rabbitmq/entrypoint-wrapper.sh

# Replace the official entrypoint with our wrapper
# (the official CMD "rabbitmq-server" is passed through as args)
ENTRYPOINT ["/opt/rabbitmq/entrypoint-wrapper.sh"]
CMD ["rabbitmq-server"]

LABEL org.opencontainers.image.description="SYNTARO custom RabbitMQ image with automatic init"
LABEL org.opencontainers.image.source="https://github.com/tamnguyen08/solving_tickets_as_a_service"
