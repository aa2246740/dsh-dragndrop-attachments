# Third-party notices

This distribution includes or depends on the following third-party software:

- Portions of the prompt-image preparation logic in `src/engine.js` and `src/client/image.ts` are adapted from [OpenAI Codex](https://github.com/openai/codex), Copyright 2025 OpenAI, Apache License 2.0. The code was translated from Rust to TypeScript and modified for DeepSeek Harness, sharp, and the browser image path. See `NOTICE` and `LICENSES/Apache-2.0.txt`.
- OfficeCLI 1.0.144, source commit `1ced45e900782c5083ed550ddf328ee974e425e7`, Apache License 2.0. The unmodified macOS arm64 executable is under `vendor/officecli/darwin-arm64/officecli`; its upstream notice, license, and SHA-256 manifest are reproduced beside it.
- `fast-xml-parser` 5.3.1, MIT License.
- `fflate` 0.8.2, MIT License.
- `saxes` 6.0.0, ISC License.
- `sharp` 0.35.3, Apache License 2.0.
- React and React DOM 18.2.0, MIT License.
- DeepSeek Harness RC8 packages, used through their published package contracts and peer dependencies; their licenses remain with their respective distributions.

The plugin's original source is MIT licensed. Adapted and third-party portions remain under their stated licenses. This notice does not replace the complete license text included with each installed dependency.
