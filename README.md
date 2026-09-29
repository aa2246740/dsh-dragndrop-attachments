# DSH Drag & Drop Attachments

为官方 **DeepSeek Harness 0.2.0-rc.2** 增强文档读取。照常拖文件、粘贴或使用原生附件按钮；图片、文本和 PDF 沿用原生处理，DOCX、XLSX、PPTX、CSV 和 ZIP 自动接入本地解析。无需选择“增强导入”，不修改官方源码。

## 安装

### Web UI

```sh
dsh plugin --profile web add github:aa2246740/dsh-dragndrop-attachments
```

需要官方 `dsh`（也可用 `npx @deepseek-ai/dsh@0.2.0-rc.2`）和 PATH 中的 **pnpm**。等当前任务完成后重启这个 Host，再刷新页面。仓库 main 已包含构建好的 `lib/`，安装不需要编译插件或额外开发工具。

### 官方桌面端 / DSH Studio

打开 **设置 → 插件 → 添加插件**，在“包名或地址”中填入：

```text
github:aa2246740/dsh-dragndrop-attachments
```

也可以从 [最新 Release](https://github.com/aa2246740/dsh-dragndrop-attachments/releases/latest) 下载 `.tgz`，填入该文件的绝对路径。安装后按官方界面提示，等任务完成再退出并重开应用。桌面端使用 `desktop` profile，Web UI 使用 `web` profile；请安装到实际使用的那一端。

## 怎么用

- **文件**：照常拖放、粘贴或用原生附件按钮。桌面端保留原生本地路径引用；Web UI 保留原生上传和会话附件。
- **Word / Excel / PowerPoint / CSV**：Agent 调用 `read` 时自动得到结构目录、预览和定位信息，再按需读表格、公式、幻灯片、备注或文档段落。
- **ZIP**：先列目录，再按条目路径读取文本或代码；不在工作区解压，不自动展开嵌套压缩包。
- **桌面文件夹**：沿用官方目录引用，里面的 Office 文件按路径读取时自动增强。
- **浏览器文件夹**：拖入时自动保存文件夹快照；也可用 `+` 菜单里的“添加文件夹快照”。混合拖入的普通文件仍进入原生附件。文件夹卡片会说明快照内容。
- **历史附件**：1.2.x 上传的附件和文件夹快照继续可读，无需迁移。

已有原生拖放和粘贴不会被插件整体拦截，也不会同时上传两份。插件用官方 `tools/execute` 接口在支持的文档读取前分流，不依靠先触发一次工具错误。损坏、加密、超限或确实不支持的内容仍会返回真实错误，不伪装成功。

## 支持范围

Office 随包固定 **OfficeCLI 1.0.144（macOS Apple Silicon）**。当前完整 Office 解析仅承诺该平台。DOC/XLS/PPT 旧格式、OCR、公式重算和复杂图表视觉理解不在承诺范围；PDF 和图片能力由官方 DSH 提供。

单个增强读取文件最大 50 MiB；展开 ZIP 最大 256 MiB。读取窗口和查询输出有上限，大文件需要分段查询。结果会保留覆盖范围、警告及原始定位符；输出行号是解析结果行号，不能当作 Office 文件的编辑行号。

插件通过当前会话的文件系统读取，保留权限和取消检查。文件内容始终作为不可信用户数据。解析缓存位于 `$DSH_HOME/dragndrop-attachments/v1/native-cache`；原生附件及会话仍由 DSH 管理。旧插件快照保留在同一数据目录，早期 `codex-attachments/v1` 数据仍兼容。

## 更新和卸载

在原来的安装入口再次安装最新包，然后按官方提示重新打开应用。安装成功和运行中加载新版是两步。

Web 卸载：

```sh
dsh plugin --profile web remove dsh-dragndrop-attachments
```

桌面端在设置的插件页面禁用或卸载。禁用后普通拖放仍由原生处理；解析增强、Web 文件夹快照入口和旧附件读取工具停用。卸载不主动删除历史数据。

[使用指南](USER_GUIDE.zh-CN.md) · [更新记录](CHANGELOG.md) · [第三方许可](THIRD_PARTY_NOTICES.md)

## 开发

Node.js 22.19+ / 24+，pnpm。`pnpm install --ignore-workspace --frozen-lockfile` 安装依赖；`pnpm test` 和 `pnpm typecheck` 验证源码。发布包已经构建，普通安装无需执行开发命令。
