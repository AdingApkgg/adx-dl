# AstroDX 主站动效迁移实施计划

依据：[已批准规范](2026-11-14-motion-system-design.md)。用户已授权继续搜索、目录、下载托盘、播放器和页面转场，并完成远程预览验收。沿用当前工作区、首批基础能力和已运行的远程预览，不提交或发布。

## 约束与接口

- 保留搜索/IME/键盘导航、目录筛选分页与选择、真实下载状态、音频和时间轴、用户偏好以及常驻外壳身份。
- 高频交互用 standard；少量布局衔接用 expressive；CSS/JS 参数来自相同语义目录。
- 网格结果立即显示，不逐卡入场/退场、测量或 stagger；CSS 与 Motion 不共抢同一 transform。
- 手动进度采用有界 tween，减少动态效果与中途切换直接落实真实值；unknown 进度不伪造百分比。
- 持续装饰同时满足前台、可见和偏好条件；恢复不补播已结束反馈。确认倒计时的业务超时不随动效参数改变。
- 页面进出 320/180ms、共享元素 450ms 首先保持既有手感，仅集中令牌、命名和降级。
- 远程运行安装、整库检查、浏览器和预览；任务保留日志与退出码。当前下载托盘已有其他改动必须保留。

## 重点回归

1. 输入与建议即时更新、中文组合输入、Esc/方向键/Enter、多个搜索实例高亮不串组。
2. 目录大批结果无需等退出，URL/筛选/分页/选择状态不因动画丢失，SSR 内容可读。
3. 下载进度不越界或抢跑完成；暂停/重试/折叠不改任务，切换减少动画会取消飞入与 pulse。
4. 播放器折叠展开/曲目切换不中断音频，唱片/均衡器/长标题离屏和后台暂停。
5. 同文档导航、强制整页导航、前进后退及 reduced 模式，外壳不双影，浏览器无支持仍正常导航。

## Task 1：语义适配与动态值

文件：packages/ui/src/motion/{presets,tokens,adapters/motion,index,progress}.ts(x)，对应单元测试；scripts/generate-motion-css.ts 与生成 CSS。

接口：getSemanticTransition(pattern, reduced)、getEffectsTransition(tempo,reduced)、getProgressTransition(reduced)、useMotionProgress(value)，getMotionPreset 新增 disclosure；循环对象参数与页面距离集中定义。

- [x] 参数/策略/动态进度测试先失败，再实现最小适配并通过。

## Task 2：搜索和目录

文件：home-hero-search.tsx、catalog-browser.tsx、相邻 CSS 与测试。

- [x] 搜索建议用 popup，选中用 selection，取消首次类型/逐行错峰；磁吸归零立即停用，布局 ID 按实例隔离。
- [x] 高级筛选用 disclosure，不对行 stagger；网格卡片立即挂载/移除，小范围条件条可布局衔接。
- [x] SSR 与行为回归通过。

## Task 3：托盘和播放器

文件：download-dock.tsx、music-player.tsx、scrolling-label.tsx，以及需要的业务反馈小组件。

- [x] 动态进度换有界 tween；按钮、托盘形变、状态切换引用语义预设；飞入可取消，成功动画仅反映真实状态。
- [x] 播放器外壳与 popup 统一；持续装饰接资源门控，保持音频和业务定时器。
- [x] 相关回归通过。

## Task 4：页面转场与远程验收

文件：globals.css、page-transition.tsx、生成器；新增远程检查脚本与证据目录。

- [x] 核对安装版本 Next 文档，接入页面/共享元素变量、统一 keyframes 命名；常驻外壳保持固定。
- [x] 远程完整验证；真实浏览器常规/reduced、桌面/窄屏、搜索目录、托盘状态与播放器交互，以及同文档导航。
- [x] 原生跨文档进入页动画：更换配套浏览器、修正根伪元素选择器，并提前启用和等待主内容解析后，真实链接、前进后退、三种偏好、兼容、中途取消及窄屏均补验；不混称生产静态导出通过。
- [x] 独立代码审阅，按证据修复，保留中文验收结论和明确未覆盖边界。

## 记录

- 2026-11-14：远程 hostname=localhost，tmux 可用，原预览容器仍在运行。读取 Next 16.3 安装文档，ViewTransition 无需旧 experimental 标志。
- 决定：按已批准方案直接推进；先补 semantic adapter 和有界动态值，以免各业务组件继续自行定义参数。

- Task 1/2/3 代码和审阅修复已完成；完整远程验证 58 UI + 742 Web 测试通过，动态 Surface 和静态成功反馈回归已先失败后通过。
- 决定：共享 3310 的源码在同步后被另一预览版本覆盖，已排除单纯缓存假设；为当前任务新增可选 ASTRODX_DEV_SLOT 隔离目录/容器，使用 motion-site-20261114、端口 3311，默认预览行为不变。验收前后校验源码指纹。
- 确认业务验收只用隔离浏览器中的暂停下载检查点、小型归档文件和静音音频夹具，所有外网请求替代或阻断，不新增生产请求/消息。

- 浏览器证实清空目录会同时触发 root 与 React 边界页面动画；改为 pathname 键控 enter/exit，update=none，CSS @view-transition types: adx-document 单独启用 root。反例检查现已通过；页面原有 320/180ms 保留。
- 最后完整验证：20261114-051409-wt-88b54539-97767，lint 738 文件，UI 58、Web 742 测试及类型检查通过。最终使用 CSS 原生类型限定 root，移除临时生命周期脚本。

- Next 开发预览原生导航出现 Transition was skipped，进入页无 pagereveal/动画帧；明确保留限制，尝试编译 CSS 静态文档对照也受渲染停滞影响，未据此宣称样式验收通过。

- 最终站点验收 motion-site-20261114-final：7 组通过、页面错误 0，390px 播放器 x=12、right=378；共享组件另有 13 组通过。21 个产品文件验收前后指纹一致。原生整页项保持未验收。

- 原生补验定位：1.58.2+系统 Chromium152 的纯静态页反例，在配套 Chromium145 中消失；根伪元素后代选择器修正；head 内联 opt-in + rel=expect 等待主内容解析，修复流式目录和历史首次快照过早。最终原生 motion-native-20261114-accepted 的9组、站点7组和共享组件13组全部通过；无诊断固定等待。完整验证 20261114-055137-wt-88b54539-6458：lint738、UI58、Web742及类型检查通过，24个文件验收前后指纹一致。
