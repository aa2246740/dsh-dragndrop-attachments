# DSH DragNDrop Attachments

DeepSeek Harness 0.1.2-rc.1 插件。把文件、Finder 文件夹、Office 文档和 ZIP 拖进会话，在本机建索引，再给模型工具去读指定行、区间、幻灯片、备注或压缩包条目。

![架构图](docs/assets/dsh-dragndrop-architecture.png)

图片预处理改编自 [OpenAI Codex 的 prompt-image 逻辑](https://github.com/openai/codex/tree/main/codex-rs/utils/image)，Rust 译成 TypeScript 后接到 DSH 原生图片附件。

可拖 PNG、JPEG、WebP、GIF、DOCX、XLSX、PPTX、CSV、常见文本和代码、ZIP、Finder 文件夹。模型用 `list_attachments` / `read_attachment` 按 `attachment_id` 读，不要用 bash 去磁盘猜附件位置。

详细使用见 [USER_GUIDE.zh-CN.md](USER_GUIDE.zh-CN.md)。

## 安装

```sh
dsh plugin --profile web add github:aa2246740/dsh-dragndrop-attachments
```

或本地 clone：

```sh
git clone https://github.com/aa2246740/dsh-dragndrop-attachments.git
dsh plugin --profile web add ./dsh-dragndrop-attachments
```

然后重启这个 DSH Host，刷新页面。

```sh
dsh plugin --profile web remove dsh-dragndrop-attachments
```

## 本机数据

非图片附件在 `~/.dsh/dragndrop-attachments/v1`。浏览器拖放不会把 Finder 原始绝对路径暴露给网页。模型只看到 `attachment_id`。附件正文标成不可信用户数据。若本机还有早期预览版 `~/.dsh/codex-attachments/v1`，会继续用它。

Office 随包固定 OfficeCLI 1.0.144（macOS arm64），校验见 `vendor/officecli/manifest.json`。

## 开发

```sh
pnpm install --ignore-workspace --frozen-lockfile
pnpm check
```

第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
