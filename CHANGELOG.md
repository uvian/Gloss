# Gloss（原 IFLL）— 更新日志

## v0.5.2 — 2026-11-23

### 品牌升级为 Gloss 与全新矢量 Logo
- **正式更名为 Gloss**：`manifest.json` 名称更新为 `Gloss — 网页沉浸学英语与翻译`（16 字符，完全满足 Firefox ≤ 45 字符规范），同步焕新弹窗（Popup）、学习中心（Dashboard）、网页悬浮胶囊与首次引导条、浏览器右键菜单、配置备份与 Anki 导出文件名/标签，同时**保留 `ifll@wto.li` 扩展 ID 与全部本地存储键名**，确保老版本与 AMO 线上升版零数据丢失。
- **全新品牌 Logo**：以「暖纸书卷 + 牛津墨蓝 + 琥珀金行间批注条与星芒」打造纯矢量图标 [icons/logo.svg](icons/logo.svg)，生成全套透明圆角 PNG（16 / 32 / 48 / 128px），并嵌入 Popup 与学习中心顶栏与标签页 Favicon。

---

## v0.5.1 — 2026-11-23

### Mozilla AMO 审核零错误零警告改造（全量零 `innerHTML`）
- **全面消除 `innerHTML` 警告**：在 `src/shared/utils.js` 新增安全 DOM 构建工具 `createEl` / `createSvg` / `renderBoldFragment`，将 `src/content/shadow-ui.js`、`src/dashboard/dashboard.js` 与 `src/popup/popup.js` 中的全部 `innerHTML` 赋值与字符串拼接 SVG 图标彻底重构为原生 DOM API 与 `createElementNS`（同时校验学习中心原句来源链接协议），实现全仓库零 `innerHTML` / `outerHTML` / `insertAdjacentHTML`。
- **修复 Firefox 扩展名称长度超限与 `service_worker` 警告**：将 `manifest.json` 名称精简至 33 字符（满足 Firefox ≤ 45 字符限制），并升级 `scripts/pack-firefox.sh` 在打入 `.xpi` 时自动剔除 Firefox 副本中的 `background.service_worker` 字段（保留仓库源码对 Chrome + Firefox 的双端直接加载能力），使 AMO 自动校验达成 0 错误、0 警告。
- **固化静态防回归守卫**：在 `prepush-check.sh` 增加 `manifest.json` 名称长度 ≤ 45 校验与全量零 `innerHTML` 检查。

---

## v0.5.0 — 2026-11-23

### Firefox 桌面 / 安卓端全面兼容与移动端深度交互适配
- **单份 Manifest 跨端兼容 Chrome + Firefox（含安卓）**：在 `manifest.json` 同时声明 `background.service_worker` 与 `background.scripts`，补齐 `browser_specific_settings.gecko_android` 与 AMO 要求的 `data_collection_permissions`；`background.js` 自动兼容 `importScripts` 与缺失 `chrome.windows` 的安卓环境；Popup 增加静默网页权限检测引导与 `speechSynthesis` 容错、延迟释放导出 Blob URL。
- **移动端原生级 Shadow DOM 体验（桌面端零回归）**：
  - 触屏/窄屏下词卡自动切换为**底部抽屉（Bottom Sheet）**，附带半透明防误触遮罩、顶部把手**下滑关闭手势**、安全区适配与放大触控热区；桌面端仍保持原位锚定与拖拽。
  - 划词工具栏新增 `selectionchange` / `touchend` 支持，并在触屏端自动定位至选区**下方**以避开安卓系统原生「复制/分享」浮条，同时接入 `visualViewport` 适配缩放与软键盘。
  - 触屏端自动关闭悬停速览气泡避免点击闪烁；右下角悬浮胶囊支持**单指上下拖动**避让网页原生按钮；英文标注 Highlight API 点击判定在触屏端自动扩大 8px 容差并就近命中。
- **Popup & 学习中心全响应式布局**：Popup 在桌面端严格维持 380px 宽度，在触屏设备自动铺满全宽并增大触控控件高度；学习中心小屏下 30 天热力图自动转为 15×2 网格、SM-2 评分转为 2×2 大按钮，全面消除窄屏横向溢出。
- **新增 Firefox 打包与移动 E2E 验收**：新增 `scripts/pack-firefox.sh` 一键生成 `.xpi`，并在 `tests/e2e.py` 增加 375×812 触屏移动端的完整端到端验收。

---

## v0.4.1 — 2026-11-23

### OpenCode Go 兼容修复与弹窗表单交互优化
- **修复 OpenCode Go 请求报错**：向 `opencode.ai`（及其子域名）发出的 `/chat/completions`（含流式 SSE）与 `/models` 请求自动携带按任务域隔离且稳定的 `x-opencode-session` 请求头，并扩展 HTTP 400 参数兼容自动降级重试（`response_format` / `thinking` / `temperature`）与错误信息展示长度（160 字符）。
- **更新 OpenCode Go 预设模型目录**：补充 `deepseek-v4.1-flash`、`glm-5.3-flash`、`glm-5.3`、`glm-5.2`、`qwen3.8-flash`、`kimi-k3`、`kimi-k2.7-code`、`minimax-m3`、`mimo-v2.6-flash` 等当前可用模型。
- **重构模型选择下拉框与表单视觉**：移除突兀的系统原生 `<datalist>`，改用符合全站暖纸极简风格的自定义可搜索 Combobox（支持关键词过滤、键盘上下/回车/Esc、底部空间不足自动向上翻转、SVG 勾选标识与自定义模型快捷项），并统一弹窗内 `<select>` 箭头、勾选框配色与表单列对齐。

---

## v0.4.0 — 2026-11-23

### 核心体验与学习闭环跃升
- **上下文原句语境解析与原句入复习库**：点击网页词条自动提取所在原句，AI 深度解析新增「本句语境义」；加入 SM-2 复习队列时同步保存网页原句与来源链接，在闪卡中回看真实阅读场景。
- **对比翻译微批合并 + 免费免 Key 兜底**：同视口相邻 2–4 个短段合并为单次结构化翻译请求（附 `document.title` 语境锚点，省 60%+ Input Token 且术语更连贯）；未配置 API Key 时支持自动启用免费翻译引擎兜底（可开关）。
- **主动回忆训练升级 + 30 天学习热力图**：学习中心新增「听音拼写」「语境填空（Cloze）」两种主动回忆模式，叠加 30 天学习轨迹热力图、连续打卡天数统计与完整暗色主题。
- **输入框快捷中译英（读写双闭环）**：在网页输入框 / `<textarea>` / 富文本内输入中文后连按 3 次空格或按 `Alt+Y`，即时替换为英文译文并提供 Toast 一键撤销。
- **Hover 极简速览 + 中英并列替换模式**：鼠标悬停词条 260ms 显示单行速览气泡，减少点击打断；替换模式可选「纯英文替换」或「中英并列（`学习(study)`）」。
- **划词直出词卡 + 右键菜单 + 图标待复习角标**：划词工具栏新增「词卡」按钮支持任意词/短语查卡；注册右键菜单（翻译 / 打开词卡 / 加入复习）；工具栏图标实时显示 SM-2 待复习角标。
- **词表批量导入 & Anki 互通**：学习中心支持粘贴或上传 TXT/CSV/TSV 词表（兼容欧路 / 扇贝 / 墨墨 / Anki 格式），并支持一键导出标准 5 列 Anki TSV。
- **SPA 路由切换感知 + 批处理断点续传 + Popup 实时模式同步**：单页应用切换文章自动刷新标注去重集与语种策略；SW 批处理队列持久化并由 `chrome.alarms` 保活续跑；弹窗自动查询当前页实际生效模式并高亮标注「自动/固定」。
- **完整测试保障**：单元测试扩至 25 项，并固化 [tests/e2e.py](tests/e2e.py) 真实 Chromium MV3 端到端验收套件。

---

## v0.3.0 — 2026-11-23

### 架构重构与核心缺陷修复
- 拆分 1,371 行单体 `injector.js` 为 `shared/`、`background/`、`content/`、`popup/`、`dashboard/` 模块化架构。
- Shadow DOM 完全隔离浮窗、划词栏与悬浮胶囊；清洗 5,649 条词库并转为按需懒加载 JSON（修复 IPA 弱音、296 条误标词性、斜杠词条、补齐 IELTS 550 词）。
- 修复多词替换逆序错乱、翻译缓存 0% 命中、透明背景误判暗黑、朗读按钮隐形、划词栏卡死与脱离 DOM、批量任务关弹窗中断等核心问题。

---

## v0.2 — 2026-07-21

- Tooltip 亮暗自动切换、词库统计、批量预处理、推理模型兼容与文学极简风格。