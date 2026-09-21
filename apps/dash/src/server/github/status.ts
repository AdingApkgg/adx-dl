import { HTTPException } from "hono/http-exception";

import { GitHubRequestError } from "./client";

/**
 * 只透传「这次请求本身就不会成功、而且不会跟我们自己已经用来表达别的
 * 含义的状态码撞车」这几个：
 *   - 404：run/workflow 不存在。
 *   - 409：目标状态不允许这个操作（例如取消一个已经跑完的 run）。
 *   - 422：请求本身不合法（例如 workflow 没有 workflow_dispatch 触发器、
 *          ref 不存在）。
 * 这三个原样重试也不会变，前端/告警该按「这次操作本身有问题」处理，
 * 而不是「再点一次 / 再轮询一次」。其余一律按 502 处理。
 *
 * 故意不透传 401/403：accessJwt 中间件自己在鉴权失败时也回 403
 * （`{"error":"Access 断言无效"}`）。如果把 GitHub 的 401/403（安装
 * token 过期、权限被收回、二级限流……）原样传下去，客户端收到的 403
 * 会和「Access 会话过期」长得一模一样——运维会去重新登录 Cloudflare
 * Access，而真正的问题出在 GitHub App 这一侧，重新登录什么也解决不了。
 * 所以这两个状态码故意落进下面的默认分支，统一按 502：502 读起来是
 * 「服务器这边出问题了」，不会被误当成「你需要重新登录」。这是这里
 * 唯一反直觉、容易被后人当「化简」删掉的一行判断，别删。
 *
 * 429（GitHub 限流）也走默认的 502：它不会跟我们自己的哪个状态码撞车、
 * 不会被误解成别的意思，但它跟 409/422 不是一类——限流是暂时的，原样
 * 重试大概率会成功，语义上更接近「上游暂时顶不住了，稍后再试」，这正是
 * 502 已经在表达的意思。以后如果要做更精细的退避（比如读 Retry-After
 * 头），可以再单独拆出来，不算是现在这里漏掉的语义。
 *
 * 挪到独立模块的原因：后续阶段的 routes/{content,prs,catalog}.ts 要打同
 * 一个 GitHub API，需要同一套「GitHub 状态码 → HTTP 状态码」映射——之前
 * 它连同这条注释一起被锁在 routes/actions.ts 里且没有导出，多一个调用方
 * 就要多复制一份，401/403 这条最容易在复制过程中被当成「多余判断」删掉。
 */
export function statusFor(error: unknown): 404 | 409 | 422 | 502 {
  if (error instanceof GitHubRequestError) {
    if (error.status === 404 || error.status === 409 || error.status === 422) {
      return error.status;
    }
  }
  return 502;
}

/**
 * 把一个打 GitHub 失败的错误，收敛成一个自带正确状态码与 JSON body 的
 * `HTTPException`——`message` 用 `error.message`，不用 `String(error)`：
 * 后者是 `Error.prototype.toString()`，会在消息前面缀上类名（例如
 * `"GitHubRequestError: Workflow does not have 'workflow_dispatch' trigger"`），
 * 那截前缀对界面上看着的人没有意义，只会让人怀疑是不是哪里堆栈溢出了。
 * `error.message` 本身已经是 GitHub/octokit 给的、可读的原话——这正是
 * 之前那次真实冒烟测试能一眼看出问题出在哪的原因，不能丢。
 *
 * 单独把 `res` 建成一个完整的 `Response`（而不是只传 `message` 给
 * `HTTPException`）：这样即使调用方所在的 Hono 实例没挂自定义
 * `app.onError`（单元测试里常见），Hono 内置的默认错误处理器
 * （`hono-base.ts` 里的 `errorHandler`）走到 `err.getResponse()` 时，
 * 拿到的也已经是正确状态码 + JSON body，不用依赖 app.onError 才能拼对。
 */
function toHttpException(error: unknown): HTTPException {
  const status = statusFor(error);
  const message = error instanceof Error ? error.message : String(error);
  return new HTTPException(status, {
    message,
    res: new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json; charset=UTF-8" },
    }),
  });
}

/**
 * 包一层调用 GitHub client 的函数：成功原样返回，失败把错误收敛成
 * `toHttpException` 算出来的 `HTTPException` 再抛出去。
 *
 * 路由这一侧因此不再需要自己写 `try { ... } catch (error) { return
 * c.json({error: String(error)}, statusFor(error)); }`——七个几乎逐字
 * 相同的 catch 块（以及以后 content/prs/catalog 路由要加的更多份）收敛成
 * 这一个函数。抛出去的 `HTTPException` 最终被 `createApp` 里唯一那个
 * `app.onError` 接住：状态码和响应体在这里已经定好，`onError` 只负责把
 * method/path/status/message 记一行服务端日志，不用重新算一遍映射。
 */
export async function withGitHubErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toHttpException(error);
  }
}
