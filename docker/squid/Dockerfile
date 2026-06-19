FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    squid=6.6-1ubuntu1 \
    && rm -rf /var/lib/apt/lists/*

COPY squid.conf /etc/squid/squid.conf
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh && \
    mkdir -p /var/log/squid /var/spool/squid && \
    chown -R proxy:proxy /var/log/squid /var/spool/squid

USER proxy
EXPOSE 3128

ENTRYPOINT ["/entrypoint.sh"]
