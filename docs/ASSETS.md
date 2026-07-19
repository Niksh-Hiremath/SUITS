# Assets and licenses

SUITS must use original, CC0, or attribution-compatible assets. External artifacts may not be committed until their source and license are recorded here. Model weights, generated audio, and user uploads are intentionally excluded from Git.

## Local speech model artifacts

These model files are downloaded only through the explicit local setup workflow into the user's configured Hugging Face cache. They are not bundled with the application or committed to the repository.

| Asset | Pinned source | Files used | License | Repository treatment |
| --- | --- | --- | --- | --- |
| NVIDIA Nemotron streaming English 0.6B STT | [`nvidia/nemotron-speech-streaming-en-0.6b@df1f0fe`](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b/tree/df1f0fe9dfdf05152936192b4c8c7653d53bf557) | Config, generation config, safetensors weights, processor, and tokenizer files | [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/) | Explicit local cache download; never committed |
| Kokoro 82M TTS and three configured voice tensors | [`hexgrad/Kokoro-82M@f3ff357`](https://huggingface.co/hexgrad/Kokoro-82M/tree/f3ff3571791e39611d31c381e3a41a3af07b4987) | Config, `kokoro-v1_0.pth`, `am_michael`, `bm_george`, and `af_heart` voices | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) | Explicit local cache download; never committed |

The full immutable revisions and download allowlists are documented in [LOCAL_SPEECH.md](./LOCAL_SPEECH.md). Operators are responsible for reviewing the linked licenses for their use case.

## Generated audio

The local speech companion synthesizes PCM in memory. Its canonical “Objection!”, “Sustained.”, and “Overruled.” reaction clips are prewarmed into an immutable in-memory cache and are not written to the repository or persisted by the service.

## Courtroom visual and animation assets

No production courtroom models, textures, character rigs, animations, or sound effects are approved or recorded yet. Add each asset's creator, canonical source URL, exact version/file, license, required attribution, and any modifications before introducing it into the product.

