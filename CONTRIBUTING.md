# Contributing

Contributions should preserve the external-plugin boundary: do not patch DeepSeek Harness source, do not hardcode machine paths, and do not mount the same plugin through two configuration routes.

## Development setup

Requirements:

- macOS arm64 for the bundled Office runtime
- Node.js 22.19 or newer
- pnpm
- a DeepSeek Harness RC8 checkout with `dshx`

```sh
pnpm install --ignore-workspace --frozen-lockfile
DSHX_HARNESS=/absolute/path/to/deepseek-harness pnpm check
/absolute/path/to/deepseek-harness/tools/dshx/skill/dshx/scripts/dshx.sh check dsh-dragndrop-attachments --harness /absolute/path/to/deepseek-harness
```

Add or update focused fixtures for parser behavior. Keep tests deterministic and free of real user documents, session identifiers, credentials, and machine-absolute paths.

## Pull requests

Describe the user-visible behavior, the boundary or parser being changed, the exact verification commands, and any capability still unverified. Build success alone is not runtime acceptance.
