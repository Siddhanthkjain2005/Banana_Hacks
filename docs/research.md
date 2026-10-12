# Banana Hacks 2026 research

Verified from public organizer pages on October 12, 2026, at approximately 08:17 IST. No registration, contact, upload, or submission was performed.

## Timing: act on the earliest published deadline

| Event | Published time | India time |
| --- | --- | --- |
| Submission period begins on Devpost | Fri Oct 9, 8:00 PM EDT | Sat Oct 10, 05:30 IST |
| Hacking begins on official schedule | Fri Oct 9, 8:45 PM EDT | Sat Oct 10, 06:15 IST |
| Official schedule deadline | Sun Oct 11, 11:59 PM EDT | Mon Oct 12, **09:29 IST** |
| Devpost deadline | Mon Oct 12, 12:00 AM EDT | Mon Oct 12, **09:30 IST** |
| Conflicting official conduct/prizes deadline | Sun Oct 11, 11:59 PM AoE | Mon Oct 12, **17:29 IST** |
| Devpost judging | Mon Oct 12, 9:00 AM–5:00 PM EDT | Mon Oct 12, 18:30–Tue Oct 13, 02:30 IST |
| Winners announced | Mon Oct 12, 6:00 PM EDT | Tue Oct 13, 03:30 IST |

The official schedule and Devpost agree within one minute, but the official conduct and prizes pages specify AoE. This is an unresolved eight-hour inconsistency. Plan to finish and submit before **09:29 IST on October 12**, unless the organizers explicitly confirm otherwise. [Devpost dates](https://banana-hacks-1111.devpost.com/details/dates), [official schedule](https://www.bananahacks.tech/schedule), [official conduct](https://www.bananahacks.tech/code-of-conduct).

## Eligibility and provenance

- Entrants must be currently enrolled students aged 14–24; professional organizations cannot enter. Devpost mentions its standard geographic exceptions. [Devpost overview](https://banana-hacks-1111.devpost.com/)
- Teams have 1–4 members, and each person should contribute. Work must be produced during the event. A previous idea may be revisited, but previous project code or materials cannot be reused. Cross-submission to another hackathon is prohibited. [Devpost rules](https://banana-hacks-1111.devpost.com/rules), [overview](https://banana-hacks-1111.devpost.com/)
- Official conduct says the source repository must be public and commits must occur in the hacking window; timestamps are checked. Open-source libraries, public APIs, and pretrained models are permitted with README attribution. Generative AI tools are allowed and encouraged, with disclosure. [Official conduct](https://www.bananahacks.tech/code-of-conduct)

## Required deliverables

Use the intersection of the published requirements:

1. Project name and all team members.
2. Public GitHub repository, with library/model/dataset and AI-tool credits.
3. A Devpost write-up covering inspiration, brainstorming, design, resources, implementation, and final result; keep it at 500 words or fewer.
4. Public YouTube demo, **2–3 minutes**, never exceeding three minutes. Target 2:45 to leave a margin.
5. A working hosted demo URL if possible; the official FAQ says judges will try live demos.

Devpost overview requires a public YouTube video and a Devpost project description, while the rules specify a 2–3 minute demo. The official FAQ additionally recommends a live link and limits the write-up to 500 words. Prepare both video and live demo. [Devpost overview](https://banana-hacks-1111.devpost.com/), [rules](https://banana-hacks-1111.devpost.com/rules), [official FAQ](https://www.bananahacks.tech/faq)

## Theme, tools, and rubric

There is no narrow public problem statement: the theme is applications, games, and tools centered on image AI. The official FAQ permits any technology stack and pretrained models; no required model, paid API, or sponsor integration is published. A separate challenge may have been disclosed at the opening ceremony, according to the conduct page; none is stated in the public updates. [Official FAQ](https://www.bananahacks.tech/faq), [conduct](https://www.bananahacks.tech/code-of-conduct), [Devpost updates](https://banana-hacks-1111.devpost.com/updates)

Each of five criteria receives a 1–5 score with equal weight:

| Criterion | What to demonstrate in ReThread |
| --- | --- |
| Technical execution | Upload-derived masks, contours and dimensions; real irregular-shape containment and collision checks; reproducible optimizer output. |
| Innovation | A concrete bridge from a photograph of discarded material to something physically makeable. |
| Image AI theme | Uploaded pixels determine inventory and feasible pattern placement. Removing the vision stage removes the core workflow. |
| Impact/usefulness | A named user such as a repair café, sewing student, or small upcycling workshop; time saved and material yield computed from actual geometry. |
| Design/demo | Clear capture → analyze → choose → cut → assemble flow, beautiful texture-mapped 3D object, and a concise visible proof of the pipeline. |

Judges explicitly favor non-trivial image integration, originality, an essential visual intelligence component, a real user, and an understandable demo. Thin API wrappers, generic clones, and cosmetic AI score lower. [Official rubric](https://www.bananahacks.tech/prizes)

## Strategy assessment — inference, not a predicted score

ReThread is a strong differentiated direction if it delivers an end-to-end vertical slice: photograph separate scraps on a plain backdrop; segment and extract each irregular outline; enter one known scale dimension; fit a real pattern without overlap or out-of-bounds cuts; show cut-sheet SVG and assembly steps; render the resulting object using the scrap textures. This makes image processing indispensable and gives the 3D animation a useful purpose.

The most defensible demo is one successful arbitrary upload plus one visibly constrained case where the optimizer says a pattern does not fit. Show before/after or a basic greedy baseline only if the actual measured layout supports the claimed improvement. Label synthetic sample inputs as synthetic, and report material area/yield from computed polygons rather than invented environmental equivalents.

Risks to prioritize:

- Classical background segmentation is computer vision, but it is not a trained AI model. Describe it accurately. A learned segmentation option would improve alignment if it can be integrated reliably within the available time; do not claim one exists without working inference.
- Photograph scale, perspective, seams, fabric stretch, grain direction, and thickness affect real cutting. Require a flat capture and one calibration measurement, include seam allowances, and describe the output as a prototype cutting plan that requires measurement before cutting.
- Mask-derived shape constraints must reach the optimizer. Bounding-box packing that cuts outside the scrap would weaken both usefulness and technical credibility.
- An attractive 3D preview alone is insufficient. Demonstrate image-to-geometry causality and an export people can use.
- Prize eligibility, registration, public repository, public video, and timely submission remain user/account-dependent actions. Winning cannot be guaranteed.
