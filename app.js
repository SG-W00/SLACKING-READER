// 摸鱼阅读器 - Electron版本
const { ipcRenderer } = require('electron');

// 调试日志开关：摸鱼场景默认静默，避免 DevTools 暴露阅读内容
const DEBUG = false;
function log(...args) {
    if (DEBUG) log(...args);
}

// 全局变量
let chapters = [];
let currentChapterIndex = 0;
let isAlwaysOnTop = true;
let autoSaveInterval = null; // 自动保存定时器
let renderSeq = 0; // 章节渲染序号，用于丢弃快速切章时的过期响应
let pendingScroll = null; // 打开书籍后待恢复的滚动位置 { paraIndex, scrollTop }
let bossModeActive = false; // 老板键伪装态
let bossReturnScroll = null; // 进入伪装前的阅读位置，退出伪装时恢复
let atBottomState = false; // 是否处于章节底部（等待二次滚动翻章）
let bottomWheelAccum = 0; // 底部状态下滚动累积量
let settings = {
    bgImage: null,
    bgScale: 100,
    bgBlur: 0,
    fontSize: 14,
    textColor: '#858585',
    lineHeight: 1.6,
    bgColor: '#1e1e1e',
    windowOpacity: 100,
    contentOpacity: 95,
    transparentMode: false,
    stealthNames: true
};

// 书架和阅读进度
let bookshelf = [];
let currentBook = null;
let readingProgress = {}; // 书名 -> { chapterIndex, scrollPosition, timestamp }

// DOM 元素 - 使用安全的获取方式
function getEl(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`Element not found: ${id}`);
    return el;
}

const titleBar = getEl('titleBar');
const dragArea = getEl('dragArea');
const minimizeBtn = getEl('minimizeBtn');
const closeBtn = getEl('closeBtn');
const importBtn = getEl('importBtn');
const settingsBtn = getEl('settingsBtn');
const pinBtn = getEl('pinBtn');
const fileInput = getEl('fileInput');
const bgInput = getEl('bgInput');
const emptyState = getEl('emptyState');
const reader = getEl('reader');
const content = getEl('content');
const chapterTitle = getEl('chapterTitle');
const prevChapterBtn = getEl('prevChapterBtn');
const nextChapterBtn = getEl('nextChapterBtn');
const chapterInfo = getEl('chapterInfo');
const quickFontSize = getEl('quickFontSize');
const settingsPanel = getEl('settingsPanel');
const closeSettingsBtn = getEl('closeSettingsBtn');
const resetBtn = getEl('resetBtn');
const mainContent = getEl('mainContent');
const chapterSelect = getEl('chapterSelect');

// 设置相关元素
const windowOpacityInput = getEl('windowOpacity');
const transparentModeCheckbox = getEl('transparentMode');
const bgScaleInput = getEl('bgScale');
const bgBlurInput = getEl('bgBlur');
const fontSizeInput = getEl('fontSize');
const textColorInput = getEl('textColor');
const lineHeightInput = getEl('lineHeight');
const bgColorInput = getEl('bgColor');
const contentOpacityInput = getEl('contentOpacity');

// 书架相关元素
const bookshelfEl = getEl('bookshelf');
const bookList = getEl('bookList');
const backToShelfBtn = getEl('backToShelfBtn');

// 摸鱼功能元素
const nextHint = getEl('nextHint');                 // 到底二次滚动翻章提示
const globalProgressFill = getEl('globalProgressFill'); // 全书进度条
const stealthNamesInput = getEl('stealthNames');    // 章节名伪装开关

// 初始化
function init() {
    log('Initializing app...');

    loadSettings();
    loadBookshelf();
    loadReadingProgress();
    applySettings();
    bindEvents();
    updatePinButton();

    // 初始化时隐藏章节选择器和阅读导航按钮
    if (chapterSelect) {
        chapterSelect.style.display = 'none';
    }
    if (backToShelfBtn) {
        backToShelfBtn.style.display = 'none';
    }
    if (prevChapterBtn) {
        prevChapterBtn.style.display = 'none';
    }
    if (nextChapterBtn) {
        nextChapterBtn.style.display = 'none';
    }

    showBookshelf();

    log('App initialized');
}

// 绑定事件
function bindEvents() {
    log('Binding events...');
    
    // 窗口控制
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            ipcRenderer.send('window-minimize');
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            ipcRenderer.send('window-close');
        });
    }
    
    // 工具栏按钮
    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => {
            fileInput.click();
        });
    }
    
    if (settingsBtn && settingsPanel) {
        settingsBtn.addEventListener('click', () => {
            log('Settings button clicked');
            settingsPanel.classList.toggle('active');
            log('Settings panel active:', settingsPanel.classList.contains('active'));
        });
    }
    
    if (pinBtn) {
        pinBtn.addEventListener('click', toggleAlwaysOnTop);
    }
    
    // 文件导入
    if (fileInput) {
        fileInput.addEventListener('change', handleFileImport);
    }
    if (bgInput) {
        bgInput.addEventListener('change', handleBgImport);
    }
    
    // 章节导航（伪装态下失效，防止章节索引被改）
    if (prevChapterBtn) {
        prevChapterBtn.addEventListener('click', () => {
            if (bossModeActive) return;
            if (currentChapterIndex > 0) {
                currentChapterIndex--;
                renderChapter();
            }
        });
    }
    
    if (nextChapterBtn) {
        nextChapterBtn.addEventListener('click', () => {
            if (bossModeActive) return;
            if (currentChapterIndex < chapters.length - 1) {
                currentChapterIndex++;
                renderChapter();
            }
        });
    }

    // 章节选择器
    if (chapterSelect) {
        chapterSelect.addEventListener('change', (e) => {
            // 伪装态下不切换章节，防止退出伪装后位置错乱
            if (bossModeActive) return;

            log('Chapter select changed:', e.target.value);
            const newIndex = parseInt(e.target.value);
            log('Current index:', currentChapterIndex, 'New index:', newIndex);
            log('Chapters length:', chapters.length);

            if (isNaN(newIndex)) {
                console.error('Invalid chapter index:', e.target.value);
                return;
            }

            if (newIndex >= 0 && newIndex < chapters.length) {
                currentChapterIndex = newIndex;
                log('Switching to chapter:', currentChapterIndex);
                renderChapter();
            } else {
                console.error('Chapter index out of range:', newIndex);
            }
        });
    }

    // 快速字体大小调整
    if (quickFontSize) {
        quickFontSize.addEventListener('input', (e) => {
            settings.fontSize = e.target.value;
            if (fontSizeInput) fontSizeInput.value = e.target.value;
            document.getElementById('fontSizeValue').textContent = settings.fontSize + 'px';
            applySettings();
            saveSettings();
        });
    }
    
    // 关闭设置面板
    if (closeSettingsBtn && settingsPanel) {
        closeSettingsBtn.addEventListener('click', () => {
            log('Close settings button clicked');
            settingsPanel.classList.remove('active');
            log('Settings panel removed');
        });
    }
    
    // 窗口透明度
    if (windowOpacityInput) {
        windowOpacityInput.addEventListener('input', (e) => {
            settings.windowOpacity = e.target.value;
            const opacityValue = document.getElementById('opacityValue');
            if (opacityValue) opacityValue.textContent = settings.windowOpacity + '%';
            ipcRenderer.send('window-set-opacity', settings.windowOpacity / 100);
            applySettings();
            saveSettings();
        });
    }
    
    // 透明模式
    if (transparentModeCheckbox) {
        transparentModeCheckbox.addEventListener('change', (e) => {
            settings.transparentMode = e.target.checked;
            ipcRenderer.send('window-toggle-transparent', settings.transparentMode);
            applySettings();
            saveSettings();
        });
    }
    
    // 背景设置
    if (bgScaleInput) {
        bgScaleInput.addEventListener('input', (e) => {
            settings.bgScale = e.target.value;
            const scaleValue = document.getElementById('scaleValue');
            if (scaleValue) scaleValue.textContent = settings.bgScale + '%';
            applySettings();
            saveSettings();
        });
    }
    
    if (bgBlurInput) {
        bgBlurInput.addEventListener('input', (e) => {
            settings.bgBlur = e.target.value;
            const blurValue = document.getElementById('blurValue');
            if (blurValue) blurValue.textContent = settings.bgBlur + 'px';
            applySettings();
            saveSettings();
        });
    }
    
    // 文字设置
    if (fontSizeInput) {
        fontSizeInput.addEventListener('input', (e) => {
            settings.fontSize = e.target.value;
            if (quickFontSize) quickFontSize.value = e.target.value;
            const fontSizeValue = document.getElementById('fontSizeValue');
            if (fontSizeValue) fontSizeValue.textContent = settings.fontSize + 'px';
            applySettings();
            saveSettings();
        });
    }
    
    if (textColorInput) {
        textColorInput.addEventListener('input', (e) => {
            settings.textColor = e.target.value;
            applySettings();
            saveSettings();
        });
    }
    
    if (lineHeightInput) {
        lineHeightInput.addEventListener('input', (e) => {
            settings.lineHeight = e.target.value;
            const lineHeightValue = document.getElementById('lineHeightValue');
            if (lineHeightValue) lineHeightValue.textContent = settings.lineHeight;
            applySettings();
            saveSettings();
        });
    }
    
    // 背景颜色
    if (bgColorInput) {
        bgColorInput.addEventListener('input', (e) => {
            settings.bgColor = e.target.value;
            applySettings();
            saveSettings();
        });
    }
    
    // 内容区透明度
    if (contentOpacityInput) {
        contentOpacityInput.addEventListener('input', (e) => {
            settings.contentOpacity = e.target.value;
            const contentOpacityValue = document.getElementById('contentOpacityValue');
            if (contentOpacityValue) contentOpacityValue.textContent = settings.contentOpacity + '%';
            applySettings();
            saveSettings();
        });
    }
    
    // 重置设置
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (confirm('确定要重置所有设置吗？')) {
                resetAllSettings();
            }
        });
    }

    // 书架相关按钮
    if (backToShelfBtn) {
        backToShelfBtn.addEventListener('click', showBookshelf);
    }

    // 章节名伪装开关
    if (stealthNamesInput) {
        stealthNamesInput.addEventListener('change', (e) => {
            settings.stealthNames = e.target.checked;
            saveSettings();
            if (currentBook) {
                updateChapterSelect();
                if (chapterSelect) chapterSelect.value = currentChapterIndex;
            }
        });
    }

    // 键盘快捷键（伪装态下翻章失效，防止退出伪装后位置错乱）
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' && chapters.length > 0 && !bossModeActive) {
            prevChapterBtn.click();
        } else if (e.key === 'ArrowRight' && chapters.length > 0 && !bossModeActive) {
            nextChapterBtn.click();
        } else if (e.key === 'Escape') {
            settingsPanel.classList.remove('active');
        }
    });

    // 应用关闭前保存进度
    window.addEventListener('beforeunload', () => {
        log('应用即将关闭，保存进度');
        saveReadingProgress();

        // 清除自动保存定时器
        if (autoSaveInterval) {
            clearInterval(autoSaveInterval);
        }
    });
    
    // 窗口大小变化监听
    ipcRenderer.on('window-resized', (event, size) => {
        // 可以在这里添加窗口大小变化后的处理逻辑
    });

    // 老板键：全局快捷键切换伪装态
    ipcRenderer.on('boss-key', toggleBossMode);

    // 右键快速触发老板键（伪装/恢复），比快捷键更顺手；
    // 设置面板内保留正常右键行为，不触发伪装
    document.addEventListener('contextmenu', (e) => {
        if (settingsPanel && settingsPanel.contains(e.target)) return;
        e.preventDefault();
        toggleBossMode();
    });

    // 全局翻章（Alt+Shift+←/→，应用失焦也生效）
    ipcRenderer.on('global-prev-chapter', () => {
        if (bossModeActive || !currentBook) return;
        if (currentChapterIndex > 0) {
            currentChapterIndex--;
            renderChapter();
        }
    });
    ipcRenderer.on('global-next-chapter', () => {
        if (bossModeActive || !currentBook) return;
        if (currentChapterIndex < chapters.length - 1) {
            currentChapterIndex++;
            renderChapter();
        }
    });

    // 失焦自动伪装：内容模糊变淡，聚焦恢复
    ipcRenderer.on('window-blur', () => {
        if (!bossModeActive) document.body.classList.add('unfocused');
    });
    ipcRenderer.on('window-focus', () => {
        document.body.classList.remove('unfocused');
    });

    // 自动导入小说监听（只接收元数据，正文由主进程按需提供）
    ipcRenderer.on('auto-import-novels', (event, novels) => {
        log('收到自动导入的小说:', novels.length, '本');

        let importedCount = 0;

        novels.forEach(novel => {
            try {
                const book = buildBookMeta(novel.filename, novel.filepath, novel.chapterTitles);
                addToBookshelf(book, true); // true 表示自动导入
                importedCount++;
            } catch (error) {
                console.error('导入小说失败:', novel.filename, error);
            }
        });

        // 所有导入完成后显示书架
        if (importedCount > 0) {
            log(`成功自动导入/更新 ${importedCount} 本小说`);
            showBookshelf();
        }
    });
}

// 切换置顶状态
function toggleAlwaysOnTop() {
    isAlwaysOnTop = !isAlwaysOnTop;
    updatePinButton();
    // 这里需要主进程支持动态切换置顶
    // 可以通过 IPC 通知主进程
}

// 更新置顶按钮状态
function updatePinButton() {
    if (isAlwaysOnTop) {
        pinBtn.classList.add('active');
        pinBtn.textContent = '◉';
    } else {
        pinBtn.classList.remove('active');
        pinBtn.textContent = '○';
    }
}

// 处理小说文件导入
async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const text = event.target.result;
            // 正文写入主进程本地缓存文件，书架只保存元数据，避免 localStorage 超限导致卡死
            const filepath = await ipcRenderer.invoke('novel:save-cache', file.name, text);
            const { chapterTitles } = await ipcRenderer.invoke('novel:get-meta', filepath);
            const book = buildBookMeta(file.name, filepath, chapterTitles);
            addToBookshelf(book);
        } catch (error) {
            console.error('导入小说失败:', file.name, error);
        }
    };
    reader.readAsText(file, 'UTF-8');
}

// 处理背景图片导入
function handleBgImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        settings.bgImage = event.target.result;
        applySettings();
        saveSettings();
    };
    reader.readAsDataURL(file);
}

// 由文件名/路径/章节标题列表构建书架元数据（不含正文，正文由主进程按需提供）
function buildBookMeta(filename, filepath, chapterTitles) {
    const bookTitle = filename.replace(/\.txt$/, '');
    // 使用文件名生成固定的 ID，确保同一本书的 ID 不变
    const bookId = 'book_' + filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
    return {
        id: bookId,
        title: bookTitle,
        filepath: filepath,
        chapterTitles: chapterTitles || [],
        addedTime: new Date().toISOString()
    };
}

// 书架管理
function loadBookshelf() {
    const saved = localStorage.getItem('moyuReaderBookshelf');
    if (saved) {
        try {
            const list = JSON.parse(saved);
            // 兼容旧格式：剥离正文章节只保留元数据，下次自动导入会按文件名补全 filepath
            let migrated = false;
            bookshelf = (list || []).map(b => {
                if (Array.isArray(b.chapters)) {
                    b.chapterTitles = b.chapters.map(c => c.title);
                    delete b.chapters;
                    migrated = true;
                }
                if (!Array.isArray(b.chapterTitles)) b.chapterTitles = [];
                return b;
            });
            // 剥离后立即持久化瘦身后的书架，释放 localStorage 空间
            if (migrated) saveBookshelf();
        } catch (e) {
            bookshelf = [];
        }
    }
}

function saveBookshelf() {
    localStorage.setItem('moyuReaderBookshelf', JSON.stringify(bookshelf));
}

function addToBookshelf(book, isAutoImport = false) {
    // 检查是否已存在（使用 ID 或标题）
    const existingIndex = bookshelf.findIndex(b => b.id === book.id || b.title === book.title);
    if (existingIndex >= 0) {
        // 更新现有书籍，但保留原有的添加时间
        const existingBook = bookshelf[existingIndex];
        bookshelf[existingIndex] = {
            ...book,
            addedTime: existingBook.addedTime  // 保留原来的添加时间
        };
        log('更新已存在的书籍:', book.title, 'ID:', book.id);
    } else {
        // 添加新书籍
        bookshelf.push(book);
        log('添加新书籍:', book.title, 'ID:', book.id);
    }
    saveBookshelf();

    // 如果是自动导入，不调用 showBookshelf，等待所有导入完成
    if (!isAutoImport) {
        showBookshelf();
    }
}

function renderBookshelf() {
    bookList.innerHTML = '';
    if (bookshelf.length === 0) {
        bookList.innerHTML = '<p style="color: #6e7681; text-align: center; padding: 20px;">/* 暂无书籍 */</p>';
        return;
    }

    bookshelf.forEach(book => {
        const progress = readingProgress[book.id];
        const chapterCount = Array.isArray(book.chapterTitles) ? book.chapterTitles.length : 0;
        const progressPercent = progress ? Math.round((progress.chapterIndex + 1) / Math.max(chapterCount, 1) * 100) : 0;
        const lastRead = progress ? new Date(progress.timestamp).toLocaleDateString() : '未阅读';

        const bookItem = document.createElement('div');
        bookItem.className = 'book-item';
        bookItem.innerHTML = `
            <button class="delete-book-btn" onclick="event.stopPropagation(); deleteBook('${book.id}')">×</button>
            <div class="book-title">${book.title}</div>
            <div class="book-info">${chapterCount} 章节</div>
            <div class="book-info">${lastRead}</div>
            <div class="book-progress">
                <div class="book-progress-bar" style="width: ${progressPercent}%"></div>
            </div>
        `;
        bookItem.addEventListener('click', () => openBook(book.id));
        bookList.appendChild(bookItem);
    });
}

function showBookshelf() {
    emptyState.style.display = 'none';
    bookshelfEl.style.display = 'block';
    reader.style.display = 'none';

    // 隐藏章节选择器和阅读导航按钮
    if (chapterSelect) {
        chapterSelect.style.display = 'none';
    }
    if (backToShelfBtn) {
        backToShelfBtn.style.display = 'none';
    }
    if (prevChapterBtn) {
        prevChapterBtn.style.display = 'none';
    }
    if (nextChapterBtn) {
        nextChapterBtn.style.display = 'none';
    }

    renderBookshelf();
}

function openBook(bookId) {
    log('Opening book:', bookId);
    const book = bookshelf.find(b => b.id === bookId);
    if (!book) {
        console.error('Book not found:', bookId);
        return;
    }

    // 旧数据书籍没有内容文件路径，提示用户恢复来源
    if (!book.filepath) {
        alert('该书籍缺少内容文件（旧格式数据），请将 txt 放入 txt_source 后重启，或重新导入。');
        return;
    }

    log('Book found:', book.title, 'Chapters:', book.chapterTitles.length);

    currentBook = book;
    // 书架只存标题元数据，正文在 renderChapter 时按章加载
    chapters = book.chapterTitles.map(title => ({ title }));

    // 恢复阅读进度
    const progress = readingProgress[bookId];
    if (progress) {
        currentChapterIndex = Math.min(progress.chapterIndex, chapters.length - 1);
        log('恢复阅读进度 - 章节:', currentChapterIndex, '段落:', progress.paragraphIndex);
    } else {
        currentChapterIndex = 0;
        log('没有找到阅读进度，从第一章开始');
    }

    // 滚动位置由 renderChapter 在内容加载完成后恢复（段落级优先，scrollTop 兜底）
    pendingScroll = progress ? {
        paraIndex: progress.paragraphIndex != null ? progress.paragraphIndex : null,
        scrollTop: progress.scrollPosition || 0
    } : null;

    bookshelfEl.style.display = 'none';
    reader.style.display = 'block';

    // 初始化章节选择器
    updateChapterSelect();

    // 显示章节选择器和阅读导航按钮
    if (chapterSelect) {
        chapterSelect.style.display = 'block';
    }
    if (backToShelfBtn) {
        backToShelfBtn.style.display = 'block';
    }
    if (prevChapterBtn) {
        prevChapterBtn.style.display = 'block';
    }
    if (nextChapterBtn) {
        nextChapterBtn.style.display = 'block';
    }

    renderChapter();
    setupScrollListener();

    // 启动自动保存进度定时器（每30秒保存一次）
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }
    autoSaveInterval = setInterval(() => {
        saveReadingProgress();
        log('自动保存进度');
    }, 30000);
}

// 将 deleteBook 挂载到 window 对象，使其可在 HTML 中调用
window.deleteBook = function(bookId) {
    if (confirm('确定要删除这本书吗？')) {
        bookshelf = bookshelf.filter(b => b.id !== bookId);
        delete readingProgress[bookId];
        saveBookshelf();
        saveReadingProgress();
        renderBookshelf();
    }
}

// 阅读进度保存（段落级 + 滚动位置兜底；伪装态下跳过保存）
function saveReadingProgress() {
    if (!currentBook || bossModeActive) return;

    readingProgress[currentBook.id] = {
        chapterIndex: currentChapterIndex,
        paragraphIndex: getParagraphIndex(),
        scrollPosition: mainContent ? mainContent.scrollTop : 0,
        timestamp: new Date().toISOString()
    };

    localStorage.setItem('moyuReaderProgress', JSON.stringify(readingProgress));
}

// 计算当前视口顶部对应的段落索引，用于段落级进度恢复
function getParagraphIndex() {
    if (!content || !mainContent) return null;
    const paras = content.children;
    if (!paras.length) return null;
    const st = mainContent.scrollTop;
    for (let i = 0; i < paras.length; i++) {
        if (paras[i].offsetTop > st) return Math.max(0, i - 1);
    }
    return paras.length - 1;
}

function loadReadingProgress() {
    const saved = localStorage.getItem('moyuReaderProgress');
    log('加载阅读进度，保存的数据:', saved);

    if (saved) {
        try {
            readingProgress = JSON.parse(saved);
            log('阅读进度包含的书籍:', Object.keys(readingProgress));
        } catch (e) {
            console.error('解析阅读进度失败:', e);
            readingProgress = {};
        }
    }
}

// 设置滚动监听
let scrollTimeout = null;
let scrollCheckEnabled = false;
let lastWheelEvent = 0;
let wheelDeltaY = 0;

function setupScrollListener() {
    if (!mainContent) return;

    // 鼠标滚轮事件 - 上滑顶部回上一章；底部二次滚动确认后翻下一章
    mainContent.addEventListener('wheel', (e) => {
        // 伪装态 / 滚动恢复期完全忽略滚轮，防止章节索引被误改
        if (!scrollCheckEnabled || bossModeActive || !currentBook) return;

        const now = Date.now();
        const timeSinceLastWheel = now - lastWheelEvent;

        // 累积滚轮值
        wheelDeltaY += e.deltaY;

        // 防抖处理，避免频繁切换
        if (timeSinceLastWheel > 200) {
            // 章节底部：继续下滑超过阈值才翻章，保证最后一屏看得完
            if (atBottomState && e.deltaY > 0) {
                bottomWheelAccum += e.deltaY;
                if (bottomWheelAccum > 150 && currentChapterIndex < chapters.length - 1) {
                    currentChapterIndex++;
                    renderChapter();
                    bottomWheelAccum = 0;
                    wheelDeltaY = 0;
                }
            } else if (e.deltaY < 0 && mainContent.scrollTop < 50 && currentChapterIndex > 0) {
                // 上滑：deltaY为负值，且在页面顶部附近，累积上滑距离超过阈值
                if (Math.abs(wheelDeltaY) > 100) {
                    currentChapterIndex--;
                    renderChapter();
                    wheelDeltaY = 0; // 重置累积值
                }
            } else if (e.deltaY > 0) {
                // 下滑时重置累积值
                wheelDeltaY = Math.min(0, wheelDeltaY);
            }

            // 定期重置累积值
            if (Math.abs(wheelDeltaY) < 50 && Math.abs(e.deltaY) < 50) {
                wheelDeltaY = 0;
            }
        }

        lastWheelEvent = now;
    }, { passive: true });

    // 滚动事件 - 底部状态检测 + 进度条 + 保存进度
    mainContent.addEventListener('scroll', () => {
        if (!scrollCheckEnabled) return;

        updateGlobalProgress();
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            checkScrollToBottom();
            saveReadingProgress(); // 自动保存阅读进度
        }, 300);
    });
}

// 滚动状态检测：到底显示提示（等待二次滚动翻章）
function checkScrollToBottom() {
    if (!mainContent) return;

    const nearBottom = mainContent.scrollHeight - mainContent.scrollTop - mainContent.clientHeight < 60;
    if (nearBottom !== atBottomState) {
        atBottomState = nearBottom;
        bottomWheelAccum = 0;
        showNextHint(nearBottom);
    }
}

// 显示/隐藏"二次滚动翻章"提示（最后一章不显示）
function showNextHint(visible) {
    if (!nextHint) return;
    nextHint.classList.toggle('visible', visible && currentChapterIndex < chapters.length - 1);
}

// 更新视口底部的全书进度条（当前章 + 章内滚动比例）
function updateGlobalProgress() {
    if (!globalProgressFill || !chapters.length || !mainContent) return;
    const max = mainContent.scrollHeight - mainContent.clientHeight;
    const inChapter = max > 0 ? Math.min(mainContent.scrollTop / max, 1) : 0;
    const ratio = (currentChapterIndex + inChapter) / chapters.length;
    globalProgressFill.style.width = (ratio * 100).toFixed(2) + '%';
}

// 章节名伪装：下拉框显示成源码文件路径，避免暴露书名/章节信息
function disguiseChapterTitle(index) {
    return 'src/chapter_' + String(index + 1).padStart(3, '0') + '.ts';
}

// 更新章节选择器
function updateChapterSelect() {
    if (!chapterSelect || !chapters.length) {
        return;
    }

    // 批量构建（长篇小说上千章时避免逐个 append 造成卡顿）
    chapterSelect.innerHTML = '';
    const frag = document.createDocumentFragment();
    chapters.forEach((chapter, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = settings.stealthNames ? disguiseChapterTitle(index) : chapter.title;
        frag.appendChild(option);
    });
    chapterSelect.appendChild(frag);
}

// 程序化滚动定位：绕过 CSS scroll-behavior:smooth 动画。
// 平滑动画期间 scrollCheckEnabled 恢复后会产生中间 scroll 事件，
// 导致错误进度被保存、且用户输入会中断动画停在半路
function scrollToInstant(el, top) {
    if (!el) return;
    const prev = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollTop = top;
    el.style.scrollBehavior = prev;
}

// 按段落渲染章节内容（段落级进度定位依赖段落元素）
function renderParagraphs(text) {
    content.innerHTML = '';
    const frag = document.createDocumentFragment();
    text.split(/\n+/).map(s => s.trim()).filter(Boolean).forEach(p => {
        const div = document.createElement('div');
        div.className = 'para';
        div.textContent = p;
        frag.appendChild(div);
    });
    content.appendChild(frag);
}

// 渲染章节（异步：正文由主进程按需提供，单章仅几 KB）
async function renderChapter() {
    if (!currentBook || !chapters.length || bossModeActive) return;

    const seq = ++renderSeq; // 竞态保护：快速切章时丢弃过期响应
    const chapter = chapters[currentChapterIndex];
    if (!chapter) {
        console.error('Chapter not found at index:', currentChapterIndex);
        return;
    }

    if (chapterInfo) {
        chapterInfo.textContent = `${currentChapterIndex + 1} / ${chapters.length}`;
    }

    // 更新章节选择器
    if (chapterSelect) {
        chapterSelect.value = currentChapterIndex;
    }

    // 更新按钮状态
    prevChapterBtn.disabled = currentChapterIndex === 0;
    nextChapterBtn.disabled = currentChapterIndex === chapters.length - 1;

    // 按需向主进程请求本章正文
    if (content && currentBook.filepath) {
        content.innerHTML = '';
        try {
            const text = await ipcRenderer.invoke('novel:get-chapter', currentBook.filepath, currentChapterIndex);
            if (seq !== renderSeq) return; // 已切到其他章节，丢弃本次响应
            if (text != null) {
                renderParagraphs(text);
            } else {
                content.textContent = '内容加载失败，请检查源文件是否存在。';
            }
        } catch (error) {
            if (seq !== renderSeq) return;
            console.error('加载章节内容失败:', error);
            content.textContent = '内容加载失败。';
        }
    }

    // 处理滚动：恢复上次进度（段落级优先）或回到顶部
    if (mainContent) {
        if (pendingScroll) {
            // 恢复滚动期间禁用底部检测，避免误触发翻章
            scrollCheckEnabled = false;
            const paras = content ? content.children : null;
            if (pendingScroll.paraIndex != null && paras && pendingScroll.paraIndex < paras.length) {
                scrollToInstant(mainContent, paras[pendingScroll.paraIndex].offsetTop);
            } else {
                scrollToInstant(mainContent, pendingScroll.scrollTop || 0);
            }
            pendingScroll = null;
            setTimeout(() => { scrollCheckEnabled = true; }, 300);
        } else {
            scrollToInstant(mainContent, 0);
            scrollCheckEnabled = true;
        }
    }

    // 重置底部状态与提示，更新进度条
    atBottomState = false;
    bottomWheelAccum = 0;
    showNextHint(false);
    updateGlobalProgress();

    // 保存阅读进度
    saveReadingProgress();
}

// ==================== 老板键伪装 ====================
// 生成一段以假乱真的前端构建日志
function buildFakeLogLines() {
    const files = [
        'src/main.ts', 'src/app.vue', 'src/router/index.ts',
        'src/store/modules/user.ts', 'src/api/request.ts',
        'src/components/DataTable/index.vue', 'src/components/ChartPanel/index.vue',
        'src/utils/format.ts', 'src/hooks/useAuth.ts',
        'src/views/dashboard/index.vue', 'src/directive/permission.ts',
        'src/api/modules/order.ts', 'src/layout/index.vue'
    ];
    const tags = ['INFO', 'INFO', 'INFO', 'DEBUG'];
    const lines = [];
    const start = Date.now() - 4200;
    const total = 34 + Math.floor(Math.random() * 12);
    for (let i = 0; i < total; i++) {
        const t = new Date(start + i * 120 + Math.floor(Math.random() * 60));
        const ts = t.toTimeString().slice(0, 8) + '.' + String(t.getMilliseconds()).padStart(3, '0');
        const tag = tags[i % tags.length];
        const f = files[Math.floor(Math.random() * files.length)];
        const action = i === 0
            ? 'vite v5.4.2 building for production...'
            : `transforming (${i + 1}) ${f}`;
        lines.push(`[${ts}] [${tag}] ${action}`);
    }
    lines.push(`[${new Date().toTimeString().slice(0, 8)}] [INFO] \u2713 built in ${(3 + Math.random() * 2).toFixed(2)}s`);
    return lines;
}

// 老板键：进入伪装态（内容替换为构建日志），再按恢复当前章节
function toggleBossMode() {
    bossModeActive = !bossModeActive;
    if (bossModeActive) {
        // 记录当前阅读位置（段落级优先），退出伪装时精确恢复
        bossReturnScroll = {
            paraIndex: getParagraphIndex(),
            scrollTop: mainContent ? mainContent.scrollTop : 0
        };
        if (settingsPanel) settingsPanel.classList.remove('active');
        showNextHint(false);
        // 伪装期间禁用滚动检测，避免误触发翻章/提示
        scrollCheckEnabled = false;
        document.body.classList.add('boss-mode');
        if (content) {
            content.innerHTML = '';
            const frag = document.createDocumentFragment();
            buildFakeLogLines().forEach(line => {
                const div = document.createElement('div');
                div.className = 'para';
                div.textContent = line;
                frag.appendChild(div);
            });
            content.appendChild(frag);
        }
        if (mainContent) scrollToInstant(mainContent, 0);
        if (chapterInfo) chapterInfo.textContent = 'build ok';
    } else {
        document.body.classList.remove('boss-mode');
        // 同一会话窗口尺寸未变，直接用 scrollTop 精确恢复（含段落内偏移）；
        // paraIndex 仅作为跨会话/窗口尺寸变化时的兜底
        if (bossReturnScroll) {
            pendingScroll = { paraIndex: null, scrollTop: bossReturnScroll.scrollTop };
        }
        bossReturnScroll = null;
        renderChapter();
    }
}

// 应用设置
function applySettings() {
    const mainContent = document.querySelector('.main-content');
    const reader = document.querySelector('.reader');

    // 强制使用深色背景
    const darkBg = 'rgba(30, 30, 30, 0.95)';

    // 应用背景设置
    if (settings.bgImage && !settings.transparentMode) {
        mainContent.style.backgroundImage = `url(${settings.bgImage})`;
    } else {
        mainContent.style.backgroundImage = 'none';
        mainContent.style.backgroundColor = darkBg;
    }

    mainContent.style.backgroundSize = `${settings.bgScale}% auto`;
    mainContent.style.backgroundPosition = 'center';
    mainContent.style.backgroundRepeat = 'no-repeat';
    mainContent.style.backdropFilter = `blur(${settings.bgBlur}px)`;

    // 确保阅读器区域也是深色背景
    if (reader) {
        reader.style.backgroundColor = 'transparent';
    }

    // 应用文字设置 - 强制使用深色文本
    content.style.fontSize = settings.fontSize + 'px';
    content.style.color = '#858585';  // 强制使用 VS Code 深色主题的注释颜色
    content.style.lineHeight = settings.lineHeight;
    content.style.backgroundColor = 'transparent !important';

    // 应用窗口透明度
    ipcRenderer.send('window-set-opacity', settings.windowOpacity / 100);
}

// 辅助函数：十六进制转RGBA
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 重置所有设置
function resetAllSettings() {
    settings = {
        bgImage: null,
        bgScale: 100,
        bgBlur: 0,
        fontSize: 14,
        textColor: '#858585',
        lineHeight: 1.6,
        bgColor: '#1e1e1e',
        windowOpacity: 100,
        contentOpacity: 95,
        transparentMode: false
    };
    
    // 重置UI控件
    windowOpacityInput.value = 100;
    document.getElementById('opacityValue').textContent = '100%';
    transparentModeCheckbox.checked = false;
    bgScaleInput.value = 100;
    document.getElementById('scaleValue').textContent = '100%';
    bgBlurInput.value = 0;
    document.getElementById('blurValue').textContent = '0px';
    fontSizeInput.value = 14;
    quickFontSize.value = 14;
    document.getElementById('fontSizeValue').textContent = '14px';
    textColorInput.value = '#858585';
    lineHeightInput.value = 1.6;
    document.getElementById('lineHeightValue').textContent = '1.6';
    bgColorInput.value = '#1e1e1e';
    contentOpacityInput.value = 95;
    document.getElementById('contentOpacityValue').textContent = '95%';
    if (stealthNamesInput) stealthNamesInput.checked = true;
    settings.stealthNames = true;

    applySettings();
    saveSettings();
    
    // 重置窗口透明度
    ipcRenderer.send('window-set-opacity', 1);
    ipcRenderer.send('window-toggle-transparent', false);
}

// 保存设置到本地存储
function saveSettings() {
    localStorage.setItem('moyuReaderSettings', JSON.stringify(settings));
}

// 从本地存储加载设置
function loadSettings() {
    const saved = localStorage.getItem('moyuReaderSettings');
    if (saved) {
        try {
            const loaded = JSON.parse(saved);
            settings = { ...settings, ...loaded };

            // 强制确保所有设置都是深色主题
            if (!settings.bgColor || settings.bgColor === '#ffffff' || settings.bgColor === '#fff' || settings.bgColor.includes('255,255,255')) {
                settings.bgColor = '#1e1e1e';
            }
            // 强制确保文本颜色是深色
            if (!settings.textColor || settings.textColor === '#ffffff' || settings.textColor === '#fff' || settings.textColor === '#c9d1d9') {
                settings.textColor = '#858585';
            }

            // 更新UI控件的值
            windowOpacityInput.value = settings.windowOpacity;
            document.getElementById('opacityValue').textContent = settings.windowOpacity + '%';
            transparentModeCheckbox.checked = settings.transparentMode;
            bgScaleInput.value = settings.bgScale;
            document.getElementById('scaleValue').textContent = settings.bgScale + '%';
            bgBlurInput.value = settings.bgBlur;
            document.getElementById('blurValue').textContent = settings.bgBlur + 'px';
            fontSizeInput.value = settings.fontSize;
            quickFontSize.value = settings.fontSize;
            document.getElementById('fontSizeValue').textContent = settings.fontSize + 'px';
            textColorInput.value = '#858585';  // 强制更新为深色
            lineHeightInput.value = settings.lineHeight;
            document.getElementById('lineHeightValue').textContent = settings.lineHeight;
            bgColorInput.value = '#1e1e1e';  // 强制更新为深色
            contentOpacityInput.value = settings.contentOpacity;
            document.getElementById('contentOpacityValue').textContent = settings.contentOpacity + '%';
            if (stealthNamesInput) stealthNamesInput.checked = settings.stealthNames !== false;

            // 应用窗口设置
            ipcRenderer.send('window-set-opacity', settings.windowOpacity / 100);
            ipcRenderer.send('window-toggle-transparent', settings.transparentMode);
        } catch (e) {
            console.error('加载设置失败:', e);
        }
    }
}

// 启动应用
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
