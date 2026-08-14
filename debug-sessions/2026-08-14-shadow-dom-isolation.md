# 2026-08-14 — 【Shadow DOM 隔离改造】方案文档（尚未写代码，AI 团队开工蓝图）

**Project**: ST-SevenDaysCal（构画）
**状态**: 调研完成，未落一行代码。此文是给后续 AI 团队的分批改造蓝图，含全部现状盘点、改法示例、坑位清单与验收标准，避免重复调研。
**目标**: 把插件的自有窗口（`#sp-modal-root`）从 light DOM 迁入 Shadow DOM，根治 ST 全局样式污染。聊天流内的楼内块（`.sp-inline-box` 等）**不在**本次范围，保持 light DOM。

---

## 一、背景与动机

窗口 `#sp-modal-root` 目前是挂在 `<html>`（`document.documentElement`）下的**普通 light DOM div**，`style.css` 经 manifest 全局注入。ST 的全局规则（`button`/`input`/`h1`/`a`/`scrollbar`/`::selection` 及第三方主题的各种 `*` 规则）会直接级联进窗口。

现状是"打补丁式"对抗：
- `.sp-root, .sp-root * { text-shadow: none !important; }` 压 ST 全局 `*` text-shadow（style.css:171）
- `.sp-root { font-size: var(--sp-fs-100) }` 钉字号（style.css:205）
- 自建 `--sp-*` 色板，经 `.sp-root` 映射 ST 的 `--SmartTheme*` 变量、缺则回退 `-legacy` 写死值

补丁挡不全（正是用户观察到的问题）。Shadow DOM 是根治方案：样式、继承、选择器全部在边界处切断。

---

## 二、现状盘点（已核实的数据，开工勿再重查）

### 挂载点（全部在 `document.documentElement`）
| 组件 | 位置 | 说明 |
|---|---|---|
| `#sp-modal-root` 主窗口 | index.js `injectModal()` 3410 起，`insertAdjacentHTML('beforeend', html)` 挂载 | `class="sp-root sp-${currentTheme}"`，`position:fixed; z-index:2000001` |
| `#sp-fab` 悬浮球 | `injectFab()` 3310 | `z-index:2000000`，**保持 light DOM 不动** |
| `#sp-toast-wrap` | `injectToastContainer()` 12732 | toast 容器，`z-index:2000002` |
| `#sp-confirm` 确认弹窗 | `spConfirm()` ~5850，`appendChild(document.documentElement)` | 带 `sp-root sp-${currentTheme}` 类，`z-index:2000002` |
| `#sp-store-conflict` 冲突弹窗 | `showStoreConflictDialog()` ~5900 | 同上 |
| `#sp-addon-dialog` 决策弹窗 | modal.js `createDialogManager()`，`mount: document.documentElement` | 同上（getRootClass 返回 `sp-root sp-${theme}`） |

### 选择器/交互规模（改造工作量主体）
- `$('#sp-...')` 窗口内 id 查询：**386 处调用 / 140 个唯一 id**（index.js）
- `$('.sp-...')` 类查询：16 处
- `document.getElementById('sp-...')`：28 处，其中**窗口内 10 个**（`sp-anchor-full-host`、`sp-chat-msgs`、`sp-debug-drawer`、`sp-debug-pre`、`sp-outline-chat`、`sp-outline-divider`、`sp-resize-handle`、`sp-space-msgs`、`sp-theater-result`）；其余（`extensionsMenu`、`sp_open_wand`、`sp_wand_container`）是 ST/魔杖菜单的，**不动**
- `appendTo('#sp-...')`：5 处（`#sp-chat-msgs` ×2、`#sp-space-msgs` ×2 等）
- `$(document).on/off` 委托/监听：12 处，其中**窗口内 4 处**需修：
  - `click.spIntro`（4063，`#sp-module-intro-pop` 点外关闭）
  - `click.spActionMenu`（5001，`.sp-action-menu` 点外关闭）
  - `keydown.spActionMenu`（5004，Esc）
  - `click.tadrawer`（5594，`#sp-ta-drawer` 点外关闭）
  - 其余 8 处是楼内条/拖拽/全局 mousemove，**基本不用动**（详见坑位 #4）
- `$(`#${MODAL_ID} .sp-...`)` 带根前缀查询：32 处
- `document.querySelector(`#${MODAL_ID} .sp-sheet`)`：injectFab 的 resize 处理（~3327）、`onDragStart`（~12540）各 1 处

### 样式与图标
- `style.css` 共 5600+ 行：顶层裸 `.sp-*` 选择器 **1154 个**，`.sp-root ` 前缀 **13 处**，`:root` 上定义全部 `--sp-fs-*`/`--sp-scale` 字号令牌，`.sp-root` 上定义色板映射
- Font Awesome 图标：**191 处** `class="fa-...`（`<i>` 标签，含 `fa-solid`/`fa-regular`），ST 从 `css/fontawesome.min.css`（ST 根相对路径）加载
- 代码里已有 inline SVG 先例（`PEN_ICON_SVG`，index.js 顶部），但**不建议**为本次改造逐个替换 FA（量太大），走 shadow 内 `<link>` 方案

### 已有 shadow DOM 先例（重要参考）
- index.js:8826 `sp-anchor-full-host`（坐标快照全屏）：`attachShadow({mode:'open'})` + `:host{all:initial;display:block}` + 内联 `<style>`，**已踩过 `:host{all:initial}` 切断颜色继承的坑**，注释写明了正解（给容器一对自洽的底+字、探针解析 CSS 变量）
- 结论：团队对 shadow 行为（继承切断、UA 样式复活）已有实战认知

---

## 三、原理层：shadow DOM 对本次改造的行为清单（先读这个再动手）

1. **CSS 自定义属性穿透 shadow 边界（继承方向）**：`--sp-*` 定义在 `:root`/`.sp-root`（light DOM），shadow 内部**照样能读**。→ 主题色板、`--sp-scale` 缩放、ST 主题映射**零改动**。
2. **选择器不穿透**：`$('#sp-modal-root .sp-close-btn')`、`$('#sp-chat-msgs')`、`document.getElementById('sp-chat-msgs')` 全部失效。只有 host 本身（`$('#sp-modal-root')`）仍可查到。→ 本次改造**最大工作量**，需要 `$in()` 辅助函数 + 全量替换。
3. **事件重定向（retargeting）**：shadow 内元素的事件冒泡到外部监听者时，`event.target` 被替换成 host。→ document 级"点外部关闭弹层"逻辑会**逻辑反转**（点窗口内部也被当点外面）。
4. **事件冒泡本身不受阻**：mousemove/mousedown 等从 shadow 冒泡到 document 正常，闭包式拖拽（读 `clientX/Y`、不依赖 target）不受影响。
5. **`position:fixed` 在 shadow 内仍相对视口**（只要 host 无 transform/filter/contain）。host 保持 `position:fixed; z-index:2000001`，内部 `.sp-backdrop`/`.sp-sheet` 的 fixed 语义不变。
6. **全局 CSS 规则不进入 shadow**（这正是目的）：ST 的 button/input/滚动条/`*` 规则全部失效；**代价是 FA 的 `::before` 图标规则也失效**（见批次 1 的 link 方案）。
7. **`:host{all:initial}` 是坑**：切断继承（含 `--sp-*` 变量与颜色）。窗口改造**不要**用 `all:initial`，靠 wrapper 上的 `sp-root` 类 + 自定义属性穿透来继承令牌。
8. **shadow 内 `<link rel="stylesheet">` 合法**：可引自身 style.css 与 ST 的 fontawesome.min.css，加载结果仅作用于该 shadow。
9. **focus/activeElement**：shadow 内元素可正常聚焦，`document.activeElement` 能取到（composed）。

---

## 四、分批改造方案（每批独立可验证、独立 commit，出问题好回退）

### 批次 1：窗口主体迁入 shadow（最小闭环，先让窗口能开能关）

**1a. 宿主结构改造（injectModal，~20 行）**

```js
function injectModal() {
    // ...原 html 模板字符串不变...
    const host = document.createElement('div');
    host.id = MODAL_ID;
    host.className = `sp-root sp-${currentTheme}`;   // host 保留原 class（变量穿透 + light 样式）
    host.style.cssText = 'display:none;position:fixed;z-index:2000001';
    const root = host.attachShadow({ mode: 'open' });
    // shadow 内第一层 wrapper：必须带 sp-root + 主题类，让 style.css 里 13 处
    // `.sp-root ...` 前缀选择器与 `.sp-root{position:fixed}` 照常匹配。
    // wrapper 的 position:fixed 无偏移 = 静态位置，无害（host 也无 transform）。
    root.innerHTML = `
        <link rel="stylesheet" href="${EXT_BASE}/style.css">
        <link rel="stylesheet" href="${ST_BASE}/css/fontawesome.min.css">
        <div class="sp-root sp-${currentTheme}" style="display:contents">${html}</div>`;
    document.documentElement.appendChild(host);
    // ...原事件绑定段全部改为 $in() 查询（见 1b）...
}
```

- `EXT_BASE` = 本扩展目录绝对路径，可由 `import.meta.url` 推导；`ST_BASE` = ST 站点根（引 `css/fontawesome.min.css`，与 ST 共用缓存）。**注意**：`style.css` 顶部有 `@import url(googleapis Roboto Mono)`，经 `<link>` 加载时可用，无需处理。
- 若用 `display:contents` 有顾虑（某些浏览器对 fixed 子元素的解析），可省略、让 wrapper 正常 block 参与布局（.sp-root 的 fixed 无偏移 = 静态位置，实测无害）。
- `openSchedule()`/`closePanel()` 里对 `#sp-modal-root` 的 `show()/hide()` 操作对象是 host，**不用改**。

**1b. 引入 `$in()` 辅助函数（批次 2 全量替换的地基）**

```js
let _spShadow = null;   // injectModal 里赋值
const $in = (sel) => { const el = _spShadow?.querySelector(sel); return el ? $(el) : $(); };
// 原生版：
const inEl = (sel) => _spShadow?.querySelector(sel) ?? null;
```

- **本批次立即替换**：injectModal 尾部全部绑定段（`$(`#${MODAL_ID} .sp-close-btn`)` 等 ~10 处）+ `onDragStart`/resize 里的 `document.querySelector(`#${MODAL_ID} .sp-sheet`)` + `toggleAnchorFullscreen` 的 `#sp-anchor-body` 查询。**不换这些窗口打不开/拖不动**。
- 逐处替换原则：`$('#sp-foo')` → `$in('#sp-foo')`；`$(el).closest('.sp-...')` 这类**元素内遍历不跨边界，不用改**。

**验收（批次 1）**：窗口可开可关、FAB 可用、拖拽/缩放可用、主题跟随正常、图标全显、无 console 报错。楼内块样式不变。

### 批次 2：选择器全量替换（工作量主体，~400 处）

- **范围**：386 处 `$('#sp-...')` + 16 处 `$('.sp-...')`（指全局查询，非 `$(this)`/`$(e.target)`）+ 28 处 `getElementById` 中的窗口内 10 个 + 5 处 `appendTo('#sp-...')`。
- **方法建议**：用脚本辅助（正则把 `$('#sp-` 前缀批量替换为 `$in('#sp-`）→ **人工逐处复核**（很多是模板字符串拼接、跨行，正则不可全信）。批内按模块分区提交（body/历/线/面/间/棱/坐标/设置），每区单独验证。
- **排除清单**（见"不要碰"）：
  - 楼内块相关查询（`.sp-inline-box`、`click.spalmstrip`、`click.spschstrip` 委托）——在 ST 聊天流 light DOM 里，保持原样；
  - `$('#sp-modal-root')` 本身（host）——保持原样；
  - `$('#sp-fab ...')`、`$('#sp-toast-wrap')`——若批次 4 决定 toast 留 light DOM 则保持原样；
  - ST 的 `extensionsMenu`、`sp_open_wand`、`sp_wand_container`。

**验收（批次 2）**：逐模块点一遍（生成点/线/面/历、暗账、坐标收藏、设置面板全开关），无失效交互。

### 批次 3：事件委托修复（4 处 + 检查拖拽）

- `click.spIntro`（4063）/ `click.spActionMenu`（5001）/ `keydown.spActionMenu`（5004）/ `click.tadrawer`（5594）：现在绑 `$(document)`、判断 `$(e.target).closest(...)`，**在 shadow 下 target 被重定向为 host 会逻辑反转**。
- **修法二选一**：
  - A（推荐）：把委托改绑到 shadow 内部 wrapper（`$in('#sp-modal-root')` 或专门的内层容器）——监听在 shadow 内，target 不失真，现有 closest 判断原样可用；点外部关闭仍需 document 监听，但判断改用 `e.composedPath().includes(host)`；
  - B：继续绑 document，判断全改 `e.composedPath()`。
- 注意 `keydown`：键盘事件不冒泡出 shadow？——**会**冒泡（composed），但同样 retarget。Esc 关闭逻辑照 A/B 处理。
- 拖拽类（`mousemove.spdrag` 12538 / `mousemove.spresize` 12606 / FAB 拖拽）：闭包读坐标不依赖 target，**不用改**；但 `onDragStart` 里 `$(e.target).closest('.sp-icon-btn, ...)` 的 e.target 来自**绑在 sheet 上的 mousedown**（批次 1 已把绑定换到 $in），target 不失真，可用。

**验收（批次 3）**：点窗外关弹层/关抽屉/关菜单、Esc 关闭，全部行为与改造前一致。

### 批次 4：弹窗族迁入（决策：一起进 or 分批）

- 候选：`spConfirm`（`#sp-confirm`）、`showStoreConflictDialog`（`#sp-store-conflict`）、modal.js `createDialogManager`（`#sp-addon-dialog`）、toast（`#sp-toast-wrap`）。
- **建议**：前三个迁入窗口的 shadow root（每处改动 ~5 行：`appendChild(document.documentElement)` → `_spShadow.appendChild`；`$('#sp-confirm')` 移除与查找 → `$in`）。它们现在挂 documentElement 的理由（z-index 压面板、body transform 坑，见 5876 注释）在 shadow 内**依然成立**——host 已是 html 级 2000001 层叠上下文，内部 2000002 照常压面板。
- **toast**：建议**暂留 light DOM**（它已有 `sp-toast` 类 + text-shadow 清零，受污染面最小；且 `showToast` 有"zmer-toast-theme-loader 插件接管"分支，动了容易踩第三方）。留个 TODO，用户反馈再迁。
- 迁入后注意：`customDialog` 的 `mount` 参数从 `document.documentElement` 改为 shadow wrapper；`getRootClass()` 返回的 `sp-root sp-${theme}` 类可保留（shadow 内样式照常匹配）。

**验收（批次 4）**：三类弹窗 + 冲突弹窗显示/层级/点外关闭正常；toast 行为与改造前一致。

### 批次 5：清理、回归、收尾

- 检查并删除批次 2/3 遗留的"改了一半"的选择器（grep `#sp-modal-root` 确认只剩 host 自身与注释）。
- 全量回归（见第六节验收清单）。
- 文档：更新本文件状态节；若有需要，在 style.css 头部补一段注释说明"本文件同时被 light DOM（楼内块）与 shadow（窗口）加载"。
- 版本 bump 按项目惯例（用户验证后再统一发版）。

---

## 五、坑位清单（按踩中概率排序，开工先看）

1. **【必踩】jQuery 选择器不穿透 shadow**——批次 2 的主体，漏一处 = 一处交互静默失效（`$()` 返回空集合不报错，最难查）。建议每替换一区就实测一区。
2. **【必踩】事件 retarget 导致"点外关闭"逻辑反转**——批次 3，改完 2 之后立刻出现（表现为：菜单/抽屉一点就关、或永远关不掉）。
3. **【必踩】FA 图标全灭**——批次 1 的 `<link>` 必须与窗口同时落地，否则整窗"裸奔"。
4. **【半踩】`getElementById('sp-anchor-full-host')`**（8826 附近）——该 id 在 shadow 内，改造后查不到 → 坐标快照不渲染。它自己又建了一层 shadow，迁入后变成"shadow 套 shadow"，**合法**，但代码里 `document.getElementById` 必须改 `inEl`。
5. **【半踩】`document.body.appendChild(probe)`**（12705 主题探测）——light DOM，不动；但确认它读的变量是 shadow 能继承到的（`:root` 级，能）。
6. **【半踩】`.sp-root` 前缀选择器（13 处）**——shadow 内无 `.sp-root` 祖先会失配 → 批次 1 的 wrapper 必须带 `sp-root` 类；同理 wrapper 需带 `sp-${currentTheme}`（`applyTheme` 只改 host 的类，shadow 内 wrapper 的类是静态的——**若主题类只在 host 上，`.sp-night` 色板（`--sp-sheet-bg-legacy` 等）在 shadow 内还能靠穿透继承**，但 `.sp-night .sp-xxx` 这类**后代选择器**会失配 → 建议 wrapper 也动态同步主题类，或干脆让 applyTheme 同时更新 wrapper 类。**这点批次 1 就要设计好**）。
7. **【小】`@import` 在 shadow `<link>` 内可用**；`color-mix()` 与 shadow 无关，不受影响。
8. **【小】`:root` 的 `--sp-scale` 由 `document.documentElement.style.setProperty` 写入**——穿透继承，零改动。
9. **【小】移动端 resize 处理**（injectFab 内）里有 `document.querySelector(`#${MODAL_ID} .sp-sheet`)`——批次 1 换掉，否则手机切屏后窗口布局错乱。
10. **【不踩】楼内块**（`.sp-inline-box`/历/点/线/标注池/召回）在 ST 聊天流里——**绝不迁 shadow**，否则脱离聊天流 DOM 结构、ST 的渲染/折叠逻辑全毁。
11. **【备忘】`style.css` 会加载两份**（light 一份给楼内块、shadow 一份给窗口）——浏览器缓存，无感；不要"优化"成删全局那份。

---

## 六、验收清单（全量回归用）

- [ ] 窗口打开/关闭、FAB 开关联动正常
- [ ] 窗口内无 ST 样式渗透：button/input/textarea/滚动条/文字阴影/`::selection` 与改造前一致（或更干净）
- [ ] FA 图标全部显示（含设置面板、空态、按钮）
- [ ] 主题：auto/day/night 三态切换，窗口色板正确（尤其 `.sp-night .sp-xxx` 后代选择器失配问题）
- [ ] 字号缩放（设置里 −/＋ 改 --sp-scale）实时生效
- [ ] 桌面拖拽/右下角 resize/移动端近全屏布局正常
- [ ] 点线面间棱坐标七模块各自渲染与交互正常
- [ ] 三类弹窗（confirm/决策/冲突）+ toast 显示与层级正常、点外关闭正常
- [ ] 菜单/TA 抽屉/模块介绍 pop 的点外关闭与 Esc 正常
- [ ] 聊天流楼内块（历/点/线/标注池/召回）样式与改造前**完全一致**
- [ ] 坐标收藏快照全屏（shadow 套 shadow）正常
- [ ] 浏览器 console 无报错；`$('#sp-...')` 无残留（grep 复核）

## 七、回滚与提交策略

- 每批独立 feature 分支 + 独立 commit（checkpoint），验证通过才合并；单批出问题可单独 revert。
- 批次 1 是最小闭环，建议优先落地并多打几个 checkpoint（宿主结构 → link → 绑定段，可再拆）。
- 全部完成、用户验证后再统一 bump 版本/发版（照项目惯例「做一个验证一个、验证前不提交 master」）。

---

## 附：本次调研的关键文件位置速查

| 内容 | 位置 |
|---|---|
| 主窗口注入 | index.js `injectModal()` 3410（挂载 `insertAdjacentHTML` 在函数尾） |
| FAB 注入/拖拽 | index.js `injectFab()` 3310 |
| toast | index.js `injectToastContainer()` 12732 / `showToast()` 12752 |
| 确认弹窗 | index.js `spConfirm()` ~5850 |
| 冲突弹窗 | index.js `showStoreConflictDialog()` ~5900 |
| 决策弹窗 | modal.js `createDialogManager()`（mount: documentElement） |
| 主题切换 | index.js `applyTheme()` 12465（只改 host 类） |
| 拖拽/resize | index.js `onDragStart` ~12520、`onResizeStart` ~12600 |
| 已有 shadow 先例 | index.js 8826 `sp-anchor-full-host`（含 `:host{all:initial}` 踩坑注释） |
| 色板/令牌 | style.css :root（字号令牌）、`.sp-root`（ST 变量映射 136-168）、`.sp-night/.sp-day`（legacy 回退） |
| 楼内块样式 | style.css `.sp-inline-box` 系列（**保持 light DOM**） |

---

## 八、状态节（2026-08-14 晚更新 — 全部落地）

| 批次 | 提交 | 内容 | 验证 |
|---|---|---|---|
| 批次1（窗口宿主迁 shadow） | `8e60747`（recovery，逐字还原改造主力工作）+ `07a50ed`（hotfix-inAll 增 `$inAll` 集合版） | helpers（`$in`/`inEl`/`$inAll`/`_spShadow`/`EXT_BASE`/`ST_BASE`）、injectModal 宿主+attachShadow+双 `<link>`+wrapper、绑定段、applyTheme wrapper 主题类同步、拖拽/缩放 inEl | 23 hunks 逐 hunk 复核 ✅、node --check ✅ |
| 批次2-下半（历/线/面/坐标） | `960fdb4` | 54 行 ①-⑥ 区域全转 | ✅ |
| 批次2-上半（骨架/间/棱/设置） | `33217ce`/`b0d0d1d`/`4ad8049`/`eece6e3`/`1bfb303` | 318 行（含 `#chat` 混合委托双绑拆分 ×7、view-btn 委托改绑 `$in('.sp-sidebar')`） | grep 残留全零（除排除清单）✅ |
| 批次3（事件委托 4 处） | `d960355` | spIntro/spActionMenu/tadrawer → composedPath；keydown 零改动 | ✅ |
| 批次4（弹窗族） | `c33e528` | spConfirm/store-conflict/customDialog 挂 `_spShadow`；toast 留 light | ✅ |
| 批次5（清理+回归+文档） | `576fb9d`+本批 | 回归清单、grep 复核、style.css 头注释、状态节 | 静态 ✅；运行期待用户 ST 实测 |

**grep 终态**（`index.js`）：`$('#sp-` 剩 3 行 = TODO 注释 1 + `#sp-toast-wrap` 2（排除清单）；`$('.sp-` 0；`getElementById('sp-` 0；`appendTo('#sp-` 0；`$(`#${MODAL_ID}`)` 仅宿主级 15 处（is(':visible')/show/hide/animate/类切换）；`$(document).on` 仅楼内块（spalmstrip/spschstrip）+ 拖拽（fabdrag/spdrag/spresize）+ 批次3 三站点（composedPath 版）。

**运行期验证**：按 `2026-08-14-batch5-regression-checklist.md` S2（R-1..R-16）由用户在 ST 实测，通过后按项目惯例 bump 版本。
