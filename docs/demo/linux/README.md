# Linux notes (not a recording host)

`install.sh` at the repo root exits with `INSTALL_FAILED: 当前发布包只支持 macOS。` OfficeCLI is darwin-arm64 only.

`docs/demo/linux/install.sh` is the experiment we ran on a Cloud Agent: stub `externalClientBundle`, `pnpm build`, `dsh plugin --profile web add`, insert the host row. Official `dsh web` then served `http://127.0.0.1:3080` and listed `dsh-dragndrop-attachments` in `window.__DSH_BOOT__`.

The client UI still did not activate. Page-wide drop, `+` → 文件和文件夹, and folder/ZIP cards never mounted. A drop was handled by native DSH. Screenshots: [proof](proof).

Do not use this directory to mint `docs/demo/out/plugin-demo.mp4`. Record on a Mac. [RECORDING.md](../RECORDING.md).
