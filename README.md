# IFLL — 沉浸式英语学习与辅助翻译浏览器扩展

**IFLL（Immersive Foreign Language Learning）** 是一款基于 Manifest V3（Chrome / Edge / Firefox）、零构建依赖、本地隐私优先的网页英语学习与双语翻译插件。

## 核心特性

- **替换学习（中文网页）**：原生 `Intl.Segmenter` 中文分词 + 搭配短语优先匹配，支持**纯英文替换**与**中英并列**两种显示风格；自动加权优先出现 SM-2 到期复习词与今日新词；支持悬停 260ms 极简速览气泡。
- **标注学习（英文网页）**：内置英文词形还原（近 200 个不规则词 + 后缀规则），基于 CSS Custom Highlight API 零 DOM 侵入，视口懒加载标注，自动感知 SPA 路由切换，高阶用户聚焦目标等级及以上的生词。
- **双语对比翻译**：基于 `IntersectionObserver` 视口按需翻译 + **微批合并请求（单次合并 4 段附带页面标题语境，省 60%+ Token）**，跨标签页 IndexedDB 持久化缓存，支持一键显隐译文、失败重试及**免 Key 免费翻译兜底**。
- **读写双闭环（输入框快捷译英）**：在网页任意输入框 / 评论框输入中文后**连按三下空格**或按 `Alt+Y`，即时替换为地道英文并支持一键撤销。
- **Shadow DOM 隔离浮窗 & 划词词卡 & 右键菜单**：完全免疫宿主网页 CSS 污染；点击词条自动附带**当前网页原句语境**并支持 AI「本句语境义」解析与原句入复习库；划词栏支持直接打开完整词卡；同步提供右键菜单快捷入口。
- **完整 SM-2 学习中心**：支持浅/暗主题、**近 30 天学习热力图与连续打卡统计**、**三种主动回忆训练（闪卡自测 / 听音拼写 / 语境填空）**、批量导入词表（TXT/CSV/欧路/扇贝/墨墨）、一键导出 **Anki TSV**、自定义 AI 动作模板及支持 **断点续传** 的 Service Worker 后台词库预处理。
- **清洗优化词库**：5,649 条去噪中英词条（覆盖日常 / CET-4 / CET-6 / IELTS / 考研，92.5% IPA 音标覆盖），按需懒加载，闲置页面零内存开销。

## 快速安装（无需构建）

1. **Chrome / Edge / Brave**：打开 `chrome://extensions` → 开启右上角「开发者模式」→ 点击「加载已解压的扩展程序」→ 选择本仓库**根目录**。
2. **Firefox (125+)**：打开 `about:debugging#/runtime/this-firefox` → 点击「临时载入附加组件」→ 选择根目录下的 `manifest.json`。

### 常用快捷键

- `Alt + T`：开启当前页双语对比翻译 / 一键显隐译文
- `Alt + M`：快速切换学习模式（替换 / 标注 / 翻译 / 关闭）
- `Alt + Y` / 输入框内**连按 3 次空格**：将当前输入框中文即时译为英文
- `Esc`：关闭浮窗卡片或划词工具栏

## 目录结构

```text
├── manifest.json
├── src/
│   ├── shared/          # 唯一配置源、纯函数工具（含 Anki/词表解析/填空/连击）、统一存储与词库懒加载
│   ├── data/            # 清洗后的 wordbank.json 与轻量元信息
│   ├── background/      # Service Worker: 统一 AI 网关（微批+语境+免费兜底）、IndexedDB 双缓存、断点续传批处理、图标角标与右键菜单
│   ├── content/         # 中文分词/英文词形还原、替换/标注/翻译三引擎、输入框译英、Shadow DOM UI、SPA 路由感知
│   ├── popup/           # 380px 极简控制弹窗（实时同步生效模式）
│   └── dashboard/       # 学习中心（30天热力图、闪卡/拼写/填空训练、批量导入、Anki导出、暗色主题）
├── scripts/             # clean_wordbank.py 词库清洗脚本
└── tests/               # Node 原生 node:test 单元测试 + Playwright 真实 Chromium MV3 E2E 测试
```

## 开发与校验

```bash
./prepush-check.sh       # 语法校验 + Manifest 检查 + 全部单元测试
python3 tests/e2e.py     # Playwright 真实 Chromium MV3 扩展端到端验收
```

## 开源协议

GPL v3. 详见 [LICENSE](LICENSE)。所有学习记录、缓存与 API Key 均存储在本地，仅在你主动触发 AI 功能时向你配置的端点发起请求。
