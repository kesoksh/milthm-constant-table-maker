# Milthm Constant Table Maker

> Milthm 定数表编辑器 —— 纯前端静态应用：无构建、无后端、双击即用。

**在线使用**：<https://kesoksh.github.io/milthm-constant-table-maker/>（GitHub Pages）

## 本地使用

1. 下载仓库 zip 解压，或 `git clone https://github.com/kesoksh/milthm-constant-table-maker.git`
2. 双击 `index.html` 直接打开（`file://` 协议完整可用，无需服务器）
3. 数据保存在当前浏览器中（localStorage / IndexedDB），换浏览器或清缓存前请先「导出 JSON」

## 快速上手

1. 左侧「+ 添加页面」新建正文页，填入定数整数部分（如 `13`）
2. 页内「+ 添加区块」→「+ 添加小数行」，从 `res/illustration/` 拖入曲绘，或点 `+` 手动添加曲目
3. 顶栏「保存」即写入浏览器；「导出 JSON」做备份，「导入 JSON」可恢复
4. 右侧「查看器预览」实时渲染，「导出当前页 / 导出全部」输出 PNG（可选 2x）

## 三种页面类型

| 类型 | 说明 |
|---|---|
| 正文页 | 固定整数 + 区块 + 小数行，构成表格主体 |
| 特殊页（多指定数） | 一首曲多条不同定数（如 `15.75`、`3.25*`），定数原样显示 |
| 新定数页 | 新曲定数面板；「套」可从正文 / 特殊 / 新定数页套用曲目全部谱面定数（含多指定数与难度标签），难度后可打标签（如 `（追加）`） |

> 右侧预览中**点击任意曲绘**即可定位到编辑器中的对应条目（上表三种页面均支持）。

## 功能一览

- **搜索**：曲名 / 定数全局搜索，一键跳转
- **体检**：扫描缺图、曲绘映射缺失等问题，支持一键修复
- **替换**：批量文本替换（先预览命中次数再执行）
- **快照**：最多 10 个历史快照，防误操作；配合撤销 / 重做使用
- **JSON**：导入 / 导出 / 原始数据查看（可选包含图片 base64）
- **预加载**：导入数据或图片资源后可选择先加载全部图片（实时进度条），完成后自动进入页面，避免预览卡顿；勾选后可记住选择
- **预览定位**：点击右侧预览中的曲绘，一键跳转到编辑器中对应条目并高亮闪烁，方便直接修改
- **定数显示**：正文与新定数的定数数值保留 1 位小数；多指定数（`3.25*`、`15.75` 等）原样显示，输入也按此规则保存
- **PNG 导出**：dom-to-image 渲染，样式与预览一致

## 项目结构

```
├── res/illustration/       曲绘（含 manifest.js / manifest.json 清单）
├── index.html              入口（head 引用 CSS，body 末尾引用 JS）
├── css/
│   ├── viewer.css          查看器卡片与导出 PNG 样式
│   └── style.css           编辑器界面与弹窗样式
├── js/
│   ├── vendor.js           dom-to-image 库
│   ├── compat.js           dom-to-image 的 file:// 兼容补丁
│   ├── viewer.js           只读渲染层（预览与导出共用）
│   ├── storage.js          localStorage + IndexedDB 存储层
│   └── main.js             编辑器主逻辑（入口 init()）
└── tools/gen-manifest.ps1  重新生成曲绘清单
```

新增曲绘后，在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/gen-manifest.ps1
```

## 声明

本项目为非官方项目，与 Milthm、Morizero、IteraCoda 无任何关联；曲绘与定数资源来自 Milthm 游戏本体。
