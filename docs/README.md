# docs

Things that describe Kairos rather than run it. **Nothing in this directory is
read by the server** — no route loads it, no build step consumes it. It is here
because this is the only durable store the project has, and every one of these
was previously living in a container that gets reclaimed.

## `tiers/` — the commercial sheet

The tier and pricing document, as the script that writes it rather than only as
the file it produced. The script is the source; the `.docx` is output. Editing
the prose and re-running is a minute's work, where editing OOXML by hand is an
afternoon.

```
cd docs/tiers && python3 build-complete.py     # → Complete Kairos Tiers and Pricing.docx
cd docs/tiers && python3 build-tiers.py        # → Kairos Features By Plan.docx
```

`mkdocx.py` is the shared library both use — it writes Word files by hand,
because LibreOffice on the build box cannot load any input format. Element order
inside a paragraph matters and is easy to get subtly wrong: `tcW` before
`gridSpan`, `spacing` before `jc`, `rPr` last inside `pPr`.

`Kairos Tier Sheet (19 August).docx` is committed as a **file rather than a
script**, deliberately and as the exception. It is the pivot every later edition
is measured against, and the script that produced it read a transcription from a
scratch path that no longer exists — so it cannot be regenerated. The artefact is
what survives. Two other generators (`build-august.py`, `build-doc.py`) were left
out of this directory for the same reason in reverse: they depend on scratch
inputs that are gone, so committing them would commit something that looks
runnable and is not.

## `tools/` — the training course

Two scripts that build the course from the running app. They are separate on
purpose: the first one is slow and touches the database, the second is fast and
touches only files, so the writing can be edited and rebuilt without
re-photographing anything.

```
node docs/tools/capture.js      # seeds an office, screenshots every screen
node docs/tools/builddeck.js    # arranges the shots into kairos-course.html
```

Output lands in `docs/tools/build/`, which is not tracked.

**`capture.js` deletes `app/server/data/kairos.sqlite` when it starts**, exactly
as the test suites do — so never run it beside a board, in either direction. The
pictures are real: it drives the actual UI against a seeded account, which is the
whole point. A hand-drawn deck starts lying the first time a screen changes and
the reader cannot tell which parts are the product and which are the
illustrator.

## What is NOT here

The current tier `.docx` and the built course, because both are one command away
from their sources. If you want the file rather than the recipe, run the script.
