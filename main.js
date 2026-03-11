// Electron 主进程文件
const { app, BrowserWindow, ipcMain, screen } = require('electron');
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
}

// 自动导入 txt_source 文件夹中的小说
function autoImportNovels() {
    const txtSourcePath = path.join(__dirname, 'txt_source');

    if (!fs.existsSync(txtSourcePath)) {
        console.log('txt_source 文件夹不存在');
        return;
    }

    const files = fs.readdirSync(txtSourcePath);
    const txtFiles = files.filter(file => file.endsWith('.txt'));

    if (txtFiles.length === 0) {
        console.log('txt_source 文件夹中没有 .txt 文件');
        return;
    }

    const novels = [];

    txtFiles.forEach(file => {
        const filePath = path.join(txtSourcePath, file);
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            novels.push({
                filename: file,
                content: content,
                filepath: filePath
            });
        } catch (error) {
            console.error(`读取文件失败: ${file}`, error);
        }
    });

    // 发送自动导入的小说到渲染进程
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

// 所有窗口关闭时退出应用（macOS除外）
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC 通信处理
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
