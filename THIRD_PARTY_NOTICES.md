# Credits and third-party notices

These notices describe third-party components. They do not assign a new license to the team's original application code.

| Component | Version/source | License and notice |
| --- | --- | --- |
| Three.js | 0.180.0 | MIT; [included notice](dist/vendor/THREE-LICENSE.txt). |
| Transformers.js | 2.17.2, Hugging Face/Xenova | Apache-2.0; [included license](dist/vendor/ai/TRANSFORMERS-LICENSE.txt). |
| ONNX Runtime Web | 1.14.0, Microsoft | MIT; [included notice](dist/vendor/ai/ONNX-RUNTIME-LICENSE.txt). |
| SlimSAM | [Xenova/slimsam-77-uniform](https://huggingface.co/Xenova/slimsam-77-uniform), revision `5850ab45f587c112167512ffef949107115e26a0` | Apache-2.0; [model license](dist/models/slimsam/LICENSE.txt) and [weight provenance](dist/models/slimsam/provenance.json). Based on SlimSAM and Segment Anything; ONNX conversion provided by Xenova/Hugging Face. |
| Azure Storage SDK | `@azure/storage-blob` 12.27.0, Microsoft | MIT; distributed through npm with its package license. Exact dependency tree is in `api/package-lock.json`. |

**AI assistance:** OpenAI Codex assisted research, code, design iteration, and documentation. ImageGen produced Denim repair, Autumn linen, and School-day cotton. Their prompts and generation metadata appear in [sample provenance](dist/assets/sample-provenance.json). Earth & olive, Coastal remnants, and Quiet neutrals are procedural illustrations. None of these synthetic examples establishes physical measurement accuracy.

**Team:** Oddment Guild — Siddhanth K Jain, Adithya P, Kamma Rohan, and Dinesh Kulkarni.
