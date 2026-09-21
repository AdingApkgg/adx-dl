import type { RepoInfo } from "@/shared/dto";

import { GitHubRequestError, type GitHubClient } from "./client";

export type FakeSeed = {
  repo: RepoInfo;
  /** 设为非 null 时，getRepoInfo 抛这个错，用来测连不通的分支。 */
  repoError: GitHubRequestError | null;
};

const defaultSeed: FakeSeed = {
  repo: { owner: "AdingApkgg", repo: "adx-dl", defaultBranch: "main" },
  repoError: null,
};

export function createFakeGitHubClient(seed: Partial<FakeSeed> = {}) {
  const state: FakeSeed = { ...defaultSeed, ...seed };

  const client: GitHubClient & { seed: FakeSeed } = {
    seed: state,
    async getRepoInfo() {
      if (state.repoError) throw state.repoError;
      return state.repo;
    },
  };

  return client;
}
