# DSH DragNDrop Attachments

```sh
dsh plugin --profile web add github:aa2246740/dsh-dragndrop-attachments
```

需要官方 DeepSeek Harness **0.1.5-rc.2**（`dsh` 或 `npx @deepseek-ai/dsh`）。`dsh plugin` 在 `$DSH_HOME/profiles/web` 里跑 **pnpm**，所以 pnpm 必须在 `PATH` 上。装完后重启这个 Host，再刷新页面。这条命令只写 profile，不会热挂正在跑的进程。

仓库已提交编好的 `lib/`，`package.json` 声明了 `dsh.bundle.patch`。`github:` 安装因此不跑 `prepare`，也不需要给 pnpm ≥10 开 `allowBuilds`。

`dsh` 不在 PATH 时：

```sh
npx @deepseek-ai/dsh plugin --profile web add github:aa2246740/dsh-dragndrop-attachments
```

DSH.app 的 `desktop` profile 不能吃 `github:`；请用 `dsh web` 装进 `web` profile。

把文件、Finder 文件夹、Office 文档和 ZIP 拖进会话，在本机建索引，再给模型工具去读指定行、区间、幻灯片、备注或压缩包条目。

![架构图](docs/assets/dsh-dragndrop-architecture.png)

图片预处理改编自 [OpenAI Codex 的 prompt-image 逻辑](https://github.com/openai/codex/tree/main/codex-rs/utils/image)，Rust 译成 TypeScript 后接到 DSH 原生图片附件。

可拖 PNG、JPEG、WebP、GIF、DOCX、XLSX、PPTX、CSV、常见文本和代码、ZIP、Finder 文件夹。模型用 `list_attachments` / `read_attachment` 按 `attachment_id` 读，不要用 bash 去磁盘猜附件位置。

详细使用见 [USER_GUIDE.zh-CN.md](USER_GUIDE.zh-CN.md)。

本机已有 clone 时：

```sh
git clone https://github.com/aa2246740/dsh-dragndrop-attachments.git
dsh plugin --profile web add ./dsh-dragndrop-attachments
```

然后同样重启这个 Host，再刷新页面。

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
