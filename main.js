// Electron 主进程文件
const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let isTransparent = false;

// 创建窗口
function createWindow() {
    // 获取屏幕尺寸
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    // 加载保存的窗口状态
    const savedWindowState = loadWindowState();

    // 设置默认或保存的窗口大小和位置
    const windowConfig = {
        width: savedWindowState.width || 600,
        height: savedWindowState.height || 800,
        minWidth: 300,
        minHeight: 200,
        x: savedWindowState.x || (width - 650),
        y: savedWindowState.y || 100,
        frame: false, // 无边框窗口
        transparent: false, // 背景透明
        alwaysOnTop: true, // 始终置顶
        resizable: true, // 可调整大小
        maximizable: false, // 不可最大化
        minimizable: true, // 可最小化
        skipTaskbar: false, // 显示在任务栏
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        backgroundColor: '#f5f5f5',
        title: '摸鱼阅读器'
    };

    mainWindow = new BrowserWindow(windowConfig);

    mainWindow.loadFile('index.html');

    // 开发时打开开发者工具
    // mainWindow.webContents.openDevTools();

    // 监听窗口大小变化
    mainWindow.on('resized', () => {
        const [width, height] = mainWindow.getSize();
        const [x, y] = mainWindow.getPosition();
        saveWindowState({ width, height, x, y });
        mainWindow.webContents.send('window-resized', { width, height });
    });

    // 监听窗口移动
    mainWindow.on('moved', () => {
        const [width, height] = mainWindow.getSize();
        const [x, y] = mainWindow.getPosition();
        saveWindowState({ width, height, x, y });
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 失焦/聚焦通知渲染进程做自动伪装（失焦模糊内容）
    mainWindow.on('blur', () => {
        if (mainWindow) mainWindow.webContents.send('window-blur');
    });
    mainWindow.on('focus', () => {
        if (mainWindow) mainWindow.webContents.send('window-focus');
    });
}

// ==================== 小说解析与按需读取 ====================
// 大文件优化：整本正文只保留在主进程内存中，章节仅记录 [标题, 起止偏移]，
// 渲染进程按需通过 IPC 读取单章内容，避免大文本在 IPC / localStorage 中搬运导致卡死
const novelCache = new Map(); // filepath -> { content, chapters: [{title, start, end}] }
const NOVEL_CACHE_MAX = 5;    // 简单 LRU 上限，防止同时缓存过多大书占内存

// 轻量 UTF-8 合法性校验（纯字节操作）：遇到非法序列立即返回 false
// 采样最多 4MB 即可判定，避免全量扫描开销
function isUtf8Buffer(buf) {
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return true;
    const n = Math.min(buf.length, 4 * 1024 * 1024);
    let i = 0;
    while (i < n) {
        const b = buf[i];
        if (b < 0x80) { i++; continue; }
        let len;
        if ((b & 0xE0) === 0xC0) len = 1;      // 2 字节序列
        else if ((b & 0xF0) === 0xE0) len = 2; // 3 字节序列
        else if ((b & 0xF8) === 0xF0) len = 3; // 4 字节序列
        else return false;                      // 非法首字节
        if (i + len >= n) break;                // 采样边界截断，视为通过
        for (let k = 1; k <= len; k++) {
            if ((buf[i + k] & 0xC0) !== 0x80) return false;
        }
        i += len + 1;
    }
    return true;
}

// 解码小说文件：BOM/UTF-8 校验通过用原生 Buffer.toString（安全），
// 否则回退 GBK。注意：不能使用 TextDecoder('utf-8', {fatal:true})——
// Electron 28 主进程下对大 buffer 的非法序列会触发 native 崩溃（已实测复现）
function decodeNovelText(buffer) {
    // UTF-16 BOM 处理
    if (buffer.length >= 2) {
        if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
            return buffer.toString('utf16le').replace(/^\uFEFF/, '');
        }
        if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
            // UTF-16BE：字节两两交换后按 LE 解码
            const swapped = Buffer.allocUnsafe(buffer.length - buffer.length % 2);
            for (let i = 0; i < swapped.length; i += 2) {
                swapped[i] = buffer[i + 1];
                swapped[i + 1] = buffer[i];
            }
            return swapped.toString('utf16le').replace(/^\uFEFF/, '');
        }
    }
    if (isUtf8Buffer(buffer)) {
        return buffer.toString('utf-8');
    }
    // 非法 UTF-8 序列存在，按 GBK 解码
    try {
        return new TextDecoder('gbk').decode(buffer);
    } catch (e) {
        console.error('当前环境不支持 GBK 解码，按 UTF-8 宽松解码');
        return buffer.toString('utf-8');
    }
}

// 解析章节边界（字符偏移）。标题取标记所在整行，便于章节下拉框显示完整章节名
function parseChapters(content) {
    const patterns = [
        /第[0-9零一二三四五六七八九十百千万]+章/,
        /第[0-9零一二三四五六七八九十百千万]+节/
    ];

    for (const pattern of patterns) {
        const regex = new RegExp(pattern.source, 'g');
        const marks = [];
        let m;
        while ((m = regex.exec(content)) !== null) {
            let lineEnd = content.indexOf('\n', m.index);
            if (lineEnd === -1) lineEnd = content.length;
            const title = content.slice(m.index, lineEnd).trim();
            marks.push({ index: m.index, title: title || m[0] });
        }
        if (marks.length > 1) {
            const chapters = [];
            // 第一个章节标记之前的内容（书名/简介等）作为序章
            if (content.slice(0, marks[0].index).trim()) {
                chapters.push({ title: '序', start: 0, end: marks[0].index });
            }
            for (let i = 0; i < marks.length; i++) {
                chapters.push({
                    title: marks[i].title,
                    start: marks[i].index,
                    end: i + 1 < marks.length ? marks[i + 1].index : content.length
                });
            }
            return chapters;
        }
    }

    // 未识别到章节：按空行段落分块，每 5 段一章（与旧版行为一致）
    const sepRegex = /\n\n\n+/g;
    const paraRanges = [];
    let from = 0;
    let m;
    while ((m = sepRegex.exec(content)) !== null) {
        paraRanges.push([from, m.index]);
        from = m.index + m[0].length;
    }
    paraRanges.push([from, content.length]);

    const chapters = [];
    const chunkSize = 5;
    for (let i = 0; i < paraRanges.length; i += chunkSize) {
        const start = paraRanges[i][0];
        const end = paraRanges[Math.min(i + chunkSize, paraRanges.length) - 1][1];
        if (content.slice(start, end).trim()) {
            chapters.push({
                title: `Chapter ${Math.floor(i / chunkSize) + 1}`,
                start,
                end
            });
        }
    }
    if (chapters.length === 0) {
        chapters.push({ title: 'Chapter 1', start: 0, end: content.length });
    }
    return enforceChapterSize(chapters, content);
}

// 单章字符数上限：超过则按大小二次切割，防止渲染超大文本节点导致界面卡死
const MAX_CHAPTER_SIZE = 100000;

function enforceChapterSize(chapters, content) {
    const result = [];
    for (const ch of chapters) {
        const size = ch.end - ch.start;
        if (size <= MAX_CHAPTER_SIZE) {
            result.push(ch);
            continue;
        }
        // 均匀切分为若干块，标题追加序号
        const count = Math.ceil(size / MAX_CHAPTER_SIZE);
        const step = Math.ceil(size / count);
        let part = 1;
        for (let off = ch.start; off < ch.end; off += step, part++) {
            result.push({
                title: `${ch.title} (${part})`,
                start: off,
                end: Math.min(off + step, ch.end)
            });
        }
    }
    return result;
}

// 获取小说缓存（含 LRU 淘汰），缓存未命中时读取文件并解析
async function getNovel(filepath) {
    let entry = novelCache.get(filepath);
    if (entry) {
        // 重新插入以刷新 LRU 顺序
        novelCache.delete(filepath);
        novelCache.set(filepath, entry);
        return entry;
    }
    const buf = await fs.promises.readFile(filepath);
    const content = decodeNovelText(buf);
    entry = { content, chapters: parseChapters(content) };
    novelCache.set(filepath, entry);
    while (novelCache.size > NOVEL_CACHE_MAX) {
        const oldestKey = novelCache.keys().next().value;
        novelCache.delete(oldestKey);
    }
    return entry;
}

// 自动导入 txt_source 文件夹中的小说（只传元数据：标题列表，不含正文）
function autoImportNovels() {
    const txtSourcePath = path.join(__dirname, 'txt_source');

    if (!fs.existsSync(txtSourcePath)) {
        console.log('txt_source 文件夹不存在');
        return;
    }

    const files = fs.readdirSync(txtSourcePath).filter(file => file.endsWith('.txt'));

    if (files.length === 0) {
        console.log('txt_source 文件夹中没有 .txt 文件');
        return;
    }

    const novels = [];

    files.forEach(file => {
        const filepath = path.join(txtSourcePath, file);
        try {
            const content = decodeNovelText(fs.readFileSync(filepath));
            const chapters = parseChapters(content);
            novelCache.set(filepath, { content, chapters });
            novels.push({
                filename: file,
                filepath: filepath,
                title: file.replace(/\.txt$/, ''),
                chapterTitles: chapters.map(c => c.title)
            });
        } catch (error) {
            console.error(`读取文件失败: ${file}`, error);
        }
    });

    // 只发送元数据到渲染进程（KB 级），正文按需读取
    if (mainWindow && novels.length > 0) {
        mainWindow.webContents.send('auto-import-novels', novels);
        console.log(`自动导入 ${novels.length} 本小说`);
    }
}

// 保存窗口状态
function saveWindowState(state) {
    const electron = require('electron');
    const { app } = electron;
    const path = require('path');
    const fs = require('fs');

    const userDataPath = app.getPath('userData');
    const stateFilePath = path.join(userDataPath, 'window-state.json');

    try {
        fs.writeFileSync(stateFilePath, JSON.stringify(state));
    } catch (error) {
        console.error('Failed to save window state:', error);
    }
}

// 加载窗口状态
function loadWindowState() {
    const electron = require('electron');
    const { app } = electron;
    const path = require('path');
    const fs = require('fs');

    const userDataPath = app.getPath('userData');
    const stateFilePath = path.join(userDataPath, 'window-state.json');

    try {
        if (fs.existsSync(stateFilePath)) {
            const data = fs.readFileSync(stateFilePath, 'utf-8');
            const state = JSON.parse(data);

            // 验证窗口位置是否在可见范围内
            const { width, height } = screen.getPrimaryDisplay().workAreaSize;
            if (state.x > width || state.y > height || state.x < -state.width || state.y < 0) {
                // 窗口位置超出屏幕，使用默认值
                return {};
            }

            return state;
        }
    } catch (error) {
        console.error('Failed to load window state:', error);
    }

    return {};
}

// 应用启动时
app.whenReady().then(() => {
    createWindow();

    // 注册全局快捷键（系统级，应用失焦也生效）
    registerGlobalShortcuts();

    // 等待窗口加载完成后自动导入小说
    setTimeout(() => {
        autoImportNovels();
    }, 1000);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 全局快捷键：
//   Alt+Q          老板键（切换伪装态），失败自动尝试备选键位
//   Alt+Shift+←/→  全局翻章（避开 IDEA 的 Alt+←/→ 导航键）
function registerGlobalShortcuts() {
    const bossKeys = ['Alt+Q', 'Alt+B'];
    for (const key of bossKeys) {
        if (globalShortcut.register(key, () => {
            if (mainWindow) mainWindow.webContents.send('boss-key');
        })) {
            break;
        }
    }
    globalShortcut.register('Alt+Shift+Left', () => {
        if (mainWindow) mainWindow.webContents.send('global-prev-chapter');
    });
    globalShortcut.register('Alt+Shift+Right', () => {
        if (mainWindow) mainWindow.webContents.send('global-next-chapter');
    });
}

// 应用退出前注销所有全局快捷键，避免残留系统级拦截
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// 所有窗口关闭时退出应用（macOS除外）
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC 通信处理

// 手动导入：正文写入本地缓存文件并返回路径，书架只持久化元数据
ipcMain.handle('novel:save-cache', async (event, filename, content) => {
    const bookId = 'book_' + filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
    const cacheDir = path.join(app.getPath('userData'), 'novel_cache');
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const filepath = path.join(cacheDir, bookId + '.txt');
    await fs.promises.writeFile(filepath, content, 'utf-8');
    return filepath;
});

// 获取章节元数据（标题列表），不返回正文
ipcMain.handle('novel:get-meta', async (event, filepath) => {
    const entry = await getNovel(filepath);
    return { chapterTitles: entry.chapters.map(c => c.title) };
});

// 按需获取单章内容（几 KB）
ipcMain.handle('novel:get-chapter', async (event, filepath, index) => {
    const entry = await getNovel(filepath);
    const ch = entry.chapters[index];
    if (!ch) return null;
    return entry.content.slice(ch.start, ch.end).trim();
});

ipcMain.on('window-minimize', () => {
    if (mainWindow) {
        mainWindow.minimize();
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) {
        mainWindow.close();
    }
});

ipcMain.on('window-set-opacity', (event, opacity) => {
    if (mainWindow) {
        mainWindow.setOpacity(opacity);
    }
});

ipcMain.on('window-toggle-transparent', (event, transparent) => {
    if (mainWindow) {
        isTransparent = transparent;
        mainWindow.setBackgroundColor(transparent ? '#00000000' : '#f5f5f5');
    }
});
