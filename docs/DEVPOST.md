# ReThread — Give every scrap a second life

**Oddment Guild:** Siddhanth K Jain, Adithya P, Kamma Rohan, Dinesh Kulkarni.

## Inspiration

A box of fabric offcuts contains possibilities, but finding something that fits those irregular pieces takes time and guesswork. We imagined a repair café, sewing student, or small upcycling workshop asking: “What can I make from what I already have?”

## What it does

Upload a flat photograph, enter **Photo width**, and select **Analyze & design**. ReThread turns pixels into a material inventory, a feasible cutting layout, and an interactive 3D concept. Explore six illustrative collections, resize designs, change seam allowance and rotation, or exclude an uncertain scrap.

**Find my best fit** computes real layouts for a tote, pouch, and cushion under the same constraints. Complete plans rank first, followed by geometric utilization. Export a calibrated SVG, sewing guide, audit report, or preview.

Image analysis runs on your device. The photograph determines the material masks; removing that stage breaks the core workflow.

## Engineering

We fit unsupervised k-means color clusters to each image in perceptual CIELAB space, estimate background from border colors, and use morphological cleanup and connected components to trace scraps. No pretrained neural detector is used.

The planner searches patch grids and rotations, including seam allowances. Integral-image queries check every cut against conservative usable masks; separate validation checks containment and overlap. An unsuccessful heuristic search is labeled incomplete, without claiming that no arrangement exists.

Utilization is cut area, including seams, divided by usable detected material area. It is a geometric estimate rather than an environmental saving.

The live Azure Functions backend accepts encoded masks and settings, recomputes measurements and plans, and stores receipts in private Blob storage. Random access capabilities support retrieval and deletion without uploading the source photograph. Request limits and failure handling prevent a failed write from appearing saved. All 28 tests pass; durable saves, retrieval, deletion, and access rejection were verified live.

## Design and learning

Three.js connects actual cut assignments to textured 3D concepts with rotation and exploded views. The difficult engineering challenge was preserving the connection between attractive visuals and usable geometry. A bounding box can cross an irregular edge; checking the material mask makes that constraint real.

## Limits and next steps

Generated samples have illustrative scales. Real photos need accurate scene width, separated scraps, a contrasting background, and manual review. Shadows, perspective, similar colors, fabric grain, stretch, and hidden damage affect suitability. The preview is not cloth simulation or a validated sewing pattern.

Next we would test with makers, add perspective and grain constraints, and compare methods on documented photographs.

## Credits

AI coding assistance: OpenAI Codex. Rendering: Three.js, MIT. Persistence: Azure SDK, MIT. Three sample images were made with ImageGen; three are procedural illustrations. Provenance is included.
