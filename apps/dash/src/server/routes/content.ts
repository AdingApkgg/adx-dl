import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { CONTENT_FILES, findContentFile, validateContentFile } from "@astrodx/content-schema";

import type { ContentCommitRequest, ContentFileMeta, ContentFileResponse } from "@/shared/dto";

import { GitDataStepError, type ContentClient, type RepoClient } from "../github/client";
import { statusFor, withGitHubErrors } from "../github/status";
import type { AccessVariables } from "../middleware/access-jwt";

export type ContentDeps = {
  // 窄到实际调用的方法集合，不是「用得到的领域」——跟 routes/me.ts 的
  // `Pick<RepoClient, "getRepoInfo">` 同一条规则。这个路由用掉了整个
  // ContentClient（两个方法都用），但 RepoClient 里只用 getRepoInfo 取默认
  // 分支，不查分支列表。
  github: ContentClient & Pick<RepoClient, "getRepoInfo">;
};

/** 落盘格式：2 空格缩进 + 末尾换行。与仓库里其他 JSON 一致，也让 diff 稳定。 */
function serialize(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * 抛一个已经拼好 body 的 400。
 *
 * 抛而不是 return：这几处校验散在 withGitHubErrors 的包裹里外两侧，`return`
 * 在里侧只会变成那个闭包的返回值，到不了客户端。抛出去之后 withGitHubErrors
 * 对 HTTPException 原样放行（见 github/status.ts 里那段注释——没有那条早退，
 * 这里的 errors 会被压成一个裸 502）。
 */
function badRequest(message: string, extra: Record<string, unknown> = {}): never {
  throw new HTTPException(400, {
    res: Response.json({ error: message, ...extra }, { status: 400 }),
  });
}

export function registerContentRoutes(app: Hono<{ Variables: AccessVariables }>, deps: ContentDeps) {
  app.get("/api/content", (c) => {
    const files: ContentFileMeta[] = CONTENT_FILES.map((file) => ({
      key: file.key,
      path: file.path,
      title: file.title,
      module: file.module,
    }));
    return c.json(files);
  });

  app.get("/api/content/:key", async (c) => {
    const spec = findContentFile(c.req.param("key"));
    // 不把 key 回显进消息里——它来自 URL，回显等于给了一个反射点，
    // 而操作员看到「没有这个内容文件」已经够定位问题了。
    if (!spec) return c.json({ error: "没有这个内容文件" }, 404);

    return withGitHubErrors(async () => {
      const blob = await deps.github.getContentFile(spec.path);
      let data: unknown;
      try {
        data = JSON.parse(blob.text);
      } catch {
        // 仓库里的 JSON 坏了不是客户端的错，也不是我们的内部错误——
        // 它是「上游数据不可用」，按 502 处理，与 GitHub 挂了同一档。
        throw new HTTPException(502, {
          res: Response.json({ error: `${spec.path} 不是合法的 JSON` }, { status: 502 }),
        });
      }
      const body: ContentFileResponse = {
        key: spec.key,
        path: spec.path,
        title: spec.title,
        data,
        sha: blob.sha,
      };
      return c.json(body);
    });
  });

  app.post("/api/content/commit", async (c) => {
    const payload = (await c.req.json().catch(() => null)) as ContentCommitRequest | null;
    if (!payload || typeof payload !== "object") badRequest("请求体不是 JSON");

    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (message === "") badRequest("提交信息不能为空");
    if (!Array.isArray(payload.files) || payload.files.length === 0) badRequest("没有要提交的文件");
    // 逐条先确认它是个对象再读字段：files 里混进一个 null，下一行的
    // `file.key` 会直接抛 TypeError，操作员看到的是一个 500，而这明明是
    // 「请求体不对」。
    if (payload.files.some((file) => typeof file !== "object" || file === null)) {
      badRequest("文件列表里有不是对象的条目");
    }

    const keys = payload.files.map((file) => file.key);
    if (new Set(keys).size !== keys.length) badRequest("同一个文件出现了多次");

    // 服务端校验。客户端那次校验是体验，这次才是把关——改请求体直打这个端点
    // 就能绕过前者。所有文件一起校验完再决定，好让操作员一次看到全部问题。
    const errors: string[] = [];
    const resolved: { path: string; content: string; baseSha: string }[] = [];
    for (const file of payload.files) {
      const spec = findContentFile(file.key);
      if (!spec) {
        // 同样不回显 key——理由和上面 GET 那条一样（回显任意客户端输入等于
        // 给了一个反射点），而这里的 key 同样完全由请求体决定。同一个文件对
        // 同一类输入不该用两种相反的策略。
        errors.push("未知的内容键");
        continue;
      }
      const result = validateContentFile(file.key, file.data);
      if (!result.ok) {
        // 冠上文件标题：一次提交里有好几个文件，`contactChannels[0].url:
        // 不是合法的 URL` 单看分不出是哪一份。表单里那份按路径索引的错误
        // （errorsByPath）走的是客户端自己那次校验，不是这里的 body。
        errors.push(...result.errors.map((error) => `${spec.title}：${error}`));
        continue;
      }
      if (typeof file.baseSha !== "string" || file.baseSha === "") {
        errors.push(`${spec.title}：缺少 baseSha`);
        continue;
      }
      resolved.push({ path: spec.path, content: serialize(file.data), baseSha: file.baseSha });
    }
    if (errors.length > 0) badRequest("校验未通过", { errors });

    return withGitHubErrors(async () => {
      // 内容没变的文件从这次 commit 里剔掉：保留它只会让 diff 里出现一个
      // 空改动，全部没变则连 commit 都不该有——main 上每个 commit 触发
      // 一次数分钟的完整部署。
      //
      // 这里读的是默认分支（getContentFile 不接分支参数），而下面
      // commitFiles 的第一层锁 verify 的是它自己刚读到的 HEAD——两者今天
      // 指向同一个分支（getRepoInfo().defaultBranch）。哪天要往别的分支提交，
      // 这个前提就不成立了，得让 getContentFile 也带上 ref。
      const changed: typeof resolved = [];
      for (const file of resolved) {
        const current = await deps.github.getContentFile(file.path);
        if (current.text !== file.content) changed.push(file);
      }
      if (changed.length === 0) badRequest("没有实际改动");

      const repo = await deps.github.getRepoInfo();
      try {
        const result = await deps.github.commitFiles({
          branch: repo.defaultBranch,
          message,
          files: changed,
        });
        return c.json({ accepted: true, ...result });
      } catch (error) {
        // step 与 conflictPaths 是这个端点独有的信息，app.ts 的 onError
        // 只会保留 message——所以在这里就把它们放进 body。
        if (error instanceof GitDataStepError) {
          // 状态码交给 statusFor，不在这里另写一套映射：`step()` 会把六步里
          // 任何上游错误连同原状态码包进 GitDataStepError，手写
          // 「409 就 409、其余一律 502」会把 404/422 这两个同样不可重试的
          // 状态一起压成 502——在一条每次成功提交都要换一轮数分钟部署的路径
          // 上，把「这次操作本身有问题」报成「上游临时抽风、重试吧」是错误的
          // 信号。理由见 status.ts 开头那段长注释。
          const status = statusFor(error);
          throw new HTTPException(status, {
            res: Response.json(
              { error: error.message, step: error.step, conflictPaths: error.conflictPaths },
              { status }
            ),
          });
        }
        throw error;
      }
    });
  });
}
