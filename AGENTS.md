# Manabase mobile: notes for agents

Read [README.md](README.md) first. This site does what `../frontend` does, for phones; the frontend's `docs/` explain the product decisions, and `../backend/docs/api.md` every endpoint.

The things most likely to bite:

- Start it with `heighliner up -av`, which mounts the source: weaver renders the page on every request, so a refresh shows an edit. Only `Gemfile` and `Dockerfile` changes need a rebuild.
- Navigate by setting the URL hash and let the router build the screen; never both set the hash and route.
- Never retry a rejected session more than once: an unbounded retry once created 54,000 learners (`sessionWasRejected` in app.js).
- Put everything from the backend on the page with `textContent` (the `h` helper's `text`), never as HTML.
- Keep logic in `js/manabase/logic.js`, and test it in `test/`: `node --test` must pass.
- Links in `source/index.weave` start with `/`: weaver opens any other link in a new tab.
- Bootstrap's `.mark` class has a highlight background; weaver's CSS has CodeMirror 5 `.cm-*` rules. Pick class names that miss both.
- `js/runtimes/` and `js/editors/` are build outputs: change the sources (the frontend's `runtimes/`, `editors/codemirror/` here) and rebuild, never the outputs.
- Passkey ceremonies must start straight from a tap (Safari): fetch the options first.
- The shared Selenium Chrome is version 94; CSS that is newer (such as `:has`) may only decorate.
