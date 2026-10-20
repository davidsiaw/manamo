# Manabase mobile

The Manabase app for phones: everything [the frontend](../frontend) does (courses, Ruby and Zig programs run in the browser, Rust run on your own computer, passkey accounts, My progress, revision mode), laid out for a small touch screen, in a dark theme. On a wide screen the problem tree becomes a column beside the problem.

It talks to the same [backend](../backend), with the same API, and a passkey made on either site logs in on the other.

A [weaver](https://github.com/davidsiaw/weaver) site. Weaver draws the page (`source/index.weave`: the navigation bar, Bootstrap 3 and weaver's dark theme); the screens are plain JavaScript in `js/manabase/`, routed by the URL hash as in the frontend.

## Running it

Start the backend first (`../backend`), then:

```sh
heighliner init manamo     # once
heighliner up -av          # -a mounts the source, so a browser refresh shows an edit
open "https://manamo.$(heighliner show http-suffix)"
```

The backend's Heighliner.config lists `https://manamo.<suffix>` among the passkey origins; another environment name needs a change there too.

## Files

```
source/index.weave       The page: navigation bar, stylesheet and scripts, API_BASE_URL.
js/manabase/logic.js     Pure logic, ported from the frontend's: sessions, routes, passkey
                         JSON, problem text, the problem tree, run output. Unit tested.
js/manabase/dom.js       Building elements, problem text, the API client, passkey ceremonies.
js/manabase/runner.js    Running programs in Web Workers, and the code editor.
js/manabase/app.js       Startup, routing, course menu, My progress, register, log in and out.
js/manabase/course.js    The course screen: drawer with the tree and revision mode, the problem.
css/manabase.css         Layout and the dark colours on top of weaver's theme.
js/runtimes/             The language runtimes, copied from the frontend (bin/sync-runtimes).
js/editors/codemirror/   CodeMirror, bundled by editors/codemirror/build; committed.
editors/codemirror/      The editor's source: the frontend's, with a dark theme and settings
                         for touch keyboards.
test/                    Unit tests for logic.js.
```

## How it differs from the frontend

- The problem tree is a drawer (the **Problems** button), with revision mode at its top; Previous and Next are along the bottom of the screen.
- Registering takes two taps (email, then **Create passkey**), and the login page fetches its challenge before the tap. Safari only runs a passkey ceremony started directly by the user, not one started after waiting for the server.
- Code problems have a row of keys a phone keyboard hides (Tab, brackets, `|`, `=` and so on). It is hidden when there is a mouse.
- A Rust problem's output is pasted into a plain text box, which is easier to paste into on a phone than an editor.

## Runtimes and the editor

`js/runtimes/` holds copies of the frontend's built runtimes; each `worker.js` loads its other files relative to itself, so they work unchanged. Ruby is committed. Zig is not (8 MB): build it in the frontend (`runtimes/zig/build` there, see its docs/runtimes.md), then:

```sh
bin/sync-runtimes          # copies ../frontend/Resources/runtimes/* into js/runtimes/
```

The editor bundle is built with Node and npm (`editors/codemirror/build`) and committed, so neither is needed to serve the site.

## Testing

```sh
node --test                          # unit tests, in test/
heighliner login -- node --test      # the same, in the container (-- stops heighliner reading --test)
```

## Static site

```sh
API_BASE_URL=https://api.example.com/api/v1 bundle exec weaver build    # writes build/
```

`API_BASE_URL` is baked into the page. The backend must allow the site's origin for CORS (`FRONTEND_HOSTS`) and passkeys (`WEBAUTHN_ORIGINS`, and an RP id covering both frontends: backend docs/accounts.md).

## Deployment

`.github/workflows/pages.yml` runs the unit tests, builds the Zig runtime from a checkout of the frontend (`davidsiaw/manafe`), copies it in with `bin/sync-runtimes`, builds the site, removes the MathJax that weaver bundles (160 MB, unused) and, on `master`, deploys it to GitHub Pages at https://manamo.astrobunny.net, calling the backend at `https://manabase.astrobunny.net/api/v1`. Set up once:

1. Settings > Pages > Source: GitHub Actions.
2. DNS: a `CNAME` record from `manamo.astrobunny.net` to `davidsiaw.github.io`.
3. Settings > Pages > Custom domain: `manamo.astrobunny.net`, then Enforce HTTPS once the certificate is issued.
