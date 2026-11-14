FROM docker:29.8.2-cli AS docker-cli
FROM ghcr.io/actions/actions-runner:2.338.2

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 ca-certificates openssh-client tini util-linux xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && gpasswd -d runner sudo \
    && mkdir -p /opt/actions-runner /opt/hostedtoolcache /etc/gha-runner \
    && cp -a /home/runner/. /opt/actions-runner/ \
    && mkdir -p /opt/actions-runner/_work \
    && chown -R runner:docker /opt/actions-runner /opt/hostedtoolcache
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
COPY entrypoint.sh register.sh /usr/local/libexec/gha-runner/
COPY job-policy.py job-started.sh /etc/gha-runner/
RUN chmod 755 /usr/local/libexec/gha-runner/*.sh /etc/gha-runner/job-started.sh
ENV RUNNER_TOOL_CACHE=/opt/hostedtoolcache \
    ACTIONS_RUNNER_HOOK_JOB_STARTED=/etc/gha-runner/job-started.sh \
    DOCKER_HOST=tcp://127.0.0.1:2375 \
    DOCKER_TLS_CERTDIR="" \
    CI=true
WORKDIR /opt/actions-runner
USER runner
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/libexec/gha-runner/entrypoint.sh"]
