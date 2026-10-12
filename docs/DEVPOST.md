## Inspiration

Fabric leftovers often outlive the projects that created them. We asked: **“What can I make from what I already have?”** ReThread helps sewing students, repair cafés, and workshops design around irregular offcuts.

## What it does

Photograph separated scraps and enter the scene width. ReThread inventories materials, validates a cutting layout, and animates the actual cuts lifting off your photo into a textured 3D tote, pouch, or cushion.

**FabricNet**, our locally trained CNN, classifies solid, textured, stripe, check, dots, and print. Pattern orientation and straight cut edges inform estimated grain direction: directional stripes lock rotation, and off-grain scraps receive a planning penalty. **SlimSAM** offers optional, reviewed boundary refinement. Neither model establishes physical sewing suitability.

The **Colour DNA** view explores image colours in 3D CIELAB space. The **Zero-waste lab** chains projects from exact leftovers, arranges interchangeable patches, searches deeper layouts, pools donors’ independently calibrated scraps, generates design maps and printable A4/Letter packets, and supports private saving and read-only sharing. Source photographs stay in the browser.

## How we built it

HTML, CSS, JavaScript, Web Workers, and Three.js power the studio. CIELAB clustering minimizes

$$
J=\sum_{p\in S}\min_k\|\mathrm{Lab}(p)-\mu_k\|_2^2.
$$

Morphology and connected components identify scraps. Calibration converts foreground pixels into area:

$$
s=\frac{W_{px}}{W_{cm}},\qquad A=\frac{N}{s^2}.
$$

FabricNet has three convolution blocks, global average pooling, a dense layer, and six-way softmax: **7,286 parameters**. We implemented backpropagation and Adam in JavaScript, training on approximately 108,000 synthesized textile patches with randomized colours, lighting, noise, scale, and rotation. Cross-entropy trains the classifier:

$$
\mathcal L=-\frac1B\sum_i\log\operatorname{softmax}(f_\theta(x_i))_{y_i}.
$$

Held-out synthetic accuracy is **96.3%**; real-photo accuracy remains unmeasured. Projection-profile searches estimate pattern orientation. Every cut must satisfy mask containment and non-overlap:

$$
R_i\subseteq M_{usable,s(i)},\quad \operatorname{int}(R_i)\cap\operatorname{int}(R_j)=\varnothing\quad(i\ne j,\ s(i)=s(j)).
$$

Deep search uses bounded, seeded restarts; it does not guarantee optimality. Azure Functions revalidates geometry and grain constraints, while private Blob storage uses hashed capabilities, expiry, and idempotent retries. OpenAPI describes every route.

## Challenges we ran into

Light motifs resembled the background, creating false holes. We fill small enclosed regions and flag them for inspection. Checks confused early grain estimators; projection profiles improved recovery. Training without a framework required checking our gradients. Asynchronous lab results also needed invalidation when the maker changed plans.

## Accomplishments that we're proud of

**72 automated tests pass**, covering model hashes, inference parity, held-out accuracy, grain rules, geometry, storage, and sharing. Pattern mix’s leftover chain raises utilization from **68.5% to 76.2%**. Pooling enables projects donors cannot complete alone.

## What we learned

Useful AI changes a concrete decision. Synthetic benchmarks require honest limits. Geometric utilization and assumption-based environmental estimates need physical validation.

## What's next for Oddment Guild

Measure FabricNet on real photos, trial patterns with repair cafés, correct perspective, and support cuts aligned with skewed grain.

**Team:** Siddhanth K Jain, Adithya P, Kamma Rohan, Dinesh Kulkarni. AI coding assistants supported development; ImageGen supplied three labelled samples. Third-party licenses and provenance are included.
