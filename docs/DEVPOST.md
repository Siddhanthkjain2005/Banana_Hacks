## Inspiration

Fabric leftovers often outlive the projects that created them. We asked: **“What can I make from what I already have?”** ReThread helps sewing students, repair cafés, and workshops design around irregular offcuts.

## What it does

Photograph separated scraps, enter the scene width, and generate a material inventory, validated cutting layout, and textured 3D concept. Local **SlimSAM neural review** refines selected boundaries. Compare totes, pouches, and cushions; adjust size, seams, and rotation; exclude unsuitable scraps; inspect exploded assembly; and export SVG, JSON, TXT, or PNG files.

Six labeled synthetic collections support exploration. Private Azure receipts preserve verified plans.

The **v1.2 API** adds leftover project chains, calibrated donor pools, colour-aware sewing layouts, printable A4/Letter maker packets, and read-only sharing. Its optional image-provider adapter accepts a layout-derived design map; external concept generation is not configured on the public demo.

## How we built it

HTML, CSS, JavaScript, Web Workers, and Three.js provide the studio. CIELAB k-means learns image colours:

$$
J=\sum_{p\in S}\min_k\|\mathrm{Lab}(p)-\mu_k\|_2^2.
$$

Background estimation, morphology, and connected components produce masks. Pinned, SHA-256-verified INT8 SlimSAM weights run locally. Human-reviewed predictions conservatively intersect the measured mask:

$$
M_{\mathrm{refined}}=M_{\mathrm{vision}}\cap M_{\mathrm{SlimSAM}}.
$$

With image width Wpx, measured scene width Wcm, and foreground pixels N:

$$
s=\frac{W_{\mathrm{px}}}{W_{\mathrm{cm}}},\qquad A_{\mathrm{cm}^2}=\frac{N}{s^2}.
$$

Every cut must stay inside its assigned usable mask; cuts sharing fabric cannot overlap:

$$
R_i\subseteq M_{\mathrm{usable},s(i)},\qquad \operatorname{int}(R_i)\cap\operatorname{int}(R_j)=\varnothing\quad(i\ne j,\ s(i)=s(j)).
$$

Seam allowance is included in geometric utilization:

$$
\eta=100\frac{A_{\mathrm{placed\ cuts}}}{A_{\mathrm{usable\ fabric}}}.
$$

Chaining removes cuts and preserves the engine's conservative erosion:

$$
\operatorname{erode}(M-R)=\operatorname{erode}(M)-\operatorname{dilate}(R).
$$

All chained cuts are independently checked against original masks. Colour arrangement swaps identically sized cuts between sewing slots without moving fabric cuts.

Azure Functions validates geometry and writes private Blob receipts. Hashed capabilities, conditional writes, and retained idempotency keys protect access and recover interrupted saves. Photos stay local.

## Challenges we ran into

Bounding boxes include empty space, so pixel containment was essential. Shadows, calibration, and neural predictions needed conservative boundaries and human review. Fragmented leftovers made failed searches expensive; fit pre-checks, capped bonus grids, and a time budget preserve complete, validated projects. Provider deadlines must also cover stalled response bodies.

## Accomplishments that we're proud of

**58 automated tests pass.** CI exercises the backend on bundled samples. Real neural inference recalculated a complete 26-cut tote. Azure verification covers durable saves, replay recovery, private retrieval, wrong-key rejection, and deletion. The Denim API demonstration increased geometric utilization from 64.5% to 76.6% with a tote-and-pouch chain.

## What we learned

Useful AI needs traceable consequences: predicted pixels must affect cutting decisions. Utilization measures geometry; it does not establish environmental savings, fabric strength, or sewing suitability. Clear calibration and honest incomplete results build trust.

## What's next for Oddment Guild

Bring chains, pools, and maker packets into the studio interface; run repair-café trials; and add perspective correction, grain constraints, and textile benchmarks.

**Team:** Siddhanth K Jain, Adithya P, Kamma Rohan, Dinesh Kulkarni.

**Credits:** SlimSAM, Transformers.js, ONNX Runtime, Three.js, Azure SDK, Codex and Claude assistance, and ImageGen samples; licenses and provenance are included.
