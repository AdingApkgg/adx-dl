// 前后端共用的数据形状。客户端 import 这里的类型，服务端返回这里的类型，
// 改一处两边一起红。不要在这里放任何运行时逻辑——它会被打进浏览器包。

export type RepoInfo = {
  owner: string;
  repo: string;
  defaultBranch: string;
};

export type MeResponse = {
  email: string;
  /** GitHub App 连得通时是仓库信息，连不通是 null。 */
  repo: RepoInfo | null;
  /** 连不通时的原因，供界面直接显示。连得通是 null。 */
  repoError: string | null;
};
