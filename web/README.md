# Deckly PPT Agent 前端

这是 Deckly PPT Agent 的独立前端源码，使用 React、TypeScript 和 Vite 编写。当前为本地编辑模式，不依赖后端即可运行。

## 启动

```powershell
npm install
npm run dev
```

打开 http://localhost:3000。

## 已包含功能

- 新建项目后进入居中的 AI 创作页
- Agent 生成后切换到画布编辑器，聊天框移动到右侧
- 文本、形状和本地图片插入与编辑
- 元素拖动、缩放、旋转、水平/垂直翻转
- AI 对话框支持上传附件（当前仅本地记录文件信息）
- Deck IR 自动保存到浏览器 localStorage
- 导出当前设计稿 JSON

## 构建

```powershell
npm run build
```
