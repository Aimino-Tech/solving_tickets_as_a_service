FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    iptables \
    && rm -rf /var/lib/apt/lists/*

RUN adduser --disabled-password --gecos '' stas-eval

RUN mkdir -p /eval && chown stas-eval:stas-eval /eval

COPY scripts/restrict-network.sh /usr/local/bin/restrict-network.sh
RUN chmod +x /usr/local/bin/restrict-network.sh

USER stas-eval
WORKDIR /eval

ENV STAS_EVAL_MODE=true
ENV HOME=/eval

ENTRYPOINT ["/usr/local/bin/restrict-network.sh"]

CMD ["/bin/bash"]
