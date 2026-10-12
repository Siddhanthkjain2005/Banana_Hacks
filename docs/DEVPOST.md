## Inspiration

Fabric leftovers often outlive the projects that created them. We asked: **“What can I make from what I already have?”** ReThread helps sewing students, repair cafés, and upcycling workshops explore useful designs from irregular offcuts.

## What it does

Upload a flat photograph, enter its scene width, and generate a material inventory, cutting layout, and textured 3D concept. **SlimSAM neural review** refines selected boundaries; **Find my best fit** compares tote, pouch, and cushion layouts.

Explore six labeled synthetic collections, resize designs, adjust seams and rotation, exclude scraps, and inspect exploded assembly or wireframes. Export SVG, JSON, TXT, and PNG files. Save collections locally or archive verified plans privately on Azure.

## How we built it

HTML, CSS, JavaScript, Web Workers, and Three.js provide the studio. CIELAB k-means fits image colors using the objective

$$
J=\sum_{p\in S}\min_k\|\mathrm{Lab}(p)-\mu_k\|_2^2.
$$

Here, S contains sampled pixels and each centroid represents a learned color cluster. Background estimation, morphology, and connected components produce material masks.

SlimSAM’s pretrained INT8 image encoder and prompt/mask decoder run locally. Model weights are pinned and SHA-256 verified. Human-reviewed refinement conservatively intersects their prediction with the existing mask:

$$
M_{\mathrm{refined}}=M_{\mathrm{vision}}\cap M_{\mathrm{SlimSAM}}.
$$

For image width Wpx, measured scene width Wcm, and foreground pixel count N:

$$
s=\frac{W_{\mathrm{px}}}{W_{\mathrm{cm}}},\qquad A_{\mathrm{cm}^2}=\frac{N}{s^2}.
$$

The planner searches patch grids and rotations, includes seam allowance, and validates every rectangle against its assigned scrap’s conservative usable mask:

$$
R_i\subseteq M_{\mathrm{usable},s(i)},\qquad \operatorname{int}(R_i)\cap\operatorname{int}(R_j)=\varnothing\quad(i\ne j).
$$

Here s(i) identifies the assigned scrap; cut interiors cannot overlap. Geometric utilization includes seam allowance and excludes unavailable material:

$$
\eta=100\frac{A_{\mathrm{placed\ cuts}}}{A_{\mathrm{usable\ fabric}}}.
$$

Azure Functions validates encoded masks, recomputes geometry, and commits private Blob receipts. Random capabilities, stored token hashes, input fingerprints, conditional writes, and idempotency keys support protected access and interrupted-save recovery. Photographs remain local.

## Challenges we ran into

Bounding boxes contain empty space around irregular scraps. Pixel containment checks prevented cuts from crossing those gaps. Shadows, similar colors, and calibration errors required conservative boundaries and quality flags. Neural inference needed correct tensor shapes, efficient model loading, and human review. Cloud retries needed durable recovery without duplicate records.

## Accomplishments that we're proud of

**All 38 automated tests pass in GitHub Actions.** Real neural inference changed measured geometry and recalculated a complete 26-cut tote. Public Azure checks verified durable saves, replay recovery, private retrieval, wrong-key rejection, and deletion. Records expire after 30 days.

## What we learned

Useful AI needs traceable consequences: predicted pixels must affect actual cutting decisions. Clear calibration and honest incomplete layouts build trust. Utilization describes geometry; it does not prove environmental savings or physical sewing suitability.

## What's next for Oddment Guild

We want maker trials, perspective correction, grain constraints, and documented textile benchmarks.

**Team:** Siddhanth K Jain, Adithya P, Kamma Rohan, Dinesh Kulkarni.

**Credits:** SlimSAM, Transformers.js, ONNX Runtime, Three.js, Azure SDK, Codex assistance, and ImageGen samples; licenses and provenance are included.
