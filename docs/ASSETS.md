# Assets and licenses

SUITS must use original, CC0, or attribution-compatible assets. New external artifacts may not be committed until their source and license are recorded here. Model weights, generated audio, and user uploads are intentionally excluded from Git. The pre-Build Week favicon with unknown provenance was removed from the runtime tree during Milestone 9 and remains recoverable from git history.

## Local speech model artifacts

These model files are downloaded only through the explicit local setup workflow into the user's configured Hugging Face cache. They are not bundled with the application or committed to the repository.

| Asset | Pinned source | Files used | License | Repository treatment |
| --- | --- | --- | --- | --- |
| NVIDIA Nemotron streaming English 0.6B STT | [`nvidia/nemotron-speech-streaming-en-0.6b@df1f0fe`](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b/tree/df1f0fe9dfdf05152936192b4c8c7653d53bf557) | Config, generation config, safetensors weights, processor, and tokenizer files | [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/) | Explicit local cache download; never committed |
| Kokoro 82M TTS and three configured voice tensors | [`hexgrad/Kokoro-82M@f3ff357`](https://huggingface.co/hexgrad/Kokoro-82M/tree/f3ff3571791e39611d31c381e3a41a3af07b4987) | Config, `kokoro-v1_0.pth`, `am_michael`, `bm_george`, and `af_heart` voices | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) | Explicit local cache download; never committed |

The full immutable revisions and download allowlists are documented in [LOCAL_SPEECH.md](./LOCAL_SPEECH.md). Operators are responsible for reviewing the linked licenses for their use case.

## Generated audio

The local speech companion synthesizes PCM in memory. Its canonical “Objection!”, “Sustained.”, and “Overruled.” reaction clips are prewarmed into an immutable in-memory cache and are not written to the repository or persisted by the service.

## Application typography and icon

| Asset | Source and use | Creator | License/provenance | Repository treatment |
| --- | --- | --- | --- | --- |
| Geist Sans and Geist Mono | [`next/font/google` imports in `src/app/layout.tsx`](../src/app/layout.tsx); canonical project: [`vercel/geist-font`](https://github.com/vercel/geist-font) | Vercel in collaboration with basement.studio; the upstream repository also credits Andrés Briganti | [SIL Open Font License 1.1](https://github.com/vercel/geist-font/blob/main/LICENSE.txt) | Resolved/optimized by the pinned Next.js build; no source font binary is committed. The exact fetched font artifact/hash is not separately pinned in this repository. |
| SUITS courthouse mark | [`src/app/icon.svg`](../src/app/icon.svg) | Original SUITS implementation assembled from simple SVG paths | None; repository-authored | Runtime application icon. The unknown-provenance pre-Build Week `favicon.ico` was removed without rewriting its git history. |

## Courtroom visual and animation assets

The initial courtroom is generated entirely from repository-authored geometry and materials. It does not load an external model, texture, HDR environment, animation, or sound effect.

| Asset | Source | Creator and method | External inputs | License/attribution | Repository treatment |
| --- | --- | --- | --- | --- | --- |
| Procedural courtroom room, furniture, display, and stylized character figures | `src/components/courtroom/courtroom-canvas.tsx` and `courtroom-stage.module.css` | Original SUITS implementation, assembled from Three.js primitives | None | Repository-authored; no third-party attribution required. The repository does not yet declare a project-wide license. | TypeScript and CSS only; no binary asset is committed |

## Visual verification artifacts

The 24 tracked PNG files under `tests/e2e/courtroom-visual-atlas.spec.ts-snapshots/` are Windows/Chromium regression baselines generated from the repository-authored procedural scene by `npm run test:e2e -- tests/e2e/courtroom-visual-atlas.spec.ts --update-snapshots`. They are test evidence, not runtime-delivered art or a substitute for third-party asset provenance.

Their combined size, comparison threshold, and aggregate digest are recorded in [`docs/build-week/VERIFICATION.md`](./build-week/VERIFICATION.md). Playwright WebM recordings remain ignored generated evidence and are not committed as product assets.

Any future production model, texture, character rig, animation, HDR environment, font file, or sound effect must record its creator, canonical source URL, exact version/file, license, required attribution, and modifications here before it is introduced.
