# 批次4 弹窗族迁入 Shadow DOM — 改造方案（草稿）+ 批次5 回归清单

**状态（2026-08-14 晚，批次4/5 落地后）**：批次4 ✅ `c33e528`；批次2-上半 ✅ `33217ce`/`b0d0d1d`/`4ad8049`/`eece6e3`/`1bfb303`（改造主力下线后由回归质检接手）；批次3 ✅ `d960355`；批次5 静态验收 ✅（S1 grep 全套见 `2026-08-14-batch5-regression-checklist.md`），运行期验证待用户在 ST 实测。

**基线**: 提交 `28d48b1` 行号 + 批次1 落地后的 `_spShadow` 契约
**负责人**: 回归质检（批次4/批次5）
**前置**: 批次1（`_spShadow`/`$in`/`inEl` 已定义）、批次2（选择器全量替换）、批次3（事件委托修复）落地并验证通过

---

## 一、批次4：弹窗族迁入 shadow

### 1. 候选清单与现状

| 弹窗 | 位置 | 现状挂载 | 现状查询 | 层级 |
|---|---|---|---|---|
| `spConfirm` | index.js ~5850 | `document.documentElement.appendChild`（5876 附近，注释说明不能挂 body：移动端 body 有 transform） | `$('#sp-confirm')`（5743 关闭、5852 remove） | z-index:2000002 |
| `showStoreConflictDialog` | index.js ~5900 | 同上 | `$('#sp-store-conflict')`（5903 remove） | z-index:2000002 |
| `customDialog`（决策弹窗） | modal.js `createDialogManager`，实例化于 index.js 247 | `mount: document.documentElement`（modal.js 60/128 `mount.appendChild`） | `$(`#${OVERLAY_ID}`)`（`sp-addon-dialog`，modal.js 27） | 面板同层 |
| toast | index.js `injectToastContainer` 12732 / `showToast` 12752 | `document.documentElement` | `$('#sp-toast-wrap')`（12736） | z-index:2000002 |

### 2. 改法（每处 ~5 行）

**通用前提**：host 已是 html 级 `position:fixed; z-index:2000001` 层叠上下文，shadow 内部 `z-index:2000002` 照常压面板；`position:fixed` 在 shadow 内仍相对视口（host 无 transform/filter）。→ 现在挂 documentElement 的理由（压面板/避开 body transform）在 shadow 内**依然成立**。

**2a. spConfirm（~5850）**
```js
// 原：document.documentElement.appendChild($ov[0]);
_spShadow.appendChild($ov[0]);
// 原：$('#sp-confirm').remove();  →  $in('#sp-confirm').remove();
// 原：$('#sp-confirm .sp-confirm-cancel').trigger('click');  →  $in('#sp-confirm .sp-confirm-cancel').trigger('click');
```
- `$ov` 是 jQuery 对象：`_spShadow.appendChild($ov[0])` 与现有 appendChild 语义一致。
- 点外关闭 `$ov.on('click', e => e.target === this)` 绑在 $ov 自身上，shadow 内不重定向，**原逻辑可用**（不必走 composedPath）。
- 换 chat 关闭（`event_types.CHAT_CHANGED` → onExternalClose）：监听器在 light DOM 侧，`$ov.remove()` 走 `$in` 即可，无事件问题。

**2b. showStoreConflictDialog（~5900）**
- 同上三处：`appendChild` → `_spShadow.appendChild`；`$('#sp-store-conflict').remove()` → `$in('#sp-store-conflict').remove()`。
- `$ov.addClass('sp-root sp-${currentTheme}')` 保留——shadow 内 class 照常匹配 style.css（批次1 已把 style.css 经 `<link>` 注入 shadow）。
- 注意：`reloadAfterConflict()`（5939）会 `location.reload()`，与挂载点无关，不动。

**2c. customDialog（modal.js createDialogManager）**
- 实例化处 index.js 247：`mount: document.documentElement` → `mount: _spShadow`（或批次1 的 wrapper；`_spShadow` 全局变量即可）。
  - ⚠️ **时序**：`customDialog` 是模块顶层 const（247），而 `_spShadow` 在 injectModal() 运行时才赋值。方案：mount 参数改成一个**惰性求值包装**：
    ```js
    mount: { appendChild: (el) => _spShadow.appendChild(el) },
    ```
    或把实例化改为函数/延迟到 injectModal 之后。**推荐前者**（改动最小，createDialogManager 只用了 `mount.appendChild`）。
- modal.js 内部 `$(`#${OVERLAY_ID}`).remove()`（27）：OVERLAY_ID 在 shadow 内后 `$()` 查不到。两案：
  - A：modal.js 增加可选参数 `removeOverlay`（默认 `$(`#${OVERLAY_ID}`).remove()`），实例化时传 `() => $in('#sp-addon-dialog').remove()` —— modal.js 保持通用。
  - B：把 modal.js 的查询也统一成注入的 `$in` —— 破坏通用性，不推荐。
- `getRootClass()` 返回 `sp-root sp-${theme}` 类**保留**（shadow 内 style.css 照常匹配 `.sp-root …` 前缀选择器与主题色板）。主题切换时该类是静态的——与批次1 wrapper 同源问题，统一由批次1 的 applyTheme 同步策略解决（wrapper 主题类动态同步）。
- `$overlay.on('keydown', Esc)`/点外关闭绑在 $overlay 自身 → shadow 内不重定向，原逻辑可用。

**2d. toast：留 light DOM（决议）**
- 理由：`sp-toast` 类 + text-shadow 清零已免疫大部分污染；有 `zmer-toast-theme-loader` 插件接管分支，动了易踩第三方；受污染面最小（短命元素）。
- TODO（用户反馈再迁）：若迁，`injectToastContainer` 的 `appendChild(document.documentElement)` → `_spShadow.appendChild`，`showToast` 的 `$('#sp-toast-wrap')` → `$in`，且确认 zmer 插件分支行为。

### 3. 验收（批次4）
- [ ] 三类弹窗（confirm/决策/冲突）显示、层级（压在面板之上）、点外关闭、Esc、换 chat 关闭全部正常
- [ ] 冲突弹窗的 云端/本机/暂不决定 三选一逻辑正常
- [ ] toast 显示/点击/错误态与改造前一致
- [ ] 移动端（body transform 场景）弹窗位置正常
- [ ] console 无报错

---

## 二、批次5：回归清单（照方案文档第六节，逐项给验证方法）

| # | 项 | 验证方法 | 关联批次 |
|---|---|---|---|
| R-1 | 窗口打开/关闭、FAB 开关联动 | 点 FAB 开窗 → 关窗 → 再开；设置里 fab 开关切换后 FAB 消失/重现 | 1 |
| R-2 | 窗口内无 ST 样式渗透 | 对比改造前：button/input/textarea/滚动条/text-shadow/`::selection` | 1 |
| R-3 | FA 图标全显 | 打开设置面板/空态/各按钮，图标无方框 | 1（`<link>` 方案） |
| R-4 | 主题三态切换 | 设置里 auto/day/night 各点一遍，窗口色板正确；重点查 `.sp-night .sp-xxx` 后代选择器（wrapper 主题类同步） | 1 |
| R-5 | 字号缩放实时生效 | 设置 −/＋ 改 `--sp-scale`，窗口字号即时变 | 1 |
| R-6 | 拖拽/缩放/移动端布局 | 桌面拖拽移动、右下角 resize、移动端近全屏 | 1 |
| R-7 | 七模块渲染与交互 | 点/线/面/间/棱/坐标/历 逐个切换视图并操作（生成、编辑、删除、锁定） | 2 |
| R-8 | 面讨论/creative-chat | 发消息、流式、应用此面、编辑/删除消息、清空；滚动到底部 | 2-下半 |
| R-9 | 坐标收藏全流程 | 收藏楼、打开收藏面板、角色/聊天/条目三级、标签管理、全屏浏览（shadow 套 shadow）、导出 | 2-下半 |
| R-10 | 历/暗账/历法管理 | 历面板渲染、纪念日增删改、锁定；暗账编辑器（事由/类型/现状/牵扯/标签/周期）；历法模板管理/绑定/冲突 | 2-下半 |
| R-11 | grep 兜底（`$('#sp-…')` 无残留） | `grep -nE "\\\$\(['\`]#sp-" index.js` 结果应只剩排除清单项（toast/confirm/store-conflict 在批次4 迁入后也应清零） | 2 |
| R-12 | 点外关闭/Esc | 模块介绍 pop、action 菜单、TA 抽屉：点窗外关、Esc 关 | 3 |
| R-13 | 楼内块样式与改造前完全一致 | 聊天流里历/点/线/标注池/召回条样式截图对比 | 全程 |
| R-14 | 弹窗族 | 见批次4 验收 | 4 |
| R-15 | console 无报错 | 全流程走一遍，DevTools console 0 error | 全程 |
| R-16 | 文档更新 | 本文件状态节更新；style.css 头部补"同时被 light DOM 与 shadow 加载"注释 | 5 |

---

## 三、提交纪律备忘

- 同一 master 分支**顺序提交**；每次编辑前 `git status` 确认工作区干净（对方已提交）
- commit 信息带批次前缀（如 `[batch2-下半-区域X]`）
- 单批出问题单独 revert；全部完成、用户验证后再 bump 版本/发版
