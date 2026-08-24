# Linux Cloud Agent proof: client UI does not activate

These screenshots are from official `dsh web` on this Linux VM after a manual host/boot install (`dsh-dragndrop-attachments` was present in `window.__DSH_BOOT__`).

They are not a product demo.

`01-dsh-web-loads.png` Official DeepSeek Harness Web at `http://127.0.0.1:3080`. Internal testing notice. No plugin dock, no “文件和文件夹” entry.

`02-native-drop-not-plugin.png` A real file DataTransfer drop on that page. Native DSH handled it: “Images cannot be added right now.” The plugin overlay “拖到这里，自动处理图片、文件和文件夹” never appeared. `[data-dsh-dragndrop-attachments="ready"]` stayed absent. No attachment cards.

`./install.sh` on Darwin is the supported path. This Linux path can build a host bundle and put a client row in the boot graph. That is not the same as the client plugin running.
