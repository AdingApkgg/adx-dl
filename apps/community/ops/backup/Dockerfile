# Build context is the repository root; credentials/configuration are mounted at runtime only.
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS translations
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

FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS dependencies
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/community/package.json apps/community/
COPY packages/ui/package.json packages/ui/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY patches/ patches/
RUN bun install --frozen-lockfile --production --filter community

FROM restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510 AS restic
FROM postgres:18@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336
COPY --from=dependencies /usr/local/bin/bun /usr/local/bin/bun
COPY --from=dependencies /repo /repo
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
COPY packages/tsconfig/base.json /repo/packages/tsconfig/
COPY apps/community/tsconfig.json /repo/apps/community/
COPY apps/community/src /repo/apps/community/src
COPY --from=translations /repo/apps/community/src/paraglide /repo/apps/community/src/paraglide
COPY apps/community/ops/backup/*.ts apps/community/ops/backup/backup.sh /repo/apps/community/ops/backup/
WORKDIR /repo/apps/community
# The actual production recipe must load in the backup/restore image, not only in a host harness.
RUN bun -e 'import sharp from "sharp"; if(sharp.versions.sharp!=="0.35.5"||sharp.versions.vips!=="8.18.7")throw new Error("Native recipe mismatch")'
ENTRYPOINT []
CMD ["bash", "./ops/backup/backup.sh"]
