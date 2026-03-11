# 摸鱼阅读器 - 换机迁移指南

## 环境配置

### 1. 安装 Node.js
访问 [Node.js 官网](https://nodejs.org/) 下载并安装 LTS 版本。

验证安装：
```bash
node -v
npm -v
```

### 2. 克隆项目代码
将整个 `moyu` 文件夹复制到新电脑的任意位置。

### 3. 安装依赖
在项目目录下打开终端，执行：

```bash
npm install
```

### 4. 启动应用
```bash
npm start
```

或使用开发模式（包含开发者工具）：
```bash
npm run dev
```

## 数据迁移

### 阅读进度和书架
阅读器的书架和阅读进度保存在浏览器的 localStorage 中，**换机不会自动迁移**。

如需迁移阅读进度：

1. **旧电脑导出数据**：
   - 打开阅读器，按 F12 打开开发者工具
   - 在 Console 中输入并执行：
   ```javascript
   const bookshelf = localStorage.getItem('moyuReaderBookshelf');
   const progress = localStorage.getItem('moyuReaderProgress');
   console.log('书架数据:', bookshelf);
   console.log('阅读进度:', progress);
   ```
   - 复制输出的 JSON 数据

2. **新电脑导入数据**：
   - 打开阅读器，按 F12 打开开发者工具
   - 在 Console 中输入并执行（替换为实际数据）：
   ```javascript
   localStorage.setItem('moyuReaderBookshelf', '替换为旧电脑的书架JSON');
   localStorage.setItem('moyuReaderProgress', '替换为旧电脑的进度JSON');
   location.reload();
   ```

### 窗口配置
窗口大小和位置保存在 Electron 的用户数据目录中：
- **Windows**: `%APPDATA%/moyu/window-state.json`
- **macOS**: `~/Library/Application Support/moyu/window-state.json`
- **Linux**: `~/.config/moyu/window-state.json`

如需迁移窗口配置，直接复制该文件到新电脑对应目录。

## 常见问题

### 1. 启动失败
- 检查 Node.js 版本是否 >= 14
- 重新安装依赖：`rm -rf node_modules && npm install`

### 2. 窗口位置异常
删除窗口配置文件后重新启动，将恢复默认位置：
```bash
# Windows
del %APPDATA%\moyu\window-state.json

# macOS/Linux
rm ~/Library/Application\ Support/moyu/window-state.json  # macOS
rm ~/.config/moyu/window-state.json  # Linux
```

### 3. 设置重置
如需重置所有设置，在开发者工具 Console 中执行：
```javascript
localStorage.clear();
location.reload();
```

## 快速命令

```bash
# 安装依赖
npm install

# 启动应用
npm start

# 开发模式（带调试工具）
npm run dev

# 打包成可执行文件（需要先配置 electron-builder）
npm run build
```

## 项目结构

```
moyu/
├── main.js           # Electron 主进程
├── app.js            # 渲染进程逻辑
├── index.html        # 主页面
├── style.css         # 样式文件
├── package.json      # 项目配置
├── txt_source/       # 小说文件夹（自动导入）
├── MIGRATION_GUIDE.md # 本文档
└── README.md         # 项目说明
```

## 功能说明

- 📚 书架管理：导入和管理小说文件
- 📖 阅读进度：自动保存阅读位置
- ⬆️⬇️ 滚动翻章：上下滚动切换章节
- 🎨 主题定制：调整字体、颜色、透明度
- 🖥️ 窗口记忆：记住窗口大小和位置
- 🔒 隐身模式：低调的代码编辑器风格
- 🔄 自动导入：启动时自动导入 `txt_source` 文件夹中的小说

## 自动导入功能

### 使用方法

1. 将小说文件（.txt 格式）放入 `txt_source` 文件夹
2. 启动阅读器，会自动导入所有小说到书架
3. 重复的小说会被更新内容

### 注意事项

- 只支持 `.txt` 格式文件
- 小说文件编码建议使用 UTF-8
- 自动导入不会删除已从书架移除的书籍

## 技术栈

- **框架**: Electron
- **语言**: JavaScript
- **样式**: CSS3
- **存储**: localStorage、文件系统

---

如有问题，请检查开发者工具控制台的错误信息。
