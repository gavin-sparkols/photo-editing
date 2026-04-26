# 图片可编辑

在浏览器里对幻灯片 / 海报类图片做 **OCR 识别**，在**原图坐标**上直接**编辑文字框**（移动、缩放、改字、对齐、批量框选），并导出 **JSON**、合成 **PNG** 或 **PPTX**。适合抹字底图 + 可编辑字层的修图工作流。

## 功能概览

- **上传与识别**：多图上传，本机调用 PaddleOCR，返回字框 `bbox`、文字、颜色、字号等布局 JSON。
- **画布编辑**：自由平移/缩放画布；字框拖动、角点缩放；双击进入编辑；多选（`Ctrl`/`⌘` 点选、`Alt`+拖矩形框选）后批量改字号、对齐、删除。
- **底图切换**：默认使用「抹字填充图」编辑；可在隐藏选项中切回原图对照（见 `index.html` 中 `chkUseFilled`）。
- **导出**：下载批量 JSON、逐页合成 PNG、一键 **PPTX**（需安装 `python-pptx`）。
- **页序**：右侧缩略条排序、定位；支持在页序栏 **追加图片**（不清空已有页）。

## 环境要求

- Python **3.9+**（与当前依赖兼容即可）
- 首次运行 OCR 会下载模型，请保证磁盘与网络可用。

## 安装

在项目根目录执行：

```bash
pip install -r requirements.txt
```

主要依赖：`paddleocr`、`flask`、`opencv-python`、`pillow`、`python-pptx` 等。若仅需跑服务而不导出 PPT，可暂时不装 `python-pptx`，但「下载 PPTX」接口会返回提示安装。

## 运行

```bash
python3 editor_server.py
```

浏览器打开：**http://127.0.0.1:7777/**

## 使用说明（简要）

1. 左侧 **选择图片** → **开始识别**。
2. 在中间画布选中字框，用顶部工具栏调字号、对齐（单框时：焦点在字框内为段落对齐；仅选框时为相对整图的水平位置对齐）。
3. 右侧 **页序** 可切换页、拖排序；底部 **＋ 添加图片** 或拖入文件可追加新页并识别。
4. **导出**：侧栏可下载 JSON、PNG；PPTX 需本机识别产生的 `/api/file/...` 底图路径。

## API（本机服务）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/ocr` | 表单字段 `image` 上传图片，返回 `layout`、`imageUrl`、`filledImageUrl` 等 |
| `GET` | `/api/file/<name>` | 读取上传目录中的临时图片 |
| `POST` | `/api/export_pptx` | JSON body：`pages`、`background_files` 等与前端约定字段，返回 `.pptx` 文件 |

## 项目结构（部分）

```
图片可编辑/
├── editor_server.py    # Flask 静态站 + OCR + PPTX 导出
├── ocr_for_web.py      # OCR 与布局入口
├── pptx_export.py      # PPTX 生成
├── web/static/         # 前端 HTML / CSS / JS
├── requirements.txt
└── LICENSE             # MIT，商用须保留声明（见 LICENSE 中文节）
```

## 开源协议

本项目以 **MIT License** 发布，详见根目录 [`LICENSE`](./LICENSE)。

**商用或再分发时**，须在副本中保留版权声明与许可全文，并建议在用户可见的关于/说明中注明项目名称与来源（详见 LICENSE 中文说明）。

## 常见问题

- **识别很慢 / 首次很慢**：多为模型下载与冷启动，属正常现象。
- **PPTX 导出失败**：确认已 `pip install python-pptx`，且页面上的图来自本机识别（非纯 blob 本地预览）。

## 致谢

文字检测与识别能力来自 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) 等开源生态。
