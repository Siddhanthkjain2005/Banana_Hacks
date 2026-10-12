# ReThread — exact three-minute video script (v1.3)

Public Azure demo: [Open ReThread](https://salmon-stone-073245e00.4.azurestaticapps.net/)

Read only the quoted narration. Nine 20-second segments total **3:00** with **350 narrated words** (≈117 words per minute). Rehearse with a timer and use spare seconds for clicks. Record on a computer with a real GPU so the 3D runs smoothly.

## 0:00–0:20 · The hook

**On screen:** Open the site fresh. Let the Pattern mix sample load and the assembly animation play: pieces lift off the photo, fly, bend into the tote, handles fly in, stitches sew.

> Fabric leftovers deserve a second story. ReThread turns one photo of scraps into a real cutting plan, then shows it: every piece you watch lifting off this photo is the exact rectangle it will be cut from, sewing itself into a tote.

## 0:20–0:40 · Photo to inventory

**On screen:** Point to **Photo width**, then **Upload fabric photo** (or **Browse samples**). Click **Analyze & design**. Show the dashed outlines and the material library with its pattern tags.

> Upload or photograph your scraps on a plain surface and enter the photo width for scale. In-browser computer vision clusters colours in CIELAB space, traces every scrap, and measures usable area. Your photo never leaves the device.

## 0:40–1:00 · FabricNet

**On screen:** Scroll to **FabricNet readout**. Hover the stripe row, its probability bar, and the grain compass at −6°. Click **How it works** and show the confusion matrix and training curve briefly.

> Then FabricNet reads the cloth. It's a convolutional network we built and trained from scratch, backpropagation and all, in plain JavaScript. It labels stripes, checks, dots, prints and weaves, and measures each scrap's grain: this stripe lies six degrees off.

## 1:00–1:20 · Grain-aware cutting

**On screen:** In **A little less leftover**, untick and re-tick **Grain-aware (FabricNet)**; show the cut count change. Open **Cutting plan** and point at stripe cuts that stay upright.

> That changes the cutting. Striped fabric is never turned sideways, and off-grain pieces are used last, with a warning on every affected cut. Switch the grain rules off and the layout changes, because the model's output really drives the plan.

## 1:20–1:40 · 3D studio and Colour DNA

**On screen:** Switch to **Little pouch** (the animation replays), then **Cozy cushion**. Press ▶ replay, then explode, then reset. Scroll to **Colour DNA** and drag it.

> Choose a tote, pouch or cushion. Each one assembles itself from your real textures. Explode the panels or replay the build. Colour DNA plots your fabric's actual pixels in 3D colour space, with one sphere for every scrap.

## 1:40–2:00 · SlimSAM and exports

**On screen:** Select a scrap, click **AI refine selected fabric**, show the green SlimSAM prediction, and apply it. Open **Export** and show SVG, JSON, TXT, and PNG.

> For tricky edges, the pretrained SlimSAM segmentation model reviews a selected piece locally, and its prediction can only tighten the boundary. Export a calibrated SVG cutting sheet, a JSON report with FabricNet's results, a sewing guide, or a 3D render.

## 2:00–2:20 · Zero-waste lab

**On screen:** Scroll to the **Zero-waste lab** as it fills in. Point at the leftover chain image and its 68.5% → 76.2% bar, click **Apply to the 3D model**, then point at the deep-search table.

> The zero-waste lab runs on Azure Functions. It plans a second project from the exact leftovers, rearranges patches so twin fabrics never touch, and runs a deeper seeded search for a layout that keeps the biggest offcut whole.

## 2:20–2:40 · Community, print, share

**On screen:** Show **Pooling unlocks this project**. Click **Maker packet · A4 PDF** and flash the PDF. Click **Cloud verify & save**, then **Copy read-only link**, and open it in a private window.

> Pool scraps with a friend's photo, each with its own scale, and see when pooling unlocks a project neither of you could make alone. Print a maker packet, save the verified plan privately, and share a read-only link.

## 2:40–3:00 · Close

**On screen:** Return to the assembled tote. Overlay the team name and four members, the GitHub link, and “68 tests passing”.

> We're Oddment Guild: Siddhanth K Jain, Adithya P, Kamma Rohan, and Dinesh Kulkarni. Sixty-eight tests pass, from FabricNet's accuracy to server re-validation. ReThread makes image AI decide what gets cut, so every scrap gets a second story.

## Before recording

- Redeploy `dist/` and `api/` to Azure and confirm `/api/health` reports version 1.3.0 and the studio shows **CONNECTED TO AZURE**.
- Let the lab finish once before recording so you know its timing; the chain and deep search take several seconds.
- Keep access keys and tokens out of the recording; delete any demonstration receipt afterwards.
- Synthetic samples have illustrative scale. Say so if you show measurements as real.
- Publish the YouTube video as **Public**, ≤ 3:00, and check it signed out.
