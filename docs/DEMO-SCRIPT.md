# ReThread demo — 2 minutes 45 seconds

This is a recording plan. Live Azure create, retrieve, access rejection, and deletion were verified on October 12, 2026. Record a fresh job and show its real receipt. If cloud saving is temporarily unavailable, use the alternate segment below. The public YouTube video must last two to three minutes, including titles and credits.

| Time | On screen | Narration |
| --- | --- | --- |
| 0:00–0:12 | ReThread overview and material photo. | “A box of fabric scraps contains possibilities. ReThread helps makers find what actually fits, and turn those leftovers into something useful.” |
| 0:12–0:33 | **Browse samples**: show all six and labels; choose a clear photo-style sample. Briefly show **Upload fabric photo**. Point to **Photo width**. | “Choose a collection or upload your own photo. These six examples are generated illustrations, with assumed scene widths. For real material, use a flat photograph with separated scraps, and enter the measured width of the scene.” |
| 0:33–0:57 | Click **Analyze & design**. Show detected edges and material library. | “The photo stays in the browser. ReThread fits unsupervised color clusters to this image, estimates the background from its border, and traces connected material regions. It does not use a pretrained neural detector. Those masks become real constraints for the planner.” |
| 0:57–1:18 | Select **Cutting plan**. Point to boundaries, stitches, and an irregular edge. | “Each patch includes seam allowance. The solver tests candidates against the usable material mask and other cuts, then validates the selected plan. It can report an incomplete layout honestly. A bounding box alone would miss this irregular edge.” |
| 1:18–1:39 | **Design studio**: rotate, **Explode assembly**, then return to assembled view. | “Those cuts feed the textured 3D concept. Rotate it and separate the panels to inspect the design. The preview helps explain the object; physical fabric condition and assembly still need a maker's review.” |
| 1:39–2:00 | Adjust **Design size**, click **Find my best fit**, show ranked plans, select a feasible product. | “Change the size, seam allowance, or permission to rotate cuts. Best fit computes layouts for the tote, pouch, and cushion under these same constraints. Complete plans rank first, followed by measured utilization. These are geometric recommendations, not fabric-strength predictions.” |
| 2:00–2:27 | **Cloud verify & save**: wait for real confirmation. **Saved plans → View receipt**: show summary without exposing access key. | “The Azure service receives only derived shapes and settings. It recomputes measurements and cutting constraints, then saves the result privately. Here we retrieve the actual receipt. This browser holds the access key; the original fabric photograph is never stored in the cloud.” |
| 2:27–2:45 | **Export**: download SVG, reveal 10 cm scale bar, finish with team/credits. | “Export the cut sheet, assembly guide, or audit report. Verify the printed scale before cutting. ReThread helps makers explore reuse. Built by Oddment Guild, with Three.js, Azure, ImageGen samples, and coding assistance from Codex.” |

## Alternate 2:00–2:27 segment if cloud saving is unavailable

Show **Review materials**, inspect one scrap, **Exclude from cutting**, and the recalculated plan. Restore it if useful. Narration: “A photo cannot reveal every hidden flaw. A maker can exclude an uncertain scrap and recalculate. The local studio remains useful when the cloud is unavailable, so we can continue exploring and export the plan on this device.”

## Recording checks

- Rehearse with a timer and shorten narration for processing delays. Reveal each actual result.
- Prepare a real upload example with separate scraps, even lighting, a contrasting background, and known scene width. Keep generated examples labeled synthetic.
- Verify best fit returns actual complete/partial plans. An unsuccessful heuristic search is not proof that no arrangement exists.
- First verify cloud POST save, GET retrieval, rejection of absent/wrong capability, and DELETE. Record a fresh job. Do not show access tokens, Azure credentials, or storage keys.
- Show a smaller design or feasible recommendation before describing an export as a complete project.
- Inspect the SVG's units and scale bar. Utilization includes seam area and divides by usable detected material area.
- Publish YouTube as **Public**, verify full runtime and signed-out access, and include the verified public demo: [ReThread on Azure](https://salmon-stone-073245e00.4.azurestaticapps.net).
