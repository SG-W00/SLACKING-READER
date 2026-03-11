// 摸鱼阅读器 - Electron版本
const { ipcRenderer } = require('electron');

// 全局变量
let chapters = [];
let currentChapterIndex = 0;
let isAlwaysOnTop = true;
let autoSaveInterval = null; // 自动保存定时器
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
    transparentMode: false
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

// 初始化
function init() {
    console.log('Initializing app...');
    console.log('mainContent:', mainContent);
    console.log('settingsPanel:', settingsPanel);
    console.log('closeSettingsBtn:', closeSettingsBtn);
    console.log('settingsBtn:', settingsBtn);
    console.log('chapterSelect:', chapterSelect);

    // 强制清除旧的白底设置，使用深色主题
    localStorage.removeItem('moyuReaderSettings');

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

    console.log('App initialized');
}

// 绑定事件
function bindEvents() {
    console.log('Binding events...');
    
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
            console.log('Settings button clicked');
            settingsPanel.classList.toggle('active');
            console.log('Settings panel active:', settingsPanel.classList.contains('active'));
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
    
    // 章节导航
    if (prevChapterBtn) {
        prevChapterBtn.addEventListener('click', () => {
            if (currentChapterIndex > 0) {
                currentChapterIndex--;
                renderChapter();
            }
        });
    }
    
    if (nextChapterBtn) {
        nextChapterBtn.addEventListener('click', () => {
            if (currentChapterIndex < chapters.length - 1) {
                currentChapterIndex++;
                renderChapter();
            }
        });
    }

    // 章节选择器
    if (chapterSelect) {
        chapterSelect.addEventListener('change', (e) => {
            console.log('Chapter select changed:', e.target.value);
            const newIndex = parseInt(e.target.value);
            console.log('Current index:', currentChapterIndex, 'New index:', newIndex);
            console.log('Chapters length:', chapters.length);

            if (isNaN(newIndex)) {
                console.error('Invalid chapter index:', e.target.value);
                return;
            }

            if (newIndex >= 0 && newIndex < chapters.length) {
                currentChapterIndex = newIndex;
                console.log('Switching to chapter:', currentChapterIndex);
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
            console.log('Close settings button clicked');
            settingsPanel.classList.remove('active');
            console.log('Settings panel removed');
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

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' && chapters.length > 0) {
            prevChapterBtn.click();
        } else if (e.key === 'ArrowRight' && chapters.length > 0) {
            nextChapterBtn.click();
        } else if (e.key === 'Escape') {
            settingsPanel.classList.remove('active');
        }
    });

    // 应用关闭前保存进度
    window.addEventListener('beforeunload', () => {
        console.log('应用即将关闭，保存进度');
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

    // 自动导入小说监听
    ipcRenderer.on('auto-import-novels', (event, novels) => {
        console.log('收到自动导入的小说:', novels.length, '本');
        console.log('导入前的书架书籍:', bookshelf.map(b => ({ title: b.title, id: b.id })));

        let importedCount = 0;

        novels.forEach(novel => {
            try {
                const book = parseNovel(novel.content, novel.filename);
                if (book) {
                    addToBookshelf(book, true); // true 表示自动导入
                    importedCount++;
                }
            } catch (error) {
                console.error('导入小说失败:', novel.filename, error);
            }
        });

        // 所有导入完成后显示书架
        if (importedCount > 0) {
            console.log(`成功自动导入/更新 ${importedCount} 本小说`);
            console.log('导入后的书架书籍:', bookshelf.map(b => ({ title: b.title, id: b.id })));
            showBookshelf();

            // 显示导入提示
            setTimeout(() => {
                console.log(`/* 已自动导入 ${importedCount} 本小说 */`);
            }, 500);
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
function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const text = event.target.result;
        const book = parseNovel(text, file.name);
        if (book) {
            addToBookshelf(book);
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

// 解析小说内容
function parseNovel(text, filename) {
    const parsedChapters = [];
    let foundChapters = false;

    // 尝试按章节分割
    const chapterPatterns = [
        /第[0-9零一二三四五六七八九十百千万]+章/g,
        /第[0-9零一二三四五六七八九十百千万]+节/g,
        /Chapter\s+\d+/gi
    ];

    // 尝试第一种模式
    let matches = text.split(chapterPatterns[0]);
    if (matches.length > 1) {
        const titles = text.match(chapterPatterns[0]);
        for (let i = 0; i < matches.length; i++) {
            if (matches[i].trim()) {
                parsedChapters.push({
                    title: titles && titles[i] ? titles[i] : `第${i + 1}部分`,
                    content: matches[i].trim()
                });
            }
        }
        foundChapters = true;
    }

    // 如果没有章节，尝试第二种模式
    if (!foundChapters) {
        matches = text.split(chapterPatterns[1]);
        if (matches.length > 1) {
            const titles = text.match(chapterPatterns[1]);
            for (let i = 0; i < matches.length; i++) {
                if (matches[i].trim()) {
                    parsedChapters.push({
                        title: titles && titles[i] ? titles[i] : `第${i + 1}部分`,
                        content: matches[i].trim()
                    });
                }
            }
            foundChapters = true;
        }
    }

    // 如果还是没有章节，按大段落分割
    if (!foundChapters) {
        const paragraphs = text.split(/\n\n\n+/);
        const chunkSize = 5;

        for (let i = 0; i < paragraphs.length; i += chunkSize) {
            const chunk = paragraphs.slice(i, i + chunkSize).join('\n\n');
            if (chunk.trim()) {
                parsedChapters.push({
                    title: `Chapter ${Math.floor(i / chunkSize) + 1}`,
                    content: chunk.trim()
                });
            }
        }
    }

    // 如果还是只有一章，就整本作为一章
    if (parsedChapters.length === 0) {
        parsedChapters.push({
            title: 'Chapter 1',
            content: text.trim()
        });
    }

    // 返回书籍对象
    const bookTitle = filename.replace('.txt', '');
    // 使用文件名生成固定的 ID，确保同一本书的 ID 不变
    const bookId = 'book_' + filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');

    console.log('解析书籍 - 标题:', bookTitle, 'ID:', bookId, '章节数:', parsedChapters.length);

    return {
        id: bookId,
        title: bookTitle,
        chapters: parsedChapters,
        addedTime: new Date().toISOString()
    };
}

// 书架管理
function loadBookshelf() {
    const saved = localStorage.getItem('moyuReaderBookshelf');
    if (saved) {
        try {
            bookshelf = JSON.parse(saved);
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
        console.log('更新已存在的书籍:', book.title, 'ID:', book.id);
    } else {
        // 添加新书籍
        bookshelf.push(book);
        console.log('添加新书籍:', book.title, 'ID:', book.id);
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
        const progressPercent = progress ? Math.round((progress.chapterIndex + 1) / book.chapters.length * 100) : 0;
        const lastRead = progress ? new Date(progress.timestamp).toLocaleDateString() : '未阅读';

        const bookItem = document.createElement('div');
        bookItem.className = 'book-item';
        bookItem.innerHTML = `
            <button class="delete-book-btn" onclick="event.stopPropagation(); deleteBook('${book.id}')">×</button>
            <div class="book-title">${book.title}</div>
            <div class="book-info">${book.chapters.length} 章节</div>
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
    console.log('Opening book:', bookId);
    const book = bookshelf.find(b => b.id === bookId);
    if (!book) {
        console.error('Book not found:', bookId);
        return;
    }

    console.log('Book found:', book.title, 'Chapters:', book.chapters.length);
    console.log('当前阅读进度对象:', readingProgress);
    console.log('查找书ID的进度:', readingProgress[bookId]);

    currentBook = book;
    chapters = book.chapters;

    // 恢复阅读进度
    const progress = readingProgress[bookId];
    if (progress) {
        currentChapterIndex = Math.min(progress.chapterIndex, chapters.length - 1);
        console.log('恢复阅读进度 - 章节:', currentChapterIndex, '滚动位置:', progress.scrollPosition);
    } else {
        currentChapterIndex = 0;
        console.log('没有找到阅读进度，从第一章开始');
    }

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
    scrollCheckEnabled = true;

    // 恢复滚动位置(使用章节索引而不是绝对位置)
    if (progress && progress.chapterIndex !== undefined) {
        setTimeout(() => {
            // 重新渲染到进度所在的章节
            if (progress.chapterIndex >= 0 && progress.chapterIndex < chapters.length) {
                currentChapterIndex = progress.chapterIndex;
                renderChapter();
            }
        }, 100);
    }

    // 启动自动保存进度定时器（每30秒保存一次）
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }
    autoSaveInterval = setInterval(() => {
        saveReadingProgress();
        console.log('自动保存进度');
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

// 阅读进度保存
function saveReadingProgress() {
    if (!currentBook) {
        console.log('无法保存进度：currentBook 为空');
        return;
    }

    readingProgress[currentBook.id] = {
        chapterIndex: currentChapterIndex,
        scrollPosition: mainContent ? mainContent.scrollTop : 0,
        timestamp: new Date().toISOString()
    };

    const progressStr = JSON.stringify(readingProgress);
    localStorage.setItem('moyuReaderProgress', progressStr);

    console.log('保存阅读进度 - 书籍ID:', currentBook.id, '章节:', currentChapterIndex);
    console.log('保存的进度数据长度:', progressStr.length);
}

function loadReadingProgress() {
    const saved = localStorage.getItem('moyuReaderProgress');
    console.log('加载阅读进度，保存的数据:', saved);

    if (saved) {
        try {
            readingProgress = JSON.parse(saved);
            console.log('解析后的阅读进度:', readingProgress);
            console.log('阅读进度包含的书籍:', Object.keys(readingProgress));
        } catch (e) {
            console.error('解析阅读进度失败:', e);
            readingProgress = {};
        }
    } else {
        console.log('没有找到保存的阅读进度');
    }
}

// 设置滚动监听 - 将整本书作为整体滚动
let scrollTimeout = null;
let scrollCheckEnabled = false;
let isRenderingChapter = false;
let currentBookScrollTop = 0; // 整本书的滚动位置
let chapterOffsets = []; // 每个章节在整本书中的偏移量

function setupScrollListener() {
    if (!mainContent) return;

    // 滚动事件 - 根据滚动位置动态加载章节
    mainContent.addEventListener('scroll', () => {
        if (!scrollCheckEnabled || isRenderingChapter) return;

        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            handleScroll();
            saveReadingProgress();
        }, 100);
    });
}

// 处理滚动事件 - 动态加载章节
function handleScroll() {
    if (!mainContent || isRenderingChapter) return;

    const scrollTop = mainContent.scrollTop;
    const scrollHeight = mainContent.scrollHeight;
    const clientHeight = mainContent.clientHeight;

    // 检查是否滚动到顶部附近,需要加载上一章
    if (scrollTop < 100 && currentChapterIndex > 0) {
        loadPrevChapter();
    }
    // 检查是否滚动到底部附近,需要加载下一章
    else if (scrollHeight - scrollTop - clientHeight < 200) {
        if (currentChapterIndex < chapters.length - 1) {
            loadNextChapter();
        }
    }

    // 更新当前章节索引
    updateCurrentChapterIndex();
}

// 加载上一章并插入到当前内容之前
function loadPrevChapter() {
    isRenderingChapter = true;
    const prevIndex = currentChapterIndex - 1;
    const prevChapter = chapters[prevIndex];

    if (!prevChapter) {
        isRenderingChapter = false;
        return;
    }

    console.log('加载上一章:', prevChapter.title);

    // 保存当前滚动位置
    const currentScrollTop = mainContent.scrollTop;
    const currentContent = content.innerHTML;

    // 创建上一章的内容元素
    const prevChapterEl = document.createElement('div');
    prevChapterEl.className = 'chapter-content';
    prevChapterEl.innerHTML = `
        <h2 class="chapter-title">${prevChapter.title}</h2>
        <div class="chapter-text">${formatContent(prevChapter.content)}</div>
    `;

    // 将上一章插入到当前内容之前
    content.insertBefore(prevChapterEl, content.firstChild);

    // 更新章节偏移量
    chapterOffsets[prevIndex] = currentBookScrollTop;

    // 切换到上一章
    currentChapterIndex = prevIndex;

    // 恢复滚动位置(加上新插入的内容高度)
    setTimeout(() => {
        const prevHeight = prevChapterEl.scrollHeight;
        mainContent.scrollTop = currentScrollTop + prevHeight;
        currentBookScrollTop += prevHeight;

        updateChapterTitle();
        updateChapterSelect();

        isRenderingChapter = false;
        console.log('上一章加载完成,新滚动位置:', mainContent.scrollTop);
    }, 50);
}

// 加载下一章并追加到内容之后
function loadNextChapter() {
    isRenderingChapter = true;
    const nextIndex = currentChapterIndex + 1;
    const nextChapter = chapters[nextIndex];

    if (!nextChapter) {
        isRenderingChapter = false;
        return;
    }

    console.log('加载下一章:', nextChapter.title);

    // 保存当前滚动位置
    const currentScrollTop = mainContent.scrollTop;

    // 创建下一章的内容元素
    const nextChapterEl = document.createElement('div');
    nextChapterEl.className = 'chapter-content';
    nextChapterEl.innerHTML = `
        <h2 class="chapter-title">${nextChapter.title}</h2>
        <div class="chapter-text">${formatContent(nextChapter.content)}</div>
    `;

    // 将下一章追加到内容之后
    content.appendChild(nextChapterEl);

    // 更新章节偏移量
    chapterOffsets[nextIndex] = currentBookScrollTop + content.scrollHeight;

    // 切换到下一章
    currentChapterIndex = nextIndex;

    // 恢复滚动位置
    setTimeout(() => {
        mainContent.scrollTop = currentScrollTop;
        updateChapterTitle();
        updateChapterSelect();

        isRenderingChapter = false;
        console.log('下一章加载完成');
    }, 50);
}

// 格式化内容(将换行转换为段落)
function formatContent(text) {
    return text.split('\n').map(line => {
        const trimmed = line.trim();
        return trimmed ? `<p class="paragraph">${trimmed}</p>` : '';
    }).join('');
}

// 更新当前章节标题
function updateChapterTitle() {
    if (chapterTitle && chapters[currentChapterIndex]) {
        chapterTitle.textContent = chapters[currentChapterIndex].title;
    }
    if (chapterInfo) {
        chapterInfo.textContent = `${currentChapterIndex + 1} / ${chapters.length}`;
    }
}

// 更新章节选择器
function updateChapterSelect() {
    if (!chapterSelect || !chapters.length) {
        console.log('Cannot update chapter select:', { chapterSelect: !!chapterSelect, chaptersLength: chapters.length });
        return;
    }

    console.log('Updating chapter select with', chapters.length, 'chapters');
    chapterSelect.innerHTML = '';
    chapters.forEach((chapter, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = chapter.title;
        chapterSelect.appendChild(option);
    });
    console.log('Chapter select updated');
}

// 渲染章节 - 初始化时加载当前章节及相邻章节
function renderChapter() {
    console.log('Rendering chapter:', currentChapterIndex);
    console.log('Chapters array:', chapters);
    console.log('Content element:', content);

    const chapter = chapters[currentChapterIndex];
    if (!chapter) {
        console.error('Chapter not found at index:', currentChapterIndex);
        console.error('Available chapters:', chapters.map((c, i) => `${i}: ${c.title}`));
        return;
    }

    console.log('Chapter content length:', chapter.content?.length || 0);

    // 清空内容
    content.innerHTML = '';
    chapterOffsets = [];
    currentBookScrollTop = 0;

    // 构建当前章节的内容
    const chapterEl = document.createElement('div');
    chapterEl.className = 'chapter-content';
    chapterEl.innerHTML = `
        <h2 class="chapter-title">${chapter.title}</h2>
        <div class="chapter-text">${formatContent(chapter.content)}</div>
    `;
    content.appendChild(chapterEl);

    // 预加载下一章(如果存在)
    if (currentChapterIndex < chapters.length - 1) {
        const nextChapter = chapters[currentChapterIndex + 1];
        const nextChapterEl = document.createElement('div');
        nextChapterEl.className = 'chapter-content';
        nextChapterEl.innerHTML = `
            <h2 class="chapter-title">${nextChapter.title}</h2>
            <div class="chapter-text">${formatContent(nextChapter.content)}</div>
        `;
        content.appendChild(nextChapterEl);

        // 记录章节偏移量
        chapterOffsets[currentChapterIndex + 1] = chapterEl.scrollHeight;
    }

    // 预加载上一章(如果存在)
    if (currentChapterIndex > 0) {
        const prevChapter = chapters[currentChapterIndex - 1];
        const prevChapterEl = document.createElement('div');
        prevChapterEl.className = 'chapter-content';
        prevChapterEl.innerHTML = `
            <h2 class="chapter-title">${prevChapter.title}</h2>
            <div class="chapter-text">${formatContent(prevChapter.content)}</div>
        `;
        content.insertBefore(prevChapterEl, content.firstChild);

        // 更新滚动位置
        setTimeout(() => {
            mainContent.scrollTop = prevChapterEl.scrollHeight;
            chapterOffsets[currentChapterIndex - 1] = 0;
            chapterOffsets[currentChapterIndex] = prevChapterEl.scrollHeight;
        }, 50);
    }

    // 更新章节标题和信息
    updateChapterTitle();

    // 更新章节选择器
    if (chapterSelect) {
        chapterSelect.value = currentChapterIndex;
        console.log('Chapter select value set to:', chapterSelect.value);
    }

    // 更新按钮状态
    prevChapterBtn.disabled = currentChapterIndex === 0;
    nextChapterBtn.disabled = currentChapterIndex === chapters.length - 1;

    // 保存阅读进度
    saveReadingProgress();

    console.log('章节渲染完成:', chapter.title);
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
