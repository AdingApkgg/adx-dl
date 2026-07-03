// Safari/iOS Web Audio 手势解锁。
//
// WebKit 上 `AudioContext` 创建后处于 suspended，必须在**用户手势的同步执行栈内**调用
// resume() 才会解锁；若 resume() 发生在 rAF / Promise / effect 里（晚于手势那一拍），
// Safari 会拒绝或干脆不生效 → context 一直挂起 → 音乐和正解音全哑（桌面 Chrome 无此限制）。
//
// 我们的音乐（use-music-player）与正解音（use-audio）各自持有一个 AudioContext，原本的
// resume 都在非手势时机。这里维护一个注册表，并在**捕获阶段**监听页面级手势，在手势回调里
// resume 所有已注册且 suspended 的 context——因此用户点「播放」（乃至任何点击/触摸/按键）时，
// 处于同一手势栈内的 resume 会被 Safari 接受。resume 幂等，context 已 running 时直接 resolve。

const registered = new Set<AudioContext>();
let armed = false;

function resumeAll(): void {
  for (const ctx of registered) {
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  }
}

function arm(): void {
  if (armed || typeof document === "undefined") return;
  armed = true;
  // 捕获阶段 + 常驻（不 once）：每次手势都尝试，覆盖「context 晚于首个手势才创建」的情况。
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  for (const evt of ["pointerdown", "touchend", "mousedown", "keydown"]) {
    document.addEventListener(evt, resumeAll, opts);
  }
}

/**
 * 注册一个 AudioContext 参与手势解锁，返回注销函数（在 hook 卸载时调用）。
 * 注册时立即尝试一次 resume（可能已处于某个手势调用栈内）。
 */
export function registerAudioContextForUnlock(ctx: AudioContext): () => void {
  registered.add(ctx);
  arm();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return () => {
    registered.delete(ctx);
  };
}
