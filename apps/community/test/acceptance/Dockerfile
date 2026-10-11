# Reuse the exact app and backup images already built by Community check.
# This layer only adds test sources and the already-built web entrypoint.
ARG ACCEPTANCE_APP_IMAGE=community:ci
ARG ACCEPTANCE_BACKUP_IMAGE=community-backup:ci
FROM ${ACCEPTANCE_APP_IMAGE} AS app
FROM ${ACCEPTANCE_BACKUP_IMAGE}
COPY --from=app /repo/apps/community/build /repo/apps/community/build
COPY --from=app /repo/apps/community/ops/seaweed /repo/apps/community/ops/seaweed
COPY apps/community/test /repo/apps/community/test
WORKDIR /repo/apps/community
ENTRYPOINT []
CMD ["bun", "--version"]
