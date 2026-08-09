// anchor.js — 坐标（收藏楼层）for ST-SevenDaysCal
//
// 坐标 = 构画几何体系第六元素：点(日程)/线(伏笔)/面(大纲)/间(局外聊天)/棱(小剧场)/坐标(收藏楼层)。
// 定位「书签 / 收藏」——把聊天楼层的**渲染后 HTML 快照**存下来，原模原样、所见即所得：
//   点楼层名字旁的坐标 → 抓 live .mes_text.innerHTML（含正则/脚本现场生成的状态栏）
//   → 净化（砍 <script>/on*，保留 <style>+inline style）→ 存服务器
//   → 面板第六视图三层抽屉浏览（聊天→缩略→全文）→ 全文用 Shadow DOM 渲染（隔离状态栏样式）。
//
// 存储：SillyTavern 核心 /api/files（用户 user/files 目录，落服务器磁盘）——全局一份、跨设备、
//   跟着 ST 账号走，清浏览器缓存也不丢；不进 settings.json（撑大拖慢前端）、不进世界书。
//   形态「每条一个文件」：
//     sp-anchor-{id}.json    —— 单条完整快照（含大 HTML），收藏/删除只碰单文件，无全量覆写。
//     sp-anchor-index.json   —— 轻量索引（全部条目元数据，不含 HTML）；/api/files 无列目录接口，
//                                靠它做列表/分桶/用量，只有点开全文才按需拉单条。
//
// 关键：upload 返回的 path 恒为 `user/files/<name>`（后端 USER_DIRECTORY_TEMPLATE.files='user/files'、
//   root=''，path=clientRelativePath(root, files/name)），与用户无关、确定可推导——
//   故冷启动直接 GET 推导路径即可，无需列目录、无需上传探针。
//
// 与棱的关键差别：棱剥 <style>（强制 inline），坐标**保留 <style>**（状态栏靠它），
// 靠 Shadow DOM 做样式隔离而非剥离。净化只为安全（去脚本/事件），不动排版。

import { getContext } from '../../../extensions.js';

const FILES_DIR       = 'user/files';           // 后端固定；upload 返回的 path 前缀
const INDEX_NAME      = 'sp-anchor-index.json';
const FILE_PREFIX     = 'sp-anchor-';           // 单条：sp-anchor-{id}.json
const SIZE_WARN_BYTES = 8 * 1024 * 1024;        // 估算超此值时提示清理（快照带样式偏大，给足余量）

// ─── 依赖注入（initAnchor）─────────────────────────────────────────────────────
let _getSettings = () => ({});

// ═══════════════════════════════════════════════════════════════════════════
//  /api/files 封装
// ═══════════════════════════════════════════════════════════════════════════
//
// upload: POST /api/files/upload {name, data(base64)} → {path}；write-file-atomic 同名覆盖。
// 读:     GET `user/files/<name>` → 文本（404 = 不存在）。delete: POST /api/files/delete {path}。
// 文件名只允许 [a-zA-Z0-9_\-.]（后端 validateAssetFileName）。

function headers() {
    const h = getContext?.()?.getRequestHeaders?.();
    return h || { 'Content-Type': 'application/json' };
}

// path 恒定可推导，无需缓存 upload 的返回值。
function pathOf(name) { return `${FILES_DIR}/${name}`; }

function fileNameOf(id) {
    return `${FILE_PREFIX}${String(id).replace(/[^a-zA-Z0-9_\-.]/g, '')}.json`;
}

// UTF-8 安全 base64（btoa 只吃 latin1，中文快照会炸——先 TextEncoder 再分块转）。
function toBase64(str) {
    const utf8 = new TextEncoder().encode(String(str ?? ''));
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < utf8.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, utf8.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}

async function uploadJson(name, obj) {
    const res = await fetch('/api/files/upload', {
        method : 'POST',
        headers: headers(),
        body   : JSON.stringify({ name, data: toBase64(JSON.stringify(obj)) }),
    });
    if (!res.ok) throw new Error(`upload ${name}: ${res.status} ${await res.text().catch(() => '')}`);
    const out = await res.json();
    return out.path;
}

async function readJson(name) {
    const res = await fetch(pathOf(name), { method: 'GET', cache: 'no-cache', headers: headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`read ${name}: ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return null; }
}

async function deleteFile(name) {
    const res = await fetch('/api/files/delete', {
        method : 'POST',
        headers: headers(),
        body   : JSON.stringify({ path: pathOf(name) }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`delete ${name}: ${res.status}`);
}
// ═══════════════════════════════════════════════════════════════════════════
//  索引（sp-anchor-index.json）：{ version, items:[ meta... ], tags:[ {id,name,color}... ] }
//  meta = { id, chatId, chatIdHash, chatName, charName, messageId, floorIndex, textPreview, ts, bytes, tags }
//  —— 不含 html；html 在各自 sp-anchor-{id}.json 里。bytes = 该条完整快照的估算字节。
//  tags = 该条打的标签 id 数组（注册表在 idx.tags，item 只存 id，解析时按 id 查注册表）。
// ═══════════════════════════════════════════════════════════════════════════

let _indexCache   = null;    // 内存里的索引 { version, items:[] }
let _indexPromise = null;    // 冷启动读索引的 in-flight promise（防并发重复拉）

async function loadIndex(force = false) {
    if (_indexCache && !force) return _indexCache;
    if (_indexPromise && !force) return _indexPromise;
    _indexPromise = (async () => {
        let idx = await readJson(INDEX_NAME).catch(() => null);
        if (!idx || typeof idx !== 'object' || !Array.isArray(idx.items)) {
            idx = { version: 1, items: [] };
        }
        if (!Array.isArray(idx.tags)) idx.tags = [];   // 标签注册表：老索引无此字段 → 归一化为空
        _indexCache = idx;
        return idx;
    })();
    try { return await _indexPromise; }
    finally { _indexPromise = null; }
}

async function saveIndex() {
    if (!_indexCache) return;
    await uploadJson(INDEX_NAME, _indexCache);
}

// 单条完整记录估算字节（UTF-16 口径，跟 store/theater formatBytes 一致）。html 是大头。
function itemBytes(it) {
    let n = 0;
    for (const k in it) {
        const v = it[k];
        n += (k.length + String(v == null ? '' : v).length) * 2;
    }
    return n;
}

// 完整 item → 索引 meta（剥掉 html，留元数据 + bytes 供列表/用量）。
function toMeta(item) {
    return {
        id        : item.id,
        chatId    : item.chatId ?? null,
        chatIdHash: item.chatIdHash ?? null,
        chatName  : item.chatName || '',
        charName  : item.charName || '',
        messageId : item.messageId ?? null,
        floorIndex: item.floorIndex ?? null,
        textPreview: item.textPreview || '',
        ts        : item.ts || 0,
        bytes     : itemBytes(item),
        tags      : Array.isArray(item.tags) ? item.tags : [],
    };
}

// ═══════════════════════════════════════════════════════════════════════════
//  CRUD（对外主 API，签名与旧 IndexedDB 版一致，index.js 无需改）
// ═══════════════════════════════════════════════════════════════════════════

export async function addItem(item) {
    // 单条落盘
    await uploadJson(fileNameOf(item.id), item);
    // 更新索引（同 id 覆盖）
    const idx = await loadIndex();
    const meta = toMeta(item);
    const i = idx.items.findIndex(m => m.id === item.id);
    if (i >= 0) idx.items[i] = meta; else idx.items.push(meta);
    await saveIndex();
    return item;
}

export async function getItem(id) {
    if (!id) return null;
    return readJson(fileNameOf(id)).catch(() => null);
}

// 索引只有 meta；getAllItems 拼「meta + 空 html」返回，够列表/分桶/用量用。
// 需要 html 的地方（全文视图）走 getItem 按需拉单条。
export async function getAllItems() {
    const idx = await loadIndex();
    return idx.items.map(m => ({ ...m, html: '' }));
}

export async function deleteItem(id) {
    if (!id) return;
    await deleteFile(fileNameOf(id)).catch(() => {});   // 单条删失败也继续清索引，避免残留
    const idx = await loadIndex();
    const before = idx.items.length;
    idx.items = idx.items.filter(m => m.id !== id);
    if (idx.items.length !== before) await saveIndex();
}

export async function countItems() {
    const idx = await loadIndex();
    return idx.items.length;
}

// ═══════════════════════════════════════════════════════════════════════════
//  标签（全局注册表 idx.tags = [{ id, name, color }]）
// ═══════════════════════════════════════════════════════════════════════════
//
// 标签全局共用：一次定义，任意角色/聊天可打可筛。注册表挂在索引文件上（idx.tags），
// item 只存标签 id 数组（item.tags）——renameTag/recolorTag 只改注册表、不重写 item；
// 唯 deleteTag 需扫所有 item 剥掉该 id（照 renameChatId 的「改索引 + 逐条刷单文件」范式）。
// color 存的是色板 key（rose/amber/…），实际颜色由 style.css 按 [data-color] 定义（日/夜自洽）。

export async function getTags() {
    const idx = await loadIndex();
    return Array.isArray(idx.tags) ? idx.tags : [];
}

// 新建标签（按名去重：已存在则原样返回，不重复建）。返回该 tag。
export async function addTag(name, color) {
    const nm = String(name || '').trim();
    if (!nm) return null;
    const idx = await loadIndex();
    if (!Array.isArray(idx.tags)) idx.tags = [];
    const exist = idx.tags.find(t => t.name === nm);
    if (exist) return exist;
    const tag = {
        id   : (crypto?.randomUUID?.() || `t-${Date.now()}-${Math.floor(performance.now())}`),
        name : nm,
        color: String(color || ''),
    };
    idx.tags.push(tag);
    await saveIndex();
    return tag;
}

// 改名 / 改色：注册表单点改，item 不动（item 存的是 id）。
export async function renameTag(id, name) {
    const nm = String(name || '').trim();
    if (!id || !nm) return;
    const idx = await loadIndex();
    const t = (idx.tags || []).find(x => x.id === id);
    if (t && t.name !== nm) { t.name = nm; await saveIndex(); }
}

export async function recolorTag(id, color) {
    if (!id) return;
    const idx = await loadIndex();
    const t = (idx.tags || []).find(x => x.id === id);
    if (t) { t.color = String(color || ''); await saveIndex(); }
}

// 删标签：从注册表删；再扫所有 item.tags 去掉该 id（索引 meta 一次性改 + 逐条刷单文件）。
// 返回受影响条数。属全局破坏性操作，调用侧应先确认。
export async function deleteTag(id) {
    if (!id) return 0;
    const idx = await loadIndex();
    if (Array.isArray(idx.tags)) idx.tags = idx.tags.filter(t => t.id !== id);
    const affected = (idx.items || []).filter(m => Array.isArray(m.tags) && m.tags.includes(id));
    for (const m of affected) m.tags = m.tags.filter(x => x !== id);
    await saveIndex();
    for (const m of affected) {
        try {
            const item = await getItem(m.id);
            if (!item) continue;
            item.tags = Array.isArray(item.tags) ? item.tags.filter(x => x !== id) : [];
            await uploadJson(fileNameOf(item.id), item);
        } catch (err) { console.warn('[SP anchor] 删标签同步单条失败:', m.id, err); }
    }
    return affected.length;
}

// 给某条收藏设标签 id 数组（addItem 重传单文件 + 经 toMeta 刷索引 meta，含新 tags）。
export async function setItemTags(id, tagIds) {
    const it = await getItem(id);
    if (!it) return;
    it.tags = Array.isArray(tagIds) ? [...tagIds] : [];
    await addItem(it);
}

// 找某楼的全部收藏 id（同楼可能有多条，取消收藏时要全删）。messageId 与 floorIndex 同值，匹配其一即可。
export async function findItemIdsByFloor(chatId, floorIndex) {
    const idx = await loadIndex();
    const cid = String(chatId);
    const fi  = +floorIndex;
    if (!Number.isFinite(fi)) return [];
    return (idx.items || [])
        .filter(m => String(m.chatId) === cid && (Number(m.messageId) === fi || Number(m.floorIndex) === fi))
        .map(m => m.id);
}

// 聊天改名（酒馆改 chat 文件名 = chatId 变）后，把索引 + 单条文件里 chatId===oldId 的记录
// 迁到 newId，并把 chatName 同步成新名（酒馆聊天名即文件名）。由 index.js 挂 CHAT_RENAMED 调用。
// 索引一次性改完存一次；单条文件逐个 getItem→改→addItem（改名不频繁，收藏量通常有限，可接受）。
// newName 未给则用 newId 当显示名。返回迁移条数。
export async function renameChatId(oldId, newId, newName = '', chatIdHash = null) {
    if (oldId == null || newId == null) return 0;
    const oId = String(oldId), nId = String(newId);
    if (oId === nId) return 0;
    const idx = await loadIndex();
    const hit = idx.items.filter(m => String(m.chatId) === oId);
    if (!hit.length) return 0;
    const nName = String(newName || nId);
    // chat_id_hash 改名不变：给了就顺手补到每条上（老数据没存过 hash 的借此回填），
    // 分桶/自愈从此有稳定键，不再受 chatId 漂移影响。
    const stampHash = (chatIdHash != null && chatIdHash !== '') ? chatIdHash : null;
    for (const m of hit) { m.chatId = nId; m.chatName = nName; if (stampHash != null && m.chatIdHash == null) m.chatIdHash = stampHash; }
    await saveIndex();
    // 单条文件同步（跳转来源比对的是单条文件里的 chatId，必须一起改，否则跳转失效）
    for (const m of hit) {
        try {
            const item = await getItem(m.id);
            if (!item) continue;
            item.chatId = nId;
            item.chatName = nName;
            if (stampHash != null && item.chatIdHash == null) item.chatIdHash = stampHash;
            await uploadJson(fileNameOf(item.id), item);
        } catch (err) { console.warn('[SP anchor] 改名同步单条失败:', m.id, err); }
    }
    return hit.length;
}

// ═══════════════════════════════════════════════════════════════════════════
//  自愈：按 chat_id_hash 找回改名时漏同步的收藏
// ═══════════════════════════════════════════════════════════════════════════
//
// renameChatId 靠 CHAT_RENAMED 事件驱动——改名那一刻插件没加载、或面板反复开关错过监听，
// 就漏同步：收藏里留着旧 chatId，跳转失效、桶名不跟新。chat_id_hash 是**改名不变**的稳定键
// （ST 首次用 {{chatid}} 类宏时 getStringHash(原始文件名) 算一次、永久缓存进 chat_metadata，
// 改名不重算），据此反查"哪些收藏的 chatId 其实就是当前这个 chat 改名前的样子"，迁到当前。
// 由 index.js 在 CHAT_CHANGED 里调用，兜住 CHAT_RENAMED 的漏网。

// getStringHash（cyrb53）：优先用 ST 经 context 暴露的实现，保证跟核心算法逐字节一致；
// 老版本没暴露时退回内联（与 public/scripts/utils.js:getStringHash 等价，seed 固定 0）。
function strHash(input) {
    const s = String(input ?? '');
    const fn = getContext?.()?.getStringHash;
    if (typeof fn === 'function') return fn(s);
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0, ch; i < s.length; i++) {
        ch = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// currentChatId/currentChatName = 当前聊天；chatIdHash = chat_metadata.chat_id_hash。
// 找出"其实就是当前 chat 改名前的自己"的收藏、迁到当前 chatId，并顺手回填稳定 hash。
// 判定属于当前 chat 的两条线索（满足其一即算）：
//   (a) 已存 chatIdHash === 当前 hash —— 最可靠，改名多少次都认得（新数据走这条）；
//   (b) 老数据没存 hash：退回 strHash(m.chatId) === 当前 hash（仅当 chatId 仍是原始名才命中，
//       多级改名后可能漏，但有 (a) 兜底，新收藏一次即补齐）。
// 命中但 chatId 已是当前值的，也要回填 hash（把改名分裂出的桶并回来）。返回实际迁移条数。
export async function healChatByHash(currentChatId, currentChatName, chatIdHash) {
    const wantHash = Number(chatIdHash);
    if (!currentChatId || !Number.isFinite(wantHash)) return 0;
    const idx = await loadIndex();
    const cur = String(currentChatId);

    // 属于当前 chat 的所有 item（满足其一即算），无论 chatId 是否已对：
    //   (a) 已存 hash 命中；(b) 老数据 hash 空、strHash(chatId) 命中；(c) chatId 就是当前 chat。
    // (c) 兜住"metadata 里的 chat_id_hash 是改名途中某个名字算的、与原名 hash 对不上"——
    //     此时当前 chat 自己的收藏靠 (a)(b) 可能不命中，但 chatId===当前值必属当前，直接认领并补 hash。
    const mine = idx.items.filter(m =>
        (m.chatIdHash != null && Number(m.chatIdHash) === wantHash) ||
        ((m.chatIdHash == null || m.chatIdHash === '') && strHash(m.chatId) === wantHash) ||
        String(m.chatId) === cur
    );
    if (!mine.length) return 0;

    // ① 回填稳定 hash（含 chatId 已正确、只是缺 hash 的——正是它们导致分桶分裂）
    let backfilled = 0;
    for (const m of mine) {
        if (m.chatIdHash == null || m.chatIdHash === '') { m.chatIdHash = wantHash; backfilled++; }
    }

    // ② chatId 漂了的旧收藏迁到当前值
    const staleIds = [...new Set(mine.filter(m => String(m.chatId) !== cur).map(m => m.chatId))];
    let migrated = 0;
    if (staleIds.length) {
        await saveIndex();   // 先把回填落盘，renameChatId 内部会重读索引
        for (const oldId of staleIds) {
            try { migrated += await renameChatId(oldId, currentChatId, currentChatName, wantHash); }
            catch (err) { console.warn('[SP anchor] 自愈迁移失败:', oldId, err); }
        }
    } else if (backfilled) {
        await saveIndex();
        // 单条文件也补 hash（跟索引一致；量通常很小）
        for (const m of mine) {
            try {
                const item = await getItem(m.id);
                if (item && (item.chatIdHash == null || item.chatIdHash === '')) {
                    item.chatIdHash = wantHash;
                    await uploadJson(fileNameOf(item.id), item);
                }
            } catch (err) { console.warn('[SP anchor] 回填 hash 单条失败:', m.id, err); }
        }
    }
    // 返回值只作「有没有改动过」的真值信号（调用侧 index.js 仅 if(n>0) 决定刷不刷面板）。
    // 故直接相加：迁移与回填可能覆盖同一条（重复计数无害），关键是别在「迁移全 no-op 但有回填」时误归 0 而漏刷。
    const total = migrated + backfilled;
    if (migrated || backfilled) console.info(`[SP anchor] 自愈：迁移 ${migrated} 条、回填 hash ${backfilled} 条 → ${currentChatId}`);
    return total;
}

// ═══════════════════════════════════════════════════════════════════════════
//  收养孤儿：hash 链断掉的旧收藏，按"角色 + 旧名已不存在 + 该角色仅此一个聊天"认领
// ═══════════════════════════════════════════════════════════════════════════
//
// chat_id_hash 是**原始文件名**的哈希；收藏若发生在改名之后，存的 chatId 是中间名，
// 按哈希永远追不回（hash(中间名) ≠ hash(原始名)）。这类孤儿唯一可靠的归属证据：
//   ① charName 与当前角色一致；② 它挂的 chatId 已不存在于该角色现存聊天文件里（= 被改名改走了）；
//   ③ 该角色现存聊天只有当前这一个（无歧义，不会并错）。
// 三条全满足才认领迁入并补 hash；角色有多个聊天时宁可不动，避免误并。
export async function adoptOrphans(charName, existingChatIds, currentChatId, currentChatName, chatIdHash = null) {
    if (!charName || !currentChatId) return 0;
    const cur = String(currentChatId);
    const idx = await loadIndex();
    const stale = [...new Set(
        idx.items
            .filter(m => (m.charName || '') === charName
                && String(m.chatId) !== cur
                && !existingChatIds.has(String(m.chatId)))
            .map(m => m.chatId)
    )];
    if (!stale.length) return 0;
    let total = 0;
    for (const oldId of stale) {
        try { total += await renameChatId(oldId, currentChatId, currentChatName, chatIdHash); }
        catch (err) { console.warn('[SP anchor] 收养孤儿失败:', oldId, err); }
    }
    if (total) console.info(`[SP anchor] 按角色收养 ${total} 条孤儿收藏 → ${currentChatId}`);
    return total;
}

// ═══════════════════════════════════════════════════════════════════════════
//  分桶：按来源聊天分组（读时派生，不单独存文件夹）
// ═══════════════════════════════════════════════════════════════════════════

// 返回 [{ chatId, chatName, charName, count, latestTs, items:[] }]，按最近收藏倒序。
// items 是 meta（不含 html）；点开全文时再 getItem 拉正文。
export async function listByChat() {
    const items = await getAllItems();
    const buckets = new Map();
    for (const it of items) {
        // 分桶键优先用 chat_id_hash（改名不变的稳定键）——同一个聊天哪怕 chatId 因改名/漏同步
        // 漂成好几个值，只要 hash 一致就并进同一个桶，避免"改名后分裂出多个收藏分组"。
        // 老数据没存 hash → 退回按 chatId 分桶（保持旧行为）。
        const key = (it.chatIdHash != null && it.chatIdHash !== '')
            ? `h:${it.chatIdHash}`
            : `c:${it.chatId || '(unknown)'}`;
        if (!buckets.has(key)) {
            buckets.set(key, {
                chatId  : it.chatId,
                chatIdHash: it.chatIdHash ?? null,
                chatName: it.chatName || '(未命名聊天)',
                charName: it.charName || '',
                items   : [],
                latestTs: 0,
            });
        }
        const b = buckets.get(key);
        b.items.push(it);
        if (it.ts > b.latestTs) b.latestTs = it.ts;
        // 桶的展示名 & 代表 chatId 跟最新一条走（聊天可能被改名，最新那条的名字/ id 最准）
        if (it.ts === b.latestTs) {
            b.chatName = it.chatName || b.chatName;
            b.charName = it.charName || b.charName;
            b.chatId   = it.chatId ?? b.chatId;
        }
    }
    const out = [...buckets.values()];
    for (const b of out) {
        b.items.sort((a, z) => (z.floorIndex ?? 0) - (a.floorIndex ?? 0) || z.ts - a.ts);
        b.count = b.items.length;
    }
    out.sort((a, z) => z.latestTs - a.latestTs);
    return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  快照净化 + 预览
// ═══════════════════════════════════════════════════════════════════════════
//
// 与棱相反：**保留 <style> 和 inline style**（状态栏靠它显示），只砍 <script>/on*/危险协议。
// DOMPurify 默认就砍 <script>/on*/javascript:，且默认保留 <style> 与 style 属性——正是所需。
// 样式泄漏问题不在这里解决，交给渲染侧的 Shadow DOM 隔离。

export function sanitizeSnapshot(htmlRaw) {
    const html = String(htmlRaw || '');
    const purifier = globalThis.DOMPurify;
    if (purifier && typeof purifier.sanitize === 'function') {
        const clean = purifier.sanitize(html, {
            ADD_TAGS: ['style'],
            ALLOW_DATA_ATTR: true,
            RETURN_TRUSTED_TYPE: false,
        });
        return stripRenderBoxes(clean);
    }
    console.warn('[SP anchor] DOMPurify 不可用，退回纯文本快照');
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
}

// 剥掉快照里不该留的「渲染框」：
//   .TH-render / iframe —— 酒馆助手用 <iframe srcdoc> 现场渲染的动态框，冻不成静态快照；
//   .sp-lines-inline    —— 构画塞进楼层的「线」内联块（伏笔展示，虚线冷知识也折在其 body 内），
//                          纯插件 UI 不是正文，整块剥掉即连虚线一并剥；
//   .sp-dashed-inline   —— 合并前旧版独立虚线块的兜底，扫掉遗留 DOM。
function stripRenderBoxes(htmlStr) {
    const div = document.createElement('div');
    div.innerHTML = String(htmlStr || '');
    div.querySelectorAll('.TH-render, iframe, .sp-lines-inline, .sp-dashed-inline').forEach(el => el.remove());
    return div.innerHTML;
}

// 从（已净化的）快照里抽纯文本预览：先剔 <style>/<script> 免得把 CSS 源码当正文，
// 再取 textContent、压空白、截断。存进 item.textPreview 供缩略窗与搜索用。
export function makePreview(htmlSnapshot, max = 140) {
    const div = document.createElement('div');
    div.innerHTML = String(htmlSnapshot || '');
    div.querySelectorAll('style, script').forEach(el => el.remove());
    const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max) + '…' : text;
}
// ═══════════════════════════════════════════════════════════════════════════
//  用量估算 / 容量提示
// ═══════════════════════════════════════════════════════════════════════════
//
// 从索引 meta.bytes 聚合——无需把所有快照 HTML 拉回来（每条一文件 + 轻量索引的红利）。

export async function estimateBytes() {
    const idx = await loadIndex();
    return idx.items.reduce((sum, m) => sum + (Number(m.bytes) || 0), 0);
}

export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export async function checkSize() {
    const warnAt = Number(_getSettings().anchorSizeWarnBytes) || SIZE_WARN_BYTES;
    const bytes = await estimateBytes();
    return { over: bytes > warnAt, bytes, warnAt };
}

// ═══════════════════════════════════════════════════════════════════════════
//  收藏一条楼层：由 index.js 抓好 rawInnerHtml + 元数据传进来，这里净化+组装+落库
// ═══════════════════════════════════════════════════════════════════════════
//
// meta: { chatId, chatIdHash, chatName, charName, messageId, floorIndex }
// rawInnerHtml: 楼层 .mes_text 的 live innerHTML（渲染后，含脚本生成的状态栏）

export async function saveSnapshot(meta, rawInnerHtml) {
    const html = sanitizeSnapshot(rawInnerHtml);
    const item = {
        id        : (crypto?.randomUUID?.() || `a-${Date.now()}-${Math.floor(performance.now())}`),
        chatId    : meta?.chatId ?? getContext().chatId ?? null,
        chatIdHash: meta?.chatIdHash ?? getContext()?.chatMetadata?.chat_id_hash ?? null,
        chatName  : meta?.chatName || '',
        charName  : meta?.charName || '',
        messageId : meta?.messageId ?? null,
        floorIndex: Number.isFinite(+meta?.floorIndex) ? +meta.floorIndex : null,
        html,
        textPreview: makePreview(html),
        ts        : Date.now(),
        tags      : [],
    };
    await addItem(item);
    return item;
}

// ═══════════════════════════════════════════════════════════════════════════
//  init
// ═══════════════════════════════════════════════════════════════════════════

export function initAnchor({ getSettings } = {}) {
    if (getSettings) _getSettings = getSettings;
    // 预热索引（一次 GET，冷启动不至于首次收藏才拉）；成功后跑一次性 IndexedDB→/api/files 迁移。
    // 失败静默——真正操作时会重试。
    loadIndex()
        .then(() => migrateFromIndexedDB())
        .catch(err => console.warn('[SP anchor] 初始化失败:', err));
}

// ═══════════════════════════════════════════════════════════════════════════
//  一次性迁移：旧版 IndexedDB(DB 'sp-anchor') → /api/files
// ═══════════════════════════════════════════════════════════════════════════
//
// 2.0.0 前坐标存浏览器 IndexedDB。升级后改存服务器，老用户的收藏得搬过来，否则凭空消失。
// 策略：探测旧库 → 逐条搬进 /api/files（同 id 覆盖，重跑幂等）→ 全部成功才删旧库。
// 靠"旧库是否存在且非空"驱动，无需额外标记：搬完即删库，下次探测为空自动跳过。

const LEGACY_DB = 'sp-anchor';
const LEGACY_STORE = 'items';

function openLegacyDb() {
    return new Promise((resolve) => {
        let req;
        try { req = indexedDB.open(LEGACY_DB); }          // 不带 version：只打开已存在的库，不升级
        catch { resolve(null); return; }
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => resolve(null);
        req.onupgradeneeded = () => { /* 库本不存在，让它建空壳，随后按无 store 处理 */ };
    });
}

function readAllLegacy(db) {
    return new Promise((resolve) => {
        if (!db.objectStoreNames.contains(LEGACY_STORE)) { resolve([]); return; }
        try {
            const r = db.transaction(LEGACY_STORE, 'readonly').objectStore(LEGACY_STORE).getAll();
            r.onsuccess = () => resolve(Array.isArray(r.result) ? r.result : []);
            r.onerror   = () => resolve([]);
        } catch { resolve([]); }
    });
}

async function migrateFromIndexedDB() {
    if (typeof indexedDB === 'undefined') return;
    const db = await openLegacyDb();
    if (!db) return;
    let legacy = [];
    try { legacy = await readAllLegacy(db); } finally { db.close(); }
    if (!legacy.length) { dropLegacyDb(); return; }        // 空库直接删，清理历史残壳

    console.info(`[SP anchor] 检测到 ${legacy.length} 条旧收藏，迁移到服务器…`);
    let ok = 0;
    for (const item of legacy) {
        if (!item || !item.id) continue;
        try { await addItem(item); ok++; }                 // addItem 幂等：同 id 覆盖 + 更新索引
        catch (err) { console.warn('[SP anchor] 迁移单条失败，保留旧库:', item.id, err); return; }
    }
    console.info(`[SP anchor] 迁移完成 ${ok}/${legacy.length}，删除旧 IndexedDB`);
    dropLegacyDb();
}

function dropLegacyDb() {
    try { indexedDB.deleteDatabase(LEGACY_DB); } catch { /* 删不掉不致命，下次空库再试 */ }
}

export { INDEX_NAME, FILE_PREFIX, SIZE_WARN_BYTES };



