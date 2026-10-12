## Inspiration

A pile of fabric offcuts is full of possibilities, but turning irregular leftovers into something useful takes measurement, planning, and guesswork. We asked: **“What can I make from the fabric I already have?”** ReThread grew from that question: a visual design assistant for sewing students, repair cafés, and small upcycling workshops.

## What it does

Upload or photograph separated fabric scraps, enter the photographed scene’s width, and select **Analyze & design**. ReThread identifies material regions, estimates dimensions and areas, and builds cutting plans for a **tote, pouch, or cushion**.

Explore six sample collections, adjust size, seams, rotation, and design priorities, or exclude unsuitable material. **Find my best fit** compares actual layouts. View textured 3D concepts, inspect exploded assembly and wireframes, then export an SVG cutting sheet, JSON report, sewing guide, or preview image. Save local collections or privately archive a server-verified plan on Azure.

## How we built it

We built the interface with HTML, CSS, and JavaScript, using Three.js for interactive previews and a Web Worker for image processing. Deterministic k-means clustering in CIELAB color space, border-based background estimation, morphology, and connected components produce scrap masks. No pretrained neural model is used.

Our planner searches patch grids and rotations, includes seam allowances, and checks cuts against conservative masks. Separate validation checks containment and overlap. Utilization measures planned cut area divided by usable detected fabric area.

Azure Functions validates encoded masks and settings, recomputes geometry, and saves receipts in private Blob storage. Individual access capabilities protect retrieval and deletion. Photos remain in the browser; cloud requests contain derived geometry and settings.

## Challenges we ran into

An irregular scrap’s bounding box can contain empty space, so rectangular measurements alone produced unsafe assumptions. Mask containment checks made the geometry meaningful. Shadows, similar colors, clipped edges, and calibration errors also required quality flags and conservative boundaries.

We kept incomplete layouts visibly incomplete and made cloud saving acknowledge success only after a durable write. Keeping responsive controls, real cut assignments, and attractive 3D previews consistent was another significant challenge.

## Accomplishments that we're proud of

We connected image analysis to usable design decisions and physical-scale exports. **All 28 automated tests pass.** The public Azure deployment passed real save, retrieval, wrong-key rejection, deletion, and invalid-input checks. Private records expire after 30 days, with storage cleanup configured.

## What we learned

Visual polish earns attention; traceable geometry earns trust. Clear calibration, honest feasibility, and human material review matter more than impressive-looking numbers. Synthetic samples demonstrate the workflow but cannot establish real measurement accuracy.

## What's next for Oddment Guild

We want maker trials, perspective correction, grain-direction constraints, and documented segmentation comparisons. Our team is **Siddhanth K Jain, Adithya P, Kamma Rohan, and Dinesh Kulkarni**.

**Credits:** OpenAI Codex assisted development; Three.js and Azure SDK provide rendering and storage. Three samples use ImageGen; three are procedural illustrations. Provenance is included.
