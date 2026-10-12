## Inspiration

Fabric leftovers often outlive the projects that created them. We asked: **“What can I make from what I already have?”** ReThread helps sewing students, repair cafés, and upcycling workshops explore useful designs from irregular offcuts.

## What it does

Upload a flat photograph, enter its scene width, and generate a material inventory, cutting layout, and textured 3D concept. **SlimSAM neural review** refines selected boundaries; **Find my best fit** compares tote, pouch, and cushion layouts.

Explore six labeled synthetic collections, resize designs, adjust seams and rotation, exclude scraps, and inspect exploded assembly or wireframes. Export SVG, JSON, TXT, and PNG files. Save collections locally or archive verified plans privately on Azure.

The ReThread API goes further:
- **Layout-conditioned concept renders.** The validated cutting plan becomes a design map of measured colours and real seams, and an image model renders the product from it.
- **Zero-waste project chains.** Plan more products from the exact leftovers. On our Denim sample, a tote plus a pouch use 76.6% of the fabric instead of 64.5%.
- **Community fabric pools.** A repair café can combine several donors' photos into one project that none of them could make alone.
- **Colour-aware sewing layouts and printable maker packets.** A PDF with a calibration bar, cut list, cutting diagrams, and steps.
- **Read-only share links.**

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

For zero-waste chains, the leftover after cutting rectangle R must be as conservative as the engine's own 3 × 3 erosion. We use the identity

$$
\operatorname{erode}(M-R)=\operatorname{erode}(M)-\operatorname{dilate}(R),
$$

so each chained plan sees exactly the usable offcut. Every chained cut is then re-validated against the original masks. Cuts with identical dimensions are interchangeable, so the sewing layout permutes them to minimize

$$
C(\pi)=\sum_{(s,t)\in N}p\big(\pi(s),\pi(t)\big),\qquad p=\begin{cases}2&\text{same scrap}\\\max\!\left(0,\,1-\tfrac{\Delta E_{76}}{40}\right)&\text{otherwise}\end{cases}
$$

over edge-sharing slots N, without moving any cut on the fabric. The design map of that layout is the reference image for an Images API edit request, so the concept render follows validated geometry. The packet is drawn by a dependency-free vector PDF writer with an exact 100 mm calibration bar.

## Challenges we ran into

Bounding boxes contain empty space around irregular scraps. Pixel containment checks prevented cuts from crossing those gaps. Shadows, similar colors, and calibration errors required conservative boundaries and quality flags. Neural inference needed correct tensor shapes, efficient model loading, and human review. Cloud retries needed durable recovery without duplicate records. Our first zero-waste chain timed out at 25 seconds: proving that nothing else fits fragmented offcuts is the expensive case. Profiling showed that fine 4 × 4 grids dominated. Exact fit pre-checks, a 3 × 3 cap for bonus projects, and a pruning bound brought the search to 5–10 seconds on most samples. A time budget returns validated partial chains.

## Accomplishments that we're proud of

**All 57 automated tests pass, and CI runs an end-to-end API demo on the bundled samples.** Real neural inference changed measured geometry and recalculated a complete 26-cut tote. Public Azure checks verified durable saves, replay recovery, private retrieval, wrong-key rejection, and deletion. Records expire after 30 days.

## What we learned

Useful AI needs traceable consequences: predicted pixels must affect actual cutting decisions. Clear calibration and honest incomplete layouts build trust. Utilization describes geometry; it does not prove environmental savings or physical sewing suitability.

## What's next for Oddment Guild

We want maker trials, perspective correction, grain constraints, and documented textile benchmarks. We also want to bring chains, pools, concept renders, and packets into the studio interface, and run repair-café pilots with pooled donations.

**Team:** Siddhanth K Jain, Adithya P, Kamma Rohan, Dinesh Kulkarni.

**Credits:** SlimSAM, Transformers.js, ONNX Runtime, Three.js, Azure SDK, Codex assistance, and ImageGen samples; licenses and provenance are included.
