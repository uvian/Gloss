# <img src="icons/logo.svg" width="30" height="30" align="absmiddle" alt="Gloss"> Gloss — 网页沉浸学英语与翻译

**Gloss**（原 IFLL）是一款基于 Manifest V3（**Chrome / Edge / Firefox 桌面端 & Firefox 安卓端**）、零构建依赖、本地隐私优先的网页英语学习与双语翻译浏览器扩展。

## 核心特性

- **替换学习（中文网页）**：原生 `Intl.Segmenter` 中文分词 + 搭配短语优先匹配，支持**纯英文替换**与**中英并列**两种显示风格；自动加权优先出现 SM-2 到期复习词与今日新词；桌面端支持悬停 260ms 极简速览气泡。
- **标注学习（英文网页）**：内置英文词形还原（近 200 个不规则词 + 后缀规则），基于 CSS Custom Highlight API 零 DOM 侵入，视口懒加载标注，自动感知 SPA 路由切换，高阶用户聚焦目标等级及以上的生词，移动端自动扩大触控点击容差。
- **双语对比翻译**：基于 `IntersectionObserver` 视口按需翻译 + **微批合并请求（单次合并 4 段附带页面标题语境，省 60%+ Token）**，跨标签页 IndexedDB 持久化缓存，支持一键显隐译文、失败重试及**免 Key 免费翻译兜底**。
- **读写双闭环（输入框快捷译英）**：在桌面网页任意输入框 / 评论框输入中文后**连按三下空格**或按 `Alt+Y`，即时替换为地道英文并支持一键撤销。
- **桌面 + 移动双端 Shadow DOM UI**：完全免疫宿主网页 CSS 污染；点击词条自动附带**当前网页原句语境**并支持 AI「本句语境义」解析与原句入复习库；**手机端自动切换为底部抽屉（Bottom Sheet）词卡（支持下滑关闭与遮罩收起）、右下角可上下拖动的悬浮胶囊，以及自动避开安卓系统菜单的下方划词栏**。
- **完整 SM-2 学习中心（响应式移动适配）**：支持浅/暗主题、**近 30 天学习热力图（窄屏自动 15×2 排布）与连续打卡统计**、**三种主动回忆训练（闪卡自测 / 听音拼写 / 语境填空）**、批量导入词表（TXT/CSV/欧路/扇贝/墨墨）、一键导出 **Anki TSV**、自定义 AI 动作模板及支持 **断点续传** 的后台词库预处理。
- **清洗优化词库**：5,649 条去噪中英词条（覆盖日常 / CET-4 / CET-6 / IELTS / 考研，92.5% IPA 音标覆盖），按需懒加载，闲置页面零内存开销。

## 快速安装（无需构建）

1. **Chrome / Edge / Brave（桌面）**：打开 `chrome://extensions` → 开启右上角「开发者模式」→ 点击「加载已解压的扩展程序」→ 选择本仓库**根目录**（根目录 `manifest.json` 为纯净 Chrome MV3，0 警告直接加载）。
2. **Firefox 桌面端（140+）与安卓端（142+）**：先执行 `./scripts/pack-firefox.sh` 合并 `manifest.firefox.json` 生成 `dist/gloss-firefox-v*.xpi`：
   - **桌面端临时调试**：打开 `about:debugging#/runtime/this-firefox` → 点击「临时载入附加组件」→ 直接选择 `dist/gloss-firefox-v*.xpi`。
   - **桌面 + 安卓永久使用（推荐）**：登录 [Mozilla Add-on Developer Hub](https://addons.mozilla.org/developers/) 提交扩展并选择 **自行分发（On your own / Unlisted）**，下载 Mozilla 官方自动签名后的 `.xpi`：
     - **桌面端**：打开 `about:addons` → 齿轮 → 「从文件安装附加组件」选择已签名的 `.xpi`。
     - **安卓端**：手机 Firefox「设置 → 关于 Firefox → 连点 5 次 Firefox Logo 开启调试模式 → 返回设置 → **从文件安装扩展**」选择已签名的 `.xpi`。

### 快捷操作

- **桌面端**：`Alt + T` 开关对比翻译 · `Alt + M` 切换模式 · `Alt + Y` 或输入框**连按 3 次空格**中文译英 · `Esc` 关闭浮窗
- **移动端**：点击右下角悬浮胶囊快速切模式 / 进学习中心（可按住上下拖动避让网页按钮）· 轻触带虚线词汇打开底部词卡（顶部把手下滑或点遮罩收起）· 长按划词自动在选区下方弹出划词栏

## 目录结构

```text
├── manifest.json          # 纯净 Chrome / Edge MV3 清单（根目录直接加载 0 警告）
├── manifest.firefox.json  # Firefox 桌面/安卓清单补丁（background.scripts + gecko/gecko_android）
├── src/
│   ├── shared/            # 唯一配置源、纯函数工具（含 Anki/词表解析/填空/连击）、统一存储与词库懒加载
│   ├── data/              # 清洗后的 wordbank.json 与轻量元信息
│   ├── background/        # 统一 AI 网关（含 OpenCode Session、微批+语境+免费兜底）、IndexedDB 双缓存、断点续传批处理
│   ├── content/           # 中文分词/英文词形还原、替换/标注/翻译三引擎、输入框译英、双端 Shadow DOM UI、SPA 路由感知
│   ├── popup/             # 桌面 380px / 移动自适应控制弹窗（自定义模型 Combobox、Firefox 权限引导）
│   └── dashboard/         # 响应式学习中心（30天热力图、闪卡/拼写/填空训练、批量导入、Anki导出、暗色主题）
├── scripts/               # clean_wordbank.py 词库清洗脚本、pack-firefox.sh Firefox .xpi 打包脚本
└── tests/                 # Node 原生 node:test 单元测试 + Playwright 桌面/移动双端 Chromium MV3 E2E 测试
```

## 开发与校验

```bash
./prepush-check.sh       # 语法校验 + 跨端 Manifest 检查 + 全部单元测试
python3 tests/e2e.py     # Playwright 真实 Chromium MV3 桌面 + 移动端双端 E2E 验收
./scripts/pack-firefox.sh # 打包生成 Firefox / Firefox Android .xpi
```

## 开源协议

GPL v3. 详见 [LICENSE](LICENSE)。所有学习记录、缓存与 API Key 均存储在本地，仅在你主动触发 AI 功能时向你配置的端点发起请求。
