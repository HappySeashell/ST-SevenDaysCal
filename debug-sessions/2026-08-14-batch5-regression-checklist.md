# 批次5 全量回归执行清单（批次1+2+3+4 合并后）

**项目**: ST-SevenDaysCal（构画）
**负责人**: 回归质检
**前置**: 批次1（宿主迁shadow）✓ 8e60747 恢复、批次2-上半/下半（选择器全量替换）、批次3（事件委托4处）、批次4（弹窗族）✓ c33e528 全部提交后执行本清单
**基线**: HEAD 8e60747（本清单所有 grep 的 expect 值实测自该提交）
**约束**: 🚫禁止浏览器自动化/Chrome MCP；验证 = node --check + grep 静态复核 + 代码审查；运行期由用户在 ST 实测（本清单 S2 即为给用户的实测步骤）

---

## S0 预检（执行批次5 前）

```bash
cd "D:/1/SillyTavern/public/scripts/extensions/third-party/ST-SevenDaysCal"
git status --short          # 必须干净（仅 .pi/、debug-sessions/ 等未跟踪文件）
git log --oneline -8        # 确认 批次1恢复+批次2上下+批次3+批次4 均在 master 顺序落地
node --check index.js && node --check modal.js && echo OK
```
- [ ] 以上全过才继续；任一不过：停止，先找对应负责人。

---

## S1 grep 残留复核（静态验收，命令现成、expect 已标注）

> 注：全部在仓库根执行；`grep -nE` 输出应逐行人工过目，非只看计数。
> 允许清单 = 排查后确认属 light DOM 保留项，**不是**漏改。

| # | 命令 | expect（8e60747 实测 → 终态） | 允许清单（保留项） |
|---|---|---|---|
| G-1 | `grep -nE "\\\$\(['\`]#sp-" index.js` | 293 处 → **0** | `sp-toast-wrap`（批次4 决议留 light）；`$(`#${MODAL_ID}` 宿主本身 |
| G-2 | `grep -n "\$('\.sp-" index.js` | 16 处（窗口内）→ **0** | light 类：`.sp-inline-box` 家族、`.sp-alm-strip*`/`.sp-sch-strip*`（楼内条） |
| G-3 | `grep -n "getElementById" index.js` | 18 → **13** | FAB_ID×8、MODAL_ID×1（宿主）、`sp_open_wand`×2、`sp_wand_container`×1、`extensionsMenu`×1（ST/魔杖所有） |
| G-4 | `grep -n "appendTo" index.js` | 5（3 已 `$in`，7743/7960 未转）→ **0** | 无 |
| G-5 | `grep -n '\$(`#\${MODAL_ID}' index.js` | 20 → **0** | 无（root 前缀查询全部必须消亡） |
| G-6 | `grep -n "document.querySelector" index.js` | 仅 `#chat .sp-*` 楼内块（1291/1458/1587/1900/1901）→ 不变 | 楼内块全保留；**不得出现** `#${MODAL_ID}` 前缀 |
| G-7 | `grep -nE "spIntro|spActionMenu|tadrawer" index.js` | 4097/5035/5038/5628/5638 原样 → **0** | 批次3 四站点（click.spIntro/click.spActionMenu/keydown.spActionMenu/click.tadrawer）改后不得再有 `$(document).on` 形式（改 shadow 内绑定或 composedPath） |
| G-8 | `grep -n '\$(document)\.on' index.js` | 4 → **4 不变** | 只允许：`click.spalmstrip`、`click.spschstrip`（楼内块）、`mousemove.spdrag/spresize`（闭包拖拽，坑#4） |
| G-9 | `grep -n "insertAdjacentHTML" index.js` | 3 → **3 不变** | 3294（FAB 魔杖）、3340（injectFab）、12788（toast）——全 light DOM |
| G-10 | `grep -c "\\\$in(" index.js` | 105 → 只增不减 | —（$in 使用量应随替换增长；终态计数 ≈ 386-排除项） |
| G-11 | `grep -n "document.documentElement.appendChild" index.js` | 0（批次4 已清）→ **0** | 确认无弹窗回退 light |

**G-1 补充核对**：终态若剩 `$('#sp-`，逐行确认属于 sp-toast-wrap；其余一律报问题。
**G-7 补充核对**：批次3 改法二选一（shadow 内绑定 / composedPath 判断），验收时确认 `e.composedPath().includes(host)` 模式存在（若选方案B）。

---

## S2 全量功能回归（用户 ST 实测路径；按此清单逐项勾）

> 浏览器操作由用户在 ST 里执行。每项给出**具体操作路径**，用户回报 pass/fail + 截图。

| # | 项 | 用户操作路径 | 关注点 | 关联 |
|---|---|---|---|---|
| R-1 | 窗口开关/FAB | 点 FAB 开窗 → 关窗 → 再开；设置面板里 fab 开关切换，FAB 消失/重现 | 宿主 show/hide 正常 | 1 |
| R-2 | 无 ST 样式渗透 | 窗口内对比改造前：button/input/textarea/滚动条/text-shadow/`::selection` | 更干净或一致 | 1 |
| R-3 | FA 图标全显 | 打开设置面板、空态、各按钮、弹窗 | 无方框/缺图标（shadow `<link>` 生效） | 1 |
| R-4 | 主题三态 | 设置里 auto/day/night 各点一遍，窗口色板 | **重点** `.sp-night .sp-xxx` 后代选择器（wrapper 主题类同步，坑#6） | 1 |
| R-5 | 字号缩放 | 设置 −/＋ 改 `--sp-scale`，窗口字号即时变 | `:root` 变量穿透（坑#8） | 1 |
| R-6 | 拖拽/缩放/移动端 | 桌面拖拽移动、右下角 resize、移动端近全屏 | resize 走 `inEl('.sp-sheet')`（坑#9） | 1 |
| R-7 | 七模块渲染交互 | 侧栏逐一切：历(schedule)/点(outline)/线(lines)/面(space)/棱(theater)/坐标(anchor)/设置(user)，各做一次生成/编辑/删除/锁定 | 无静默失效交互（坑#1） | 2 |
| R-8 | 面讨论/creative-chat | 发消息、流式回复、应用此面、编辑/删除消息、清空、滚动到底部 | appendTo 区（7515/7604/7634） | 2-下半 |
| R-9 | 坐标收藏全流程 | 收藏楼、收藏面板、角色/聊天/条目三级、标签管理、**全屏浏览**、导出 | shadow 套 shadow（坑#4，`inEl`） | 2-下半 |
| R-10 | 历/暗账/历法管理 | 历面板渲染、纪念日增删改锁定；暗账编辑器全字段；历法模板管理/绑定/冲突 | 模块内全部交互 | 2-下半 |
| R-11 | 点/线/间/棱/设置/拖拽区 | 大纲生成/注入、线生成/间隔、剧场模板管理、设置全开关、所有弹层 | 改造主力区域模块 | 2-上半 |
| R-12 | 点外关闭/Esc | 模块介绍 pop、action 菜单、TA 抽屉：点窗外关、Esc 关 | 事件 retarget（坑#2，批次3） | 3 |
| R-13 | 楼内块不变 | 聊天流里历/点/线/标注池/召回条与改造前**完全一致**（截图对比） | 绝不迁 shadow（坑#10） | 全程 |
| R-14 | 弹窗族 | confirm：显示/层级/点外关/Esc/**换 chat 自动关**；冲突弹窗：面板未开时触发（云端/本机/暂不三选一）→ 先开窗再显示；决策弹窗(customDialog)：开关/选择；toast：显示/点击/错误态 | 批次4 全项 | 4 |
| R-15 | console | 全流程走一遍，DevTools console 0 error | 0 error | 全程 |
| R-16 | 文档收尾 | —（S4 执行人负责） | 状态节 + style.css 头注释 | 5 |

---

## S3 坑位核对表（#1-#11 → 对应实现证据/回归项）

| 坑 | 内容 | 实现证据（代码审查） | 回归项 |
|---|---|---|---|
| #1 | jQuery 不穿透 shadow，漏一处=静默失效 | `$in`/`inEl` 全量替换到位；S1 全零 | R-7..R-11 |
| #2 | 事件 retarget 点外关闭反转 | 批次3 四站点改 shadow 内绑定或 composedPath（G-7） | R-12 |
| #3 | FA 图标全灭 | `root.innerHTML` 内 `<link>`（EXT_BASE style.css + ST_BASE fontawesome）存在 | R-3 |
| #4 | `getElementById('sp-anchor-full-host')` 失效 | 已改 `inEl`（坐标快照内层 shadow 合法） | R-9 |
| #5 | `body.appendChild(probe)` 主题探测 | 探针留 light DOM；确认读 `:root` 级变量（穿透） | R-4 |
| #6 | `.sp-root` 前缀 13 处 + wrapper 主题类 | wrapper 带 `sp-root sp-${theme}`；applyTheme 同步 wrapper 类（`wrapper.classList` 存在） | R-4 |
| #7 | `@import` 在 shadow `<link>` 内 | style.css 顶部 Roboto Mono @import 保留即可 | R-3（字体） |
| #8 | `:root` `--sp-scale` setProperty | 穿透继承零改动 | R-5 |
| #9 | 移动端 resize `querySelector(#MODAL_ID .sp-sheet)` | 已换 `inEl('.sp-sheet')`（injectFab + onResizeStart） | R-6 |
| #10 | 楼内块绝不迁 | G-6/G-8 允许清单维持 light；`#chat .sp-*` 查询原样 | R-13 |
| #11 | style.css 加载两份 | 浏览器缓存无感；**禁止**优化删全局份 | R-16 注释 |

---

## S4 批次5 执行顺序（派发后按此跑）

1. **S0 预检** → 全过。
2. **S1 grep 全套**（G-1..G-11）→ 输出逐行过目；expect 不符 → 定位责任批次 → 回报 leader，不自行改他人区域。
3. **S3 代码审查**：坑位表逐项核对实现证据（只读，不碰 index.js）。
4. **S2 整理给用户**：把 R-1..R-16 操作路径作为实测清单发出，收 pass/fail。
5. **文档收尾（R-16）**：
   - `2026-08-14-shadow-dom-isolation.md` 状态节更新（各批次 commit 哈希 + 验证状态）；
   - `style.css` 头部补注释："本文件同时被 light DOM（楼内块）与 shadow（窗口）加载"；
   - 本清单勾选归档。
6. **commit**：`[batch5]` 前缀；顺序提交；commit 前 `git status` 确认干净。
7. 全部通过 + 用户实测无回归 → 通知 leader 可 bump 版本（用户验证后再发版，项目惯例）。

---

## 附：实测数据基准（8e60747，供 S1 对照）

| 指标 | 当前值 | 终态 |
|---|---|---|
| `$('#sp-`（单引号） | 293 | 0（仅 toast-wrap×3） |
| `$('.sp-`（真类查询） | 16 | 0（窗口内） |
| getElementById | 18 | 12 |
| appendTo | 5 | 0 |
| `$(`#${MODAL_ID} 根前缀 | 20 | 0 |
| `$in(` | 105 | 增长至 ≈全量 |
| inEl( | 23 | 增长 |
| 批次3 四站点 | 原样 | 0（改后形式） |
