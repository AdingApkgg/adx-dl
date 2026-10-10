# Build context is the repository root; credentials/configuration are mounted at runtime only.
FROM oven/bun:1.4.2 AS translations
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/community/package.json apps/community/
COPY packages/ui/package.json packages/ui/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY patches/ patches/
RUN bun install --frozen-lockfile --filter community
COPY apps/community/project.inlang/settings.json /repo/apps/community/project.inlang/
COPY apps/community/messages /repo/apps/community/messages
WORKDIR /repo/apps/community
RUN bun run i18n

FROM oven/bun:1.4.2 AS dependencies
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/community/package.json apps/community/
COPY packages/ui/package.json packages/ui/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY patches/ patches/
RUN bun install --frozen-lockfile --production --filter community

FROM restic/restic:0.19.1 AS restic
FROM postgres:18
COPY --from=dependencies /usr/local/bin/bun /usr/local/bin/bun
COPY --from=dependencies /repo /repo
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
COPY packages/tsconfig/base.json /repo/packages/tsconfig/
COPY apps/community/tsconfig.json /repo/apps/community/
COPY apps/community/src /repo/apps/community/src
COPY --from=translations /repo/apps/community/src/paraglide /repo/apps/community/src/paraglide
COPY apps/community/ops/backup/export.ts apps/community/ops/backup/restore.ts apps/community/ops/backup/journal.ts apps/community/ops/backup/backup.sh /repo/apps/community/ops/backup/
WORKDIR /repo/apps/community
# The actual production recipe must load in the backup/restore image, not only in a host harness.
RUN bun -e 'import sharp from "sharp"; if(sharp.versions.sharp!=="0.35.5"||sharp.versions.vips!=="8.18.7")throw new Error("Native recipe mismatch")'
ENTRYPOINT []
CMD ["bash", "./ops/backup/backup.sh"]
