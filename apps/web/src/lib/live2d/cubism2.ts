/**
 * 自实现 Live2D Cubism 2 运行时封装 — 不依赖任何 loader 库，直接驱动
 * 自托管的 Cubism 2 core（/live2d/core/live2d.min.js）：
 *
 *  - 模型加载：index.json → .moc / 贴图 / .mtn 动作 / physics.json
 *  - 渲染循环：动作队列(空闲随机 idle、点击插播) → 注视叠加 → 物理 → draw
 *  - 交互：全页注视 setGaze()、点击 tap()（命中区检测 + 随机动作）
 *
 * 完全掌控每一帧的参数管线，不再受第三方 adapter 的 loadParam 顺序约束。
 *
 * Ported from AdingApkgg/i (apps/web/src/lib/live2d); keep the two in sync.
 */

/* biome-ignore-all lint/suspicious/noExplicitAny: Cubism 2 core has no types */

interface CoreGlobals {
  Live2D: any;
  Live2DModelWebGL: any;
  Live2DMotion: any;
  MotionQueueManager: any;
  PhysicsHair: any;
  UtSystem: any;
}
const core = () => window as unknown as CoreGlobals & Window;

let corePromise: Promise<void> | null = null;

/** Load the self-hosted Cubism 2 core script once. */
export function loadCore(src = "/live2d/core/live2d.min.js"): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (core().Live2DModelWebGL) return Promise.resolve();
  if (!corePromise) {
    corePromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => {
        s.remove();
        corePromise = null; // 允许下次挂载重试（否则整个会话永久失败）
        reject(new Error("live2d core load failed"));
      };
      document.head.appendChild(s);
    });
  }
  return corePromise;
}

interface ModelJson {
  model: string;
  textures: string[];
  physics?: string;
  motions?: Record<string, { file: string; fade_in?: number; fade_out?: number }[]>;
  hit_areas?: { name: string; id: string }[];
  /** 自定义命中矩形（bilibili-22/33、少前等模型），逻辑视图坐标(≈clip, y 朝上)。 */
  hit_areas_custom?: Record<string, [number, number]>;
  layout?: Record<string, number>;
}

interface PhysicsJson {
  physics_hair?: {
    setup: { length: number; regist: number; mass: number };
    src: { id: string; ptype: string; scale: number; weight: number }[];
    targets: { id: string; ptype: string; scale: number; weight: number }[];
  }[];
}

async function fetchBuf(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // CDN 贴图需带 CORS，否则 texImage2D 因画布污染抛错
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`texture ${url}`));
    img.src = url;
  });
}

export interface TapResult {
  hitArea: string | null;
}

export class Cubism2Mascot {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private model: any = null;
  private settings: ModelJson | null = null;
  private base = "";
  private motionMgr: any = null;
  /** file → Promise<motion>：并发未命中也只 fetch 一次。 */
  private motionCache = new Map<string, Promise<any>>();
  private physics: any[] = [];
  private textures: WebGLTexture[] = [];
  private matrix = new Float32Array(16);
  private raf = 0;
  private dead = false;
  /** 防止 isFinished 期间每帧重复触发动作加载。 */
  private motionPending = false;
  /** 注视目标与当前值（-1..1），loop 内做平滑插值。 */
  private gazeTarget = { x: 0, y: 0 };
  private gazeNow = { x: 0, y: 0 };

  private onContextLost = (e: Event) => {
    // 上下文丢失后 gl 全变 no-op，停掉循环省电；恢复需重挂组件。
    e.preventDefault();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("webgl unavailable");
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", this.onContextLost);
  }

  /** 拍照请求：tick 内 draw 之后取帧回调。 */
  private photoRequest: ((dataUrl: string) => void) | null = null;

  async load(src: string): Promise<void> {
    await loadCore();
    if (this.dead) return;
    const w = core();
    w.Live2D.init();
    w.Live2D.setGL(this.gl);
    await this.loadModelAssets(src);
    if (!this.dead && !this.raf) this.startLoop();
  }

  /** 热切换模型（换装/换人）：同一 canvas/GL，卸旧载新。 */
  async switchModel(src: string): Promise<void> {
    if (this.dead) return;
    this.model = null; // tick 以 !model 跳过渲染
    this.settings = null;
    this.motionPending = false;
    this.motionCache.clear();
    this.physics = [];
    for (const t of this.textures) this.gl.deleteTexture(t);
    this.textures = [];
    await this.loadModelAssets(src);
  }

  /** 截取当前帧（透明背景 PNG dataURL）。 */
  takePhoto(): Promise<string> {
    return new Promise((resolve) => {
      this.photoRequest = resolve;
    });
  }

  private async loadModelAssets(src: string): Promise<void> {
    const w = core();
    this.base = src.slice(0, src.lastIndexOf("/") + 1);
    const settings = (await (await fetch(src)).json()) as ModelJson;
    if (this.dead) return;
    this.settings = settings;

    // --- model ---
    const moc = await fetchBuf(this.base + settings.model);
    if (this.dead) return;
    this.model = w.Live2DModelWebGL.loadModel(moc);
    // 关键：先快照 moc 默认参数作为基线。否则循环首帧 loadParam 会载入
    // 未初始化(全零)参数，部件形变整体错乱（官方框架加载后同样先 saveParam）。
    this.model.saveParam();

    // --- textures ---
    const gl = this.gl;
    const images = await Promise.all(settings.textures.map((t) => loadImage(this.base + t)));
    if (this.dead) return;
    images.forEach((img, i) => {
      const tex = gl.createTexture();
      if (!tex) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1); // Cubism2 UV 以左下为原点，必须翻转
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.model.setTexture(i, tex);
      this.textures.push(tex);
    });

    // --- model matrix：contain-fit 到画布（L2Dwidget 式，忽略 json layout —
    // 那是旧框架 viewMatrix 语义，直接当 clip 变换会放大裁切）。带纵横比补偿，
    // 模型像素保持正方；水平居中、垂直贴顶（看板娘露头身，底边裁脚）。---
    const cw = this.model.getCanvasWidth();
    const aspect = this.canvas.width / this.canvas.height; // 物理像素比即可
    // x 方向铺满：sx=2/cw；y 保持正方形像素：sy = sx * aspect
    const sx = 2 / cw;
    const sy = sx * aspect;
    const tx = -(sx * cw) / 2; // 水平居中
    const ty = 1; // 模型顶(y_m=0)贴 clip 顶(+1)
    // 列主序：x' = sx·x + tx，y' = -sy·y + ty（模型画布 y 向下 → clip y 向上）
    this.matrix.set([sx, 0, 0, 0, 0, -sy, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1]);
    this.model.setMatrix(this.matrix);

    // --- physics ---
    if (settings.physics) {
      try {
        const pj = (await (await fetch(this.base + settings.physics)).json()) as PhysicsJson;
        if (this.dead) return;
        const PH = w.PhysicsHair;
        const srcType = (t: string) =>
          t === "x" ? PH.Src.SRC_TO_X : t === "y" ? PH.Src.SRC_TO_Y : PH.Src.SRC_TO_G_ANGLE;
        for (const h of pj.physics_hair ?? []) {
          const p = new PH();
          p.setup(h.setup.length, h.setup.regist, h.setup.mass);
          for (const sp of h.src) p.addSrcParam(srcType(sp.ptype), sp.id, sp.scale, sp.weight);
          for (const tp of h.targets)
            p.addTargetParam(PH.Target.TARGET_FROM_ANGLE, tp.id, tp.scale, tp.weight);
          this.physics.push(p);
        }
      } catch {
        /* physics 失败不致命 */
      }
    }

    this.motionMgr = new w.MotionQueueManager();
  }

  /** 播放某组里的随机动作（不存在则忽略）。 */
  async startRandomMotion(group: string): Promise<void> {
    const entries = this.settings?.motions?.[group];
    if (!entries?.length || this.dead || this.motionPending) return;
    this.motionPending = true;
    const e = entries[Math.floor(Math.random() * entries.length)]!;
    try {
      let motionP = this.motionCache.get(e.file);
      if (!motionP) {
        motionP = fetchBuf(this.base + e.file).then((buf) => {
          const m = core().Live2DMotion.loadMotion(buf);
          m.setFadeIn(e.fade_in ?? 500);
          m.setFadeOut(e.fade_out ?? 500);
          return m;
        });
        this.motionCache.set(e.file, motionP);
        motionP.catch(() => this.motionCache.delete(e.file)); // 失败可重试
      }
      const motion = await motionP;
      if (!this.dead) this.motionMgr.startMotion(motion, false);
    } catch {
      /* 单个动作失败不致命 */
    } finally {
      this.motionPending = false;
    }
  }

  /** 全页注视目标（-1..1，y 朝上）。 */
  setGaze(x: number, y: number): void {
    this.gazeTarget.x = Math.max(-1, Math.min(1, x));
    this.gazeTarget.y = Math.max(-1, Math.min(1, y));
  }

  /** 点击：命中区检测 + 插播随机点击动作。坐标为相对 canvas 的 CSS 像素。 */
  tap(px: number, py: number, cssW: number, cssH: number): TapResult {
    const hit = this.hitTest(px, py, cssW, cssH);
    void this.startRandomMotion("");
    return { hitArea: hit };
  }

  private hitTest(px: number, py: number, cssW: number, cssH: number): string | null {
    const m = this.model;
    // hit_areas_custom：clip 坐标(y 朝上)矩形，键形如 head_x/head_y/body_x/body_y
    const custom = this.settings?.hit_areas_custom;
    if (custom) {
      const cx = (px / cssW) * 2 - 1;
      const cy = 1 - (py / cssH) * 2;
      for (const name of ["head", "body"]) {
        const rx = custom[`${name}_x`];
        const ry = custom[`${name}_y`];
        if (!rx || !ry) continue;
        if (
          cx >= Math.min(rx[0], rx[1]) &&
          cx <= Math.max(rx[0], rx[1]) &&
          cy >= Math.min(ry[0], ry[1]) &&
          cy <= Math.max(ry[0], ry[1])
        )
          return name;
      }
      return null;
    }
    const areas = this.settings?.hit_areas;
    if (!m || !areas?.length) return null;
    // CSS px → clip → 模型画布坐标（矩阵逆变换，x/y 缩放各自独立）
    const clipX = (px / cssW) * 2 - 1;
    const clipY = 1 - (py / cssH) * 2;
    const sx = this.matrix[0]!;
    const sy = -this.matrix[5]!;
    const tx = this.matrix[12]!;
    const ty = this.matrix[13]!;
    const mx = (clipX - tx) / sx;
    const my = (clipY - ty) / -sy;
    for (const a of areas) {
      const idx = m.getDrawDataIndex(a.id);
      if (idx < 0) continue;
      const pts: number[] = m.getTransformedPoints(idx);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i]!;
        const y = pts[i + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (mx >= minX && mx <= maxX && my >= minY && my <= maxY) return a.name;
    }
    return null;
  }

  private startLoop(): void {
    const gl = this.gl;
    const w = core();
    const tick = () => {
      if (this.dead) return;
      this.raf = requestAnimationFrame(tick);
      const m = this.model;
      if (!m) return;

      const timeMSec = w.UtSystem.getUserTimeMSec();

      // 1) 动作管线（自有快照语义）
      m.loadParam();
      if (this.motionMgr.isFinished()) {
        void this.startRandomMotion("idle");
      } else {
        this.motionMgr.updateParam(m);
      }
      m.saveParam();

      // 2) 注视叠加（加法混合，动作与跟随共存）
      const g = this.gazeNow;
      g.x += (this.gazeTarget.x - g.x) * 0.12;
      g.y += (this.gazeTarget.y - g.y) * 0.12;
      m.addToParamFloat("PARAM_ANGLE_X", g.x * 30, 1);
      m.addToParamFloat("PARAM_ANGLE_Y", g.y * 30, 1);
      m.addToParamFloat("PARAM_BODY_ANGLE_X", g.x * 10, 1);
      m.addToParamFloat("PARAM_EYE_BALL_X", g.x, 1);
      m.addToParamFloat("PARAM_EYE_BALL_Y", g.y, 1);

      // 3) 物理（头发等摆动）
      for (const p of this.physics) p.update(m, timeMSec);

      // 4) 绘制（透明背景）
      m.update();
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      m.draw();
      if (this.photoRequest) {
        const cb = this.photoRequest;
        this.photoRequest = null;
        try {
          cb(this.canvas.toDataURL("image/png")); // draw 同帧内取，无需 preserveDrawingBuffer
        } catch {
          cb("");
        }
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  destroy(): void {
    this.dead = true;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    if (this.raf) cancelAnimationFrame(this.raf);
    for (const t of this.textures) this.gl.deleteTexture(t);
    this.textures = [];
    this.motionCache.clear();
    this.model = null;
  }
}
