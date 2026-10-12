# ReThread — exact three-minute video script

Public Azure demo: [Open ReThread](https://salmon-stone-073245e00.4.azurestaticapps.net/)

Read only the quoted narration. The nine segments total **3:00**, including the opening and closing credits, with **384 narrated words** (about 128 words per minute). Rehearse with a timer and use the spare seconds in each segment for clicks or a quiet pause. These are timing targets, not a guarantee that every speaking pace produces exactly three minutes.

## 0:00–0:20

**On screen:** Show the Azure studio. Open **Browse samples** and briefly reveal all six choices and their labels. Show **Upload fabric photo**, drag-and-drop area, and camera icon; load a prepared photo or labeled sample.

> Fabric leftovers deserve a second story. ReThread turns a photo of scraps into a measured cutting plan and an interactive product preview. Start with six sample collections, including clearly labeled AI-generated examples, or upload, drag in, or photograph your own fabric.

## 0:20–0:40

**On screen:** Point to **Photo width**, enter a measured value for a real photo, and click **Analyze & design**. Select a scrap, click **AI refine selected fabric**, review the actual green prediction, and apply the boundary. Use an illustrative sample width only when the sample label stays visible.

> Set the scene width, analyze, and select a fabric piece. AI refine runs SlimSAM’s pretrained encoder and mask decoder locally. Review the green prediction, then apply its conservative intersection with the material mask. Every cut is recalculated from the resulting pixels.

## 0:40–1:00

**On screen:** Scroll to the material library. Open **Review materials**, inspect a scrap's area and warnings, exclude it, then restore it. Briefly select **Color story**, **Balanced**, and **Less stitching**, showing the recalculated metrics.

> The material library shows colors, measured areas, usable shapes, and quality warnings. Review an uncertain scrap, exclude it from cutting, and restore it when appropriate. Compare Color story, Balanced, and Less stitching priorities; the utilization figure comes from the actual placed cuts.

## 1:00–1:20

**On screen:** Switch through tote, pouch, and cushion. Adjust **Design size** and **Seam allowance**, toggle **Allow rotated cuts**, and open **Find my best fit**. Show its real ranked results and choose a complete layout. If a setting produces a partial layout, briefly show its honest status.

> Choose an everyday tote, little pouch, or cozy cushion. Change design size, seam allowance, and permission to rotate cuts. Find my best fit checks all three products under those same settings, ranking complete plans first. An incomplete result clearly says more fabric is needed.

## 1:20–1:40

**On screen:** Return to **Design studio**. Rotate and zoom the object. Toggle **Explode assembly**, **Show geometry**, and **Reset view**, in that order. Keep a close enough view for texture and construction to be visible.

> The live Three.js preview uses textures from your actual photo and colors from assigned scraps. Drag to rotate, scroll to zoom, explode the assembly to inspect its panels, switch on wireframe to reveal the geometry, and reset the view.

## 1:40–2:00

**On screen:** Open **Cutting plan** and point to solid cut lines and dashed stitch lines. Open **Export** and reveal all four formats: SVG, JSON, TXT, and PNG. Download the SVG and briefly show its 10 cm scale bar; prepare a second tab so this transition stays quick.

> Cutting plan overlays cut boundaries and stitch lines on the source image. The solver checks containment and overlap, including seam allowance. Export a calibrated SVG cutting sheet, JSON geometry report, TXT sewing guide, or PNG of the current 3D concept.

## 2:00–2:20

**On screen:** Click **Save collection**, open **My collections**, show reopening/deleting controls, and briefly demonstrate **New collection**. Open **Field notes**, **Behind the seams**, and the **Photo width** help. A short edited montage works well here.

> Save a collection locally, reopen or delete it from My collections, and start fresh with New collection. Field notes, Behind the seams, and scale help explain the vision pipeline and photography requirements. Photos remain on your device, and physical fabric still needs your review.

## 2:20–2:40

**On screen:** On the Azure deployment, click **Cloud verify & save** and wait for **VERIFIED & SAVED**. Open **Saved plans → View receipt**, reveal the expiry and **Download cloud receipt · JSON** / **Delete this private record** controls. Delete only the demonstration record; keep any access key and credentials out of the recording.

> Cloud verify and save sends only derived masks and settings to Azure Functions. The server recalculates measurements and cutting constraints, then stores a private receipt in Azure Blob storage. Saved plans lets this browser retrieve, download, or delete it using its private access key. Records expire after thirty days.

## 2:40–3:00

**On screen:** Finish on the completed 3D design with the team name and all four members as a small overlay. Briefly show the verified 38-test result and GitHub link. Put credits on this same shot; end the video exactly at 3:00.

> We are Oddment Guild: Siddhanth K Jain, Adithya P, Kamma Rohan, and Dinesh Kulkarni. Thirty-eight tests pass, and live cloud saving, retrieval, access rejection, and deletion were verified. ReThread connects image-driven decisions to practical reuse, with Three.js, Azure, ImageGen samples, and Codex coding assistance.

## Before recording

- Use the Azure link above and confirm **CONNECTED TO AZURE** before recording. Create a fresh cloud demonstration record.
- Prepare a clearly labeled sample and a real upload photograph with an independently measured scene width. A sample's illustrative scale is not a physical measurement.
- Keep the same photograph visible when explaining how its shapes and textures affect the plan.
- Record processing results as they happen. Shorten idle moments in editing, then leave enough quiet screen time to keep the full video at exactly 3:00.
- Use a complete geometric layout for the closing shot. Inspect fabric condition, grain, scale, and assembly before physically cutting; the app cannot infer hidden holes or fabric strength from the image.
- Verify the exported SVG scale at 100% print size. A heuristic's incomplete result does not prove that no possible arrangement exists.
- Publish the final YouTube video as **Public**, and confirm its runtime and access while signed out.

