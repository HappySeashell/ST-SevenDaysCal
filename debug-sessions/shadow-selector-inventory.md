# Shadow DOM 隔离改造 — 选择器归档清单（批次2 实施底稿 / 回归依据）

**项目**: ST-SevenDaysCal（构画）
**基线**: 提交 `28d48b1`（改造前原始状态，行号均以此为准）
**生成**: 回归质检（2026-08-14，与批次1/2-上半并行）
**用途**: 批次2-下半实施底稿（已完成，见提交 `960fdb4`）；批次4 弹窗族迁移参考；批次5 回归 grep 复核对照。

---

## 一、核实结果（与方案文档第六节统计的差异）

在 `28d48b1` 上 grep 复核（`grep -oE` 计数，非行数）：

| 类别 | 方案文档 | 实测 | 差异说明 |
|---|---|---|---|
| `$('#sp-…')` 调用 | 386 处 | **373 处**（364 行；其中 3 处为模板字符串 `$(`#sp-…`、9 行为一行双处） | 少 13；文档口径偏松（可能含注释/拼接串） |
| `$('#sp-…')` 唯一 id | 140 个 | **144 个** | 多 4 |
| `$('.sp-…')` 全局类查询 | 16 处 | **34 处**（其中 `$('.sp-view-btn[data-view=…]')` 3 处、`$('.sp-action-menu-open')` 1 处、`$('.sp-anchor-fullscreen')` 1 处等属窗口内需转） | 文档只统计了部分；已按「窗口内必转 / 元素内遍历不动」原则处理 |
| `getElementById('sp-…')` | 28 处 / 窗口内 10 | **28 处调用 / 窗口内 16 处（9 个唯一 id）** | 文档把 theater-result 等多处调用按 id 去重；实测按调用点计 |
| `appendTo('#sp-…')` | 5 处 | **5 处** ✓ | 一致（`#sp-chat-msgs`×3、`#sp-space-msgs`×2） |
| `$(`#${MODAL_ID} …`)` 带根前缀 | 32 处 | 45 行含 MODAL_ID（含宿主自身 is(':visible') 判断） | 宿主自身查询**不转**（host 留 light DOM）；批次1 已把绑定段改为 `$in('.sp-…')` |
| 其他文件（anchor/ledger/memory/modal/snapshot/state/store/theater.js） | — | `$('#sp-…')` 全部为 0 | 全部集中在 index.js ✓ |

> 结论：文档总量 386 与实测 373 的差值是口径差异（文档早于本清单生成、正则更松），不影响分批范围划分——每批按「区域全扫 + 排除清单」落地，最后批次5 用 grep 兜底（见回归清单 R-11）。

---

## 二、按模块归档清单（行号 = 28d48b1）

图例：
- ✅ = 批次2-下半已转（提交 `960fdb4`，回归质检区域）
- ⏳ = 改造主力区域（批次1/2-上半，工作区进行中）
- 🚫 = 排除（保持 light DOM / 宿主 / ST 所有）
- 📋 = 批次4 随弹窗迁入时处理（回归质检任务）

### ① 面·讨论 creative-chat（7030-7610，✅ 已全转）
| 行号 | 查询 | 转法 |
|---|---|---|
| 7033 | `$('#sp-chat-input')` | `$in` |
| 7037 | `$('#sp-chat-msgs')` | `$in` |
| 7475 | `$wrap.appendTo('#sp-chat-msgs')` | `appendTo($in(…))` |
| 7476 | `getElementById('sp-chat-msgs')` | `inEl('#sp-chat-msgs')` |
| 7564 | `appendTo('#sp-chat-msgs')` | `appendTo($in(…))` |
| 7565 | `getElementById('sp-chat-msgs')` | `inEl` |
| 7594 | `appendTo('#sp-chat-msgs')` | `appendTo($in(…))` |
| 7595 | `getElementById('sp-chat-msgs')` | `inEl` |
| 7074 | `$('#send_textarea')` | 🚫 ST 聊天输入框（light DOM） |

### ② 面 outline（8196-8405，✅ 已全转）
| 行号 | 查询 | 转法 |
|---|---|---|
| 8200 | `$('#sp-outline-beats')`（setOutlineBody） | `$in` |
| 8247 | `$('.sp-view-btn[data-view="outline"]')` | `$in` |
| 8262 | `$(`#${MODAL_ID}`).is(':visible')` | 🚫 宿主 |

### ③ 坐标 anchor（8530-8862，✅ 已全转）
| 行号 | 查询 | 转法 |
|---|---|---|
| 8530 | `$('#sp-anchor-body')`（setAnchorBody） | `$in` |
| 8813 | `getElementById('sp-anchor-full-host')` | `inEl('#sp-anchor-full-host')`（shadow 套 shadow） |
| 8845 | `querySelector('#sp-anchor-body .sp-anchor-scroll')` | `inEl(…)` |
| 8855 | `querySelector('#sp-anchor-body .sp-anchor-scroll.sp-anchor-fullscreen')` | `inEl(…)` |
| 8856 | `$('.sp-anchor-fullscreen')` | `$in` |

### ④ storage（8862-9034，✅ 已全转）
| 行号 | 查询 | 转法 |
|---|---|---|
| 8862 | `$('#sp-lines-list')`（setLinesBody） | `$in` |
| 8894 / 8978 | `$('#sp-storage-body')` | `$in` |
| 8951 / 8958 | `$('#sp-storage-anchor-rows')` | `$in` |
| 8970 | `$('#sp-space-msgs').empty()`（间·清空联动，位于本区） | `$in` |
| 8976 | `$('#sp-storage-refresh')` | `$in` |
| 9012 | `querySelectorAll('#chat .mes .sp-anchor-btn')` | 🚫 聊天流楼内（light DOM） |

### ⑤ 线 lines + dashed（9030-9645，✅ 已全转）
| 行号 | 查询 | 转法 |
|---|---|---|
| 9254 | `$('#sp-dashed-section')` | `$in` |
| 9359 | `$('.sp-view-btn[data-view="lines"]')` | `$in` |
| 9375 | `$(`#${MODAL_ID}`).is(':visible')` | 🚫 宿主 |

### ⑥ 历 almanac + ledger + 历法管理（9695-11530，✅ 已全转）
| 行号 | 查询 | 转法 |
|---|---|---|
| 10148 | `$('.sp-action-menu-open')`（closeActionMenus） | `$in` |
| 10264 / 10881 | `$('#sp-almanac-wrap')` | `$in` |
| 10273 / 11452 / 11453 | `$('#sp-alm-f-name')` | `$in` |
| 10278 / 10462 / 10463 | `$('#sp-led-f-gist')` | `$in` |
| 10465 | `$('#sp-led-f-type')` ×2 | `$in` |
| 10469-10471 | `$('#sp-led-f-now'/'sp-led-f-who'/'sp-led-f-tags')` | `$in` |
| 10475 | `$('#sp-led-f-cyc')` | `$in` |
| 10700 | `$('#sp-alm-manager-era')` | `$in` |
| 10701 | `$('#sp-almanac-wrap .sp-alm-manager-month-row')` | `$in` |
| 11181 | `$('.sp-view-btn[data-view="almanac"]')` | `$in` |
| 11434 | `$('#sp-alm-f-wdhint')` | `$in` |
| 11437-11439 | `$('#sp-alm-f-month'/'sp-alm-f-day'/'sp-alm-f-days')` | `$in` |
| 11458-11463 | `$('#sp-alm-f-type'/'month'/'day'/'days'/'disp'/'note')` | `$in` |
| 11487 | `$(`#sp-almanac-wrap .sp-alm-item[data-id="${id}"]`)` | `$in`（模板串） |
| 11505 | `$(`#sp-almanac-wrap .sp-alm-cell[data-day="${md.day}"]`)` | `$in`（模板串） |
| 11509 | `$('#sp-almanac-wrap .sp-alm-cell-linked')` | `$in` |

### ⏳ 改造主力区域（不重复列出全部，仅登记跨区边界点，供回归兜底）
- injectModal 3410-5456：`sp-body`/`sp-sub-toggle`/`sp-content-title`/`sp-gen-now`/`sp-ta-drawer`/`sp-ta-trigger`/`sp-char-name-*`/`sp-module-intro-pop`/`sp-chat-*`(4082-4120 输入区绑定)/`sp-alm-today-*`(4744-4752)/`sp-almanac-wrap` 后代联动(4783-4798、4880-4885)/`sp-*-wrap` 显隐(5052-5201)/历线面设置开关(5261-5399)/`sp-cfg-*`/`sp-model-list-*`/`sp-resize-handle`/`sp-outline-divider`/`sp-outline-chat`(5419-5420)
- 间 7130-7950：`sp-space-wrap`/`sp-space-msgs`(7655、7703-7704、7920-7921)/`sp-space-input`/`sp-space-persona`/`sp-space-send`/`sp-space-clear`
- 棱 theater 7951-8196：`sp-theater-wrap`/`sp-theater-input`/`sp-theater-body`/`sp-theater-style`/`sp-theater-title`/`sp-theater-tpl-*`/`sp-theater-result`(8052)
- 设置 11527-12465：`sp-mem-*`/`sp-wi-*`/`sp-preset-*`/`sp-util-preset-*`/`sp-key-toggle`/`sp-fetch-models`/`sp-uiscale-*`/`sp-scale-row`/`sp-settings-overlay`/`sp-custom-prompt`/`sp-plugin-enabled`/`sp-inject-enabled`/`sp-inline-render-*`/`sp-recall-inline-enabled`/`sp-schedule-inline-enabled`/`sp-schedule-autodetect`/`sp-anchor-inline-btn`/`sp-ledger-inject`/`sp-ledger-inline-enabled`/`sp-almanac-autodetect`/`sp-almanac-inline-enabled`/`sp-almanac-judge-interval`/`sp-lines-*`(设置行)/`sp-dashed-enabled`/`sp-outline-*`(设置行)/`sp-storyclock-*`/`sp-alm-f-*`(若设置区有)
- 主题/拖拽 12465-12732：`.sp-sheet`/`sp-theme-toggle-btn` 等
- 点 + toast 12732-13115：`sp-toast-wrap`(🚫)/`sp-gen-*` 等

### 📋 批次4 弹窗族（回归质检任务，批次2 **不替换**）
| 行号 | 查询 | 说明 |
|---|---|---|
| 5743 / 5852 | `$('#sp-confirm…')` | spConfirm 内，挂 documentElement；批次4 迁 shadow 时改 `$in`/`_spShadow.appendChild` |
| 5903 | `$('#sp-store-conflict')` | showStoreConflictDialog 同上 |
| 5852 附近 | `document.documentElement.appendChild($ov[0])` | 改 `_spShadow.appendChild` |
| modal.js | `$(`#${OVERLAY_ID}`)`、`mount.appendChild` | customDialog（`#sp-addon-dialog`），mount 参数改 shadow wrapper |
| 12736 附近 | `$('#sp-toast-wrap')` | 🚫 toast 留 light DOM（批次4 决议，见方案文档） |

### 🚫 全量排除清单（永不转）
- `$(`#${MODAL_ID}`)` 宿主自身（is(':visible')/show/hide/animate）— host 留 light DOM
- `$(`#${FAB_ID} …`）`、`getElementById(FAB_ID)` ×8 — FAB 留 light DOM
- `getElementById('extensionsMenu')`/`sp_open_wand` ×3 — ST/魔杖菜单
- `$('#sp-toast-wrap')` — toast 留 light DOM（有 `sp-toast` 类 + text-shadow 清零，污染面最小；zmer-toast-theme-loader 接管分支，动了易踩第三方）
- `#chat .mes .sp-anchor-btn`、`.sp-inline-box`、`#send_textarea` 等聊天流楼内查询
- 元素内遍历（`$(this)`/`$(e.target)`/`$row.find('.sp-…')`）— 不跨 shadow 边界，天然可用

---

## 三、批次2-下半落地记录（提交 `960fdb4`）

- 共 **54 行**替换（37 处 `$('#sp-` + 3 处 `appendTo` + 4 处 `getElementById→inEl` + 1 处 `querySelector→inEl` + 4 处 `$('.sp-…')→$in` + 5 处 `$(`#sp-…`)` 模板/后代查询等）
- 依赖批次1 的 `$in()`/`inEl()`（契约见方案文档 1b，与改造主力实现一致：`_spShadow?.querySelector` + jQuery 包装 / 原生）
- 行号以上表为实施底稿，逐处人工复核过；`node --check` 通过

## 四、批次2-上半落地记录（改造主力下线后由回归质检接手，提交见下）

> 上文 ⏳ 区域全部由回归质检按本清单模块边界完成；行号以 28d48b1 为基准的旧表不再逐行更新，落地即归档。

| 提交 | 模块 | 内容 |
|---|---|---|
| `33217ce` | 主界面骨架 | injectModal 绑定区 186 处（含 view-btn 委托改绑 `$in('.sp-sidebar')`、notify-mode 根前缀→`$in`、`#chat` 混合委托双绑拆分 ×6） |
| `b0d0d1d` | 间 | `sp-space-msgs`×3、`appendTo($in(...))`×2 |
| `4ad8049` | 棱 | theater 7 处（setTheaterBody/模板管理/折叠钮/fullscreen/result） |
| `eece6e3` | 设置 | 119 处（mem/wi/preset/cfg/model-list/storyclock/uiscale/overlay） |
| `1bfb303` | 骨架-补丁 | 4398 背引号混合委托（`$(`#sp-body, …, #chat`)`）漏网修复 |

## 五、批次3 落地记录（提交 `d960355`）

- `click.spIntro`/`click.spActionMenu`/`click.tadrawer`：`$(e.target).closest(...)` → `e.originalEvent.composedPath().some(el => el.matches(...))`（shadow 内 target 被重定向为 host，closest 失效）
- `keydown.spActionMenu`：composed 事件照常冒泡、无 target 判断 → 零改动（仅注释说明）
