"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CameraIcon,
  InfoIcon,
  QuoteIcon,
  RocketIcon,
  ShirtIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import * as React from "react";
import type { Locale } from "@/lib/i18n";
import { Cubism2Mascot } from "@/lib/live2d/cubism2";
import { setMascotHidden } from "@/lib/live2d/mascot-preference";
import {
  fetchHitokoto,
  fetchModelList,
  fetchTips,
  groupCostumes,
  idlePool,
  type ModelList,
  modelSrc,
  pick,
  restoreSelection,
  stripTags,
  WAIFU_LS,
  type WaifuTips,
  welcomeMessage,
} from "@/lib/live2d/waifu";
import { getLive2DCopy } from "./live2d-copy";

export interface Live2DMascotProps {
  locale: Locale;
  width?: number;
  height?: number;
  className?: string;
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private or locked-down storage only loses the remembered outfit.
  }
}

/**
 * waifu 看板娘完整版（参考 AdingApkgg/live2d-api）：
 * 42 套明日奈换装 + 11 组换人（npmmirror CDN）、工具栏（一言/打飞机/换人/换装/
 * 拍照/信息/退出）、时段+节日问候、悬停吐槽、复制/控制台/切页彩蛋、退出记忆。
 * 渲染层为自实现 Cubism 2 引擎。Ported from AdingApkgg/i.
 */
export default function Live2DMascot({ locale, width = 230, height = 320, className }: Live2DMascotProps) {
  const copy = getLive2DCopy(locale);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const engineRef = React.useRef<Cubism2Mascot | null>(null);
  const [list, setList] = React.useState<ModelList | null>(null);
  // Hidden and click-through until the first model has drawn: if the model CDN
  // is unreachable, an empty canvas must not swallow clicks in the corner.
  const [ready, setReady] = React.useState(false);
  const tipsRef = React.useRef<WaifuTips | null>(null);
  const [group, setGroup] = React.useState(0);
  const [costume, setCostume] = React.useState(0);
  // The engine effect only reads the selection when it (re)creates the engine;
  // later switches go through switchModel, so it must not depend on the state.
  const selectionRef = React.useRef({ group: 0, costume: 0 });
  const switching = React.useRef(false);

  // ---- 气泡（带优先级）----
  const [tip, setTip] = React.useState<string | null>(null);
  const tipPrio = React.useRef(0);
  const tipTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const followupTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTip = React.useCallback((text: string | null | undefined, ms = 6000, prio = 1) => {
    if (!text) return;
    if (tipTimer.current && prio < tipPrio.current) return; // 低优先级不打断
    tipPrio.current = prio;
    setTip(text);
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => {
      // Cleared so the idle chatter below can tell that no bubble is showing.
      tipTimer.current = null;
      setTip(null);
      tipPrio.current = 0;
    }, ms);
  }, []);

  React.useEffect(
    () => () => {
      if (tipTimer.current) clearTimeout(tipTimer.current);
      if (followupTimer.current) clearTimeout(followupTimer.current);
    },
    []
  );

  // ---- 初始化：拉 model_list + tips，恢复上次的换人/换装 ----
  React.useEffect(() => {
    void fetchModelList()
      .then((l) => {
        const selection = restoreSelection(l, {
          group: readStored(WAIFU_LS.group),
          costume: readStored(WAIFU_LS.costume),
        });
        selectionRef.current = selection;
        setGroup(selection.group);
        setCostume(selection.costume);
        setList(l);
      })
      .catch(() => {});
    void fetchTips()
      .then((t) => {
        tipsRef.current = t;
        // 参考实现语义：首页时段问候；其它页欢迎来到标题；外站 referrer 来源问候
        showTip(
          welcomeMessage(t, {
            pathname: window.location.pathname,
            title: document.title,
            referrer: document.referrer,
            hostname: window.location.hostname,
          }),
          7000,
          2
        );
      })
      .catch(() => {});
  }, [showTip]);

  // ---- 引擎生命周期 ----
  React.useEffect(() => {
    if (!list) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    let engine: Cubism2Mascot | null = null;
    try {
      engine = new Cubism2Mascot(canvas);
    } catch {
      return;
    }
    engineRef.current = engine;
    const { group: g, costume: c } = selectionRef.current;
    const path = groupCostumes(list, g)[c] ?? groupCostumes(list, 0)[0];
    if (path)
      void engine
        .load(modelSrc(path))
        .then(() => setReady(true))
        .catch((e) => {
          console.warn("[waifu] model load failed:", e);
        });

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      engineRef.current?.setGaze(
        (e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.5),
        -(e.clientY - (r.top + r.height * 0.3)) / (window.innerHeight * 0.5)
      );
    };
    // 点击看板娘：动作插播；文案由全局 click 监听统一处理
    const onTap = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      engineRef.current?.tap(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    canvas.addEventListener("click", onTap);
    return () => {
      window.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onTap);
      engine?.destroy();
      engineRef.current = null;
    };
  }, [list, width, height]);

  // ---- 换装/换人 ----
  const applyModel = React.useCallback(
    async (g: number, c: number, msg?: string) => {
      if (!list || switching.current) return;
      const path = groupCostumes(list, g)[c];
      if (!path) return;
      switching.current = true;
      try {
        await engineRef.current?.switchModel(modelSrc(path));
        selectionRef.current = { group: g, costume: c };
        setGroup(g);
        setCostume(c);
        writeStored(WAIFU_LS.group, String(g));
        writeStored(WAIFU_LS.costume, String(c));
        if (msg) showTip(msg, 5000, 2);
      } finally {
        switching.current = false;
      }
    },
    [list, showTip]
  );

  const switchCostume = React.useCallback(() => {
    if (!list) return;
    const n = groupCostumes(list, group).length;
    if (n <= 1) {
      showTip("我还没有其他衣服呢～", 4000, 2);
      return;
    }
    void applyModel(group, (costume + 1) % n, "我的新衣服好看嘛？");
  }, [list, group, costume, applyModel, showTip]);

  const switchGroup = React.useCallback(() => {
    if (!list) return;
    const g = (group + 1) % list.models.length;
    void applyModel(g, 0, list.messages[g] ?? "新朋友来啦～");
  }, [list, group, applyModel]);

  // ---- 拍照 ----
  const takePhoto = React.useCallback(async () => {
    const url = await engineRef.current?.takePhoto();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = "waifu.png";
    a.click();
    showTip("照好了嘛，是不是很可爱呢？", 5000, 2);
  }, [showTip]);

  // ---- 打飞机彩蛋 ----
  const startAsteroids = React.useCallback(() => {
    const s = document.createElement("script");
    s.src = "/live2d/asteroids.js";
    document.body.appendChild(s);
    showTip("准备好了吗？方向键移动，空格发射！", 5000, 2);
  }, [showTip]);

  // ---- 一言（正文 + 出处补充两连）----
  const showHitokoto = React.useCallback(async () => {
    const h = await fetchHitokoto();
    if (!h) return;
    showTip(h.text, 6000, 1);
    if (h.followup) {
      const followup = h.followup;
      if (followupTimer.current) clearTimeout(followupTimer.current);
      followupTimer.current = setTimeout(() => showTip(followup, 4000, 1), 6000);
    }
  }, [showTip]);

  // ---- 空闲吐槽：default 消息池(含节日) 与一言轮换 ----
  React.useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden || tipTimer.current) return;
      const tips = tipsRef.current;
      if (tips && Math.random() < 0.7) {
        showTip(stripTags(pick(idlePool(tips))), 6000, 1);
      } else {
        void showHitokoto();
      }
    }, 40_000);
    return () => clearInterval(timer);
  }, [showHitokoto, showTip]);

  // ---- 悬停吐槽 + 复制/切页/控制台彩蛋 ----
  React.useEffect(() => {
    let lastSel = "";
    const onOver = (e: MouseEvent) => {
      const tips = tipsRef.current;
      const target = e.target as Element | null;
      if (!tips || !target?.closest) return;
      for (const m of tips.mouseover) {
        const el = target.closest(m.selector);
        if (!el) continue;
        if (m.selector === lastSel) return; // 同一目标不刷屏
        lastSel = m.selector;
        const text = pick(m.text).replace("{text}", (el.textContent ?? "").trim().slice(0, 14));
        showTip(stripTags(text), 4000, 1);
        return;
      }
      lastSel = "";
    };
    // 全局 click 吐槽（含点击看板娘/评论框；动作插播由 canvas onTap 负责）
    const onClick = (e: MouseEvent) => {
      const tips = tipsRef.current;
      const target = e.target as Element | null;
      if (!tips || !target?.closest) return;
      for (const c of tips.click) {
        if (!target.closest(c.selector)) continue;
        showTip(stripTags(pick(c.text)), 4000, 2);
        return;
      }
    };
    const onCopy = () => showTip(tipsRef.current?.message.copy, 5000, 3);
    const onVis = () => {
      if (!document.hidden) showTip(tipsRef.current?.message.visibilitychange, 5000, 3);
    };
    document.addEventListener("mouseover", onOver, { passive: true });
    document.addEventListener("click", onClick);
    document.addEventListener("copy", onCopy);
    document.addEventListener("visibilitychange", onVis);
    // 控制台检测：console.log("%c", trap) + toString 陷阱 —— DevTools 渲染日志时才触发
    let warned = false;
    const trap = {
      toString: () => {
        if (!warned) {
          warned = true;
          showTip(tipsRef.current?.message.console, 6000, 3);
        }
        return "";
      },
    };
    console.log("%c", trap);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("click", onClick);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [showTip]);

  const tools: { id: string; icon: React.ReactNode; label: string; onClick: () => void }[] = [
    { id: "hitokoto", icon: <QuoteIcon />, label: copy.tools.hitokoto, onClick: () => void showHitokoto() },
    { id: "asteroids", icon: <RocketIcon />, label: copy.tools.asteroids, onClick: startAsteroids },
    { id: "switch-model", icon: <UsersIcon />, label: copy.tools.switchModel, onClick: switchGroup },
    { id: "switch-texture", icon: <ShirtIcon />, label: copy.tools.switchTexture, onClick: switchCostume },
    { id: "photo", icon: <CameraIcon />, label: copy.tools.photo, onClick: () => void takePhoto() },
    {
      id: "info",
      icon: <InfoIcon />,
      label: copy.tools.info,
      onClick: () => window.open("https://github.com/AdingApkgg/live2d-api", "_blank", "noopener"),
    },
    { id: "quit", icon: <XIcon />, label: copy.tools.quit, onClick: () => setMascotHidden(true) },
  ];

  return (
    <motion.div
      className={`group/waifu ${ready ? "pointer-events-auto" : "pointer-events-none invisible"} ${className ?? ""}`}
      initial={{ opacity: 0, y: 40 }}
      animate={ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
      transition={{ type: "spring", stiffness: 120, damping: 18, delay: 0.15 }}
      style={{ width, height, position: "relative", userSelect: "none", lineHeight: 0 }}
    >
      <AnimatePresence>
        {tip && (
          <motion.div
            key={tip}
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 500, damping: 28 }}
            className="absolute -top-4 left-1/2 z-10 w-max max-w-[220px] -translate-x-1/2 rounded-xl border border-border/70 bg-popover/95 px-3 py-1.5 text-center text-xs text-popover-foreground shadow-md ring-1 ring-foreground/5 backdrop-blur"
            style={{ lineHeight: 1.6 }}
          >
            {tip}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 工具栏：悬停看板娘（或键盘聚焦到按钮）时出现 */}
      <div
        role="toolbar"
        aria-label={copy.toolbar}
        aria-orientation="vertical"
        className="absolute -left-7 top-10 z-10 flex flex-col gap-1 opacity-0 transition-opacity duration-300 focus-within:opacity-100 group-hover/waifu:opacity-100"
      >
        {tools.map((t) => (
          <button
            key={t.id}
            id={`waifu-tool-${t.id}`}
            type="button"
            aria-label={t.label}
            title={t.label}
            onClick={t.onClick}
            className="grid size-6 place-items-center rounded-full border border-border/70 bg-popover/90 text-muted-foreground shadow-sm backdrop-blur transition hover:scale-110 hover:text-primary [&>svg]:size-3.5"
          >
            {t.icon}
          </button>
        ))}
      </div>

      {/* Decorative: a click (wired in the engine effect) only plays a motion. */}
      <canvas
        id="waifu-canvas"
        ref={canvasRef}
        style={{ width: "100%", height: "100%", background: "transparent", cursor: "pointer" }}
      />
    </motion.div>
  );
}
