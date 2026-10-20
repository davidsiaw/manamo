// Unit tests for js/manabase/logic.js: `node --test test/`. Mostly the
// frontend's tests/unit, ported, since the logic is a port of its files.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/manabase/logic.js");

function memoryStorage()
{
    const items = {};
    return {
        getItem: (k) => (k in items ? items[k] : null),
        setItem: (k, v) => { items[k] = String(v); },
        removeItem: (k) => { delete items[k]; }
    };
}

const bytes = (buffer) => Array.from(new Uint8Array(buffer));
const buffer = (array) => new Uint8Array(array).buffer;

// AuthStore

test("a new browser is fresh, then anonymous with a token", () =>
{
    const auth = new L.AuthStore(memoryStorage());
    assert.equal(auth.state(), "fresh");
    auth.startAnonymousSession("t1");
    assert.equal(auth.state(), "anonymous");
    assert.equal(auth.token(), "t1");
});

test("registering keeps the token and adds the email", () =>
{
    const auth = new L.AuthStore(memoryStorage());
    auth.startAnonymousSession("t1");
    auth.becomeRegistered("a@example.com", null);
    assert.equal(auth.state(), "registered");
    assert.equal(auth.token(), "t1");
});

test("a browser that has logged in is logged out, not fresh, after its session ends", () =>
{
    const auth = new L.AuthStore(memoryStorage());
    auth.becomeRegistered("a@example.com", "t2");
    auth.endSession();
    assert.equal(auth.state(), "loggedOut");
    assert.equal(auth.email(), null);
});

test("an anonymous session that ends is fresh again", () =>
{
    const auth = new L.AuthStore(memoryStorage());
    auth.startAnonymousSession("t1");
    auth.endSession();
    assert.equal(auth.state(), "fresh");
});

test("the server's email replaces the stored one, and none removes it", () =>
{
    const auth = new L.AuthStore(memoryStorage());
    auth.startAnonymousSession("t1");
    auth.setEmail("b@example.com");
    assert.equal(auth.state(), "registered");
    auth.setEmail(null);
    assert.equal(auth.state(), "anonymous");
});

// Router

test("routes the hash to a screen", () =>
{
    assert.deepEqual(L.routerParse(""), { screen: "menu" });
    assert.deepEqual(L.routerParse("#/"), { screen: "menu" });
    assert.deepEqual(L.routerParse("#/nonsense/x/y/z"), { screen: "menu" });
    assert.deepEqual(L.routerParse("#/me"), { screen: "me" });
    assert.deepEqual(L.routerParse("#/register"), { screen: "register" });
    assert.deepEqual(L.routerParse("#/login"), { screen: "login" });
    assert.deepEqual(L.routerParse("#/courses/ruby-basics"),
                     { screen: "course", courseId: "ruby-basics", problemId: null, revision: false });
    assert.deepEqual(L.routerParse("#/revise/ruby-basics/hello%20world"),
                     { screen: "course", courseId: "ruby-basics", problemId: "hello world", revision: true });
});

test("builds course paths that route back to the same place", () =>
{
    const path = L.routerCoursePath("a b", "c/d", true);
    assert.equal(path, "#/revise/a%20b/c%2Fd");
    assert.deepEqual(L.routerParse(path), { screen: "course", courseId: "a b", problemId: "c/d", revision: true });
    assert.equal(L.routerCoursePath("x", null, false), "#/courses/x");
});

// Passkeys

test("base64url round-trips bytes that need the URL alphabet", () =>
{
    assert.equal(L.bufferToBase64URL(buffer([0xfb, 0xff])), "-_8");
    assert.deepEqual(bytes(L.base64URLToBuffer("-_8")), [0xfb, 0xff]);
    for (const array of [[1], [1, 2], [1, 2, 3]])
        assert.deepEqual(bytes(L.base64URLToBuffer(L.bufferToBase64URL(buffer(array)))), array);
});

test("creation options decode the challenge and user id", () =>
{
    const options = L.passkeysCreationOptions({ challenge: "AQI", user: { id: "AwQ", name: "a@example.com" },
                                                rp: { id: "example.com" } });
    assert.deepEqual(bytes(options.challenge), [1, 2]);
    assert.deepEqual(bytes(options.user.id), [3, 4]);
    assert.equal(options.user.name, "a@example.com");
    assert.equal(options.rp.id, "example.com");
});

test("request options decode allowed credentials", () =>
{
    const options = L.passkeysRequestOptions({ challenge: "AQI", allowCredentials: [{ type: "public-key", id: "BQY" }] });
    assert.deepEqual(bytes(options.allowCredentials[0].id), [5, 6]);
    assert.equal(options.allowCredentials[0].type, "public-key");
});

test("an assertion becomes JSON with base64url fields", () =>
{
    const json = L.passkeysCredentialToJSON({
        type: "public-key", id: "Bwg", rawId: buffer([7, 8]), authenticatorAttachment: "platform",
        getClientExtensionResults: () => ({}),
        response: { clientDataJSON: buffer([1]), authenticatorData: buffer([2]), signature: buffer([3]), userHandle: buffer([4]) }
    });
    assert.equal(json.rawId, "Bwg");
    assert.deepEqual([json.response.clientDataJSON, json.response.authenticatorData, json.response.signature,
                      json.response.userHandle], ["AQ", "Ag", "Aw", "BA"]);
    assert.ok(!("attestationObject" in json.response));
});

test("a cancelled passkey request says so", () =>
{
    assert.equal(L.passkeysErrorMessage({ name: "NotAllowedError" }), "The passkey request was cancelled.");
    assert.equal(L.passkeysErrorMessage({ name: "SecurityError", message: "bad rp" }), "The passkey request failed: bad rp");
});

test("registration errors become messages", () =>
{
    assert.match(L.registrationErrorMessage("email_taken", 409), /already registered/);
    assert.equal(L.registrationErrorMessage(undefined, 500), "Could not register (500).");
});

// TextFormat

test("joins wrapped lines and keeps paragraphs apart", () =>
{
    assert.equal(L.textFormatReflow("one two\nthree\n"), "one two three");
    assert.equal(L.textFormatReflow("one\ntwo\n\nthree"), "one two\n\nthree");
});

test("keeps indented code lines as they are", () =>
{
    const text = "A function:\n\n    fn add(a: u32) -> u32 {\n        a\n    }\n\nAfter.";
    assert.equal(L.textFormatReflow(text), text);
    assert.equal(L.textFormatReflow("See:\n    let x = 5;\nthen"), "See:\n\n    let x = 5;\n\nthen");
});

test("keeps list items on their own lines, joining their wrapped text", () =>
{
    assert.equal(L.textFormatReflow("Methods:\n- one wraps\nhere\n- two"), "Methods:\n- one wraps here\n- two");
    assert.equal(L.textFormatReflow("Two kinds:\n- one that wraps onto\n  the next line\n- two"),
                 "Two kinds:\n- one that wraps onto the next line\n- two");
});

test("splits prose from code", () =>
{
    const blocks = L.textFormatBlocks("A function:\n\n  fn five() -> i32 {\n      5\n  }\n\nThat is all.");
    assert.deepEqual(blocks.map((b) => b.code), [false, true, false]);
    assert.equal(blocks[1].text, "fn five() -> i32 {\n    5\n}");
    assert.deepEqual(L.textFormatBlocks("See:\n    let x = 5;\nthen more").map((b) => b.text),
                     ["See:", "let x = 5;", "then more"]);
});

test("keeps neighbouring paragraphs of one kind in one block", () =>
{
    assert.deepEqual(L.textFormatBlocks("One\ntwo.\n\nThree."), [{ code: false, text: "One two.\n\nThree." }]);
    assert.deepEqual(L.textFormatBlocks("  impl A {\n  }\n\n  impl B {\n  }"), [{ code: true, text: "impl A {\n}\n\nimpl B {\n}" }]);
});

test("list continuations are prose, deeper lines code", () =>
{
    const blocks = L.textFormatBlocks("- an item\n  that wraps\n    code_under_it();");
    assert.deepEqual(blocks, [{ code: false, text: "- an item that wraps" }, { code: true, text: "code_under_it();" }]);
});

test("no text has no blocks", () =>
{
    assert.deepEqual(L.textFormatBlocks(null), []);
    assert.deepEqual(L.textFormatBlocks("  \n"), []);
    assert.equal(L.textFormatReflow(undefined), "");
});

// CourseTree

function sampleTree()
{
    return new L.CourseTree({
        title: "Sample",
        sections: [
            { title: "First", problems: [{ id: "one", title: "One" }],
              sections: [{ title: "Nested", problems: [{ id: "two", title: "Two" }], sections: [] }] },
            { title: "Second", problems: [{ id: "three", title: "Three" }], sections: [] }
        ]
    });
}

const progress = (solved, revision, times) =>
    ({ solved, revision, times_solved: times || {}, times_completed: 0 });

test("orders problems as the tree shows them, a section's own first", () =>
{
    const tree = sampleTree();
    assert.deepEqual(tree.problemIds, ["one", "two", "three"]);
    assert.deepEqual(tree.rootNodes[0].children.map((n) => n.title), ["One", "Nested"]);
});

test("lists ancestors outermost first", () =>
{
    const tree = sampleTree();
    assert.deepEqual(L.courseNodeAncestors(tree.node("two")).map((n) => n.title), ["First", "Nested"]);
});

test("first unsolved skips solved problems, and falls back to the first", () =>
{
    const tree = sampleTree();
    tree.applyProgress(progress(["one", "deleted"], null), false);
    assert.equal(tree.firstUnsolvedProblemId(), "two");
    tree.applyProgress(progress(["one", "two", "three"], null), false);
    assert.equal(tree.firstUnsolvedProblemId(), "one");
});

test("shows round 1 or the revision", () =>
{
    const tree = sampleTree(),
        p = progress(["one", "two"], { number: 2, solved: ["three"] }, { one: 1, two: 2, three: 2 });
    tree.applyProgress(p, false);
    assert.equal(tree.solvedCount(), 2);
    tree.applyProgress(p, true);
    assert.equal(tree.solvedCount(), 1);
    assert.equal(tree.node("one").solved, false);
    assert.equal(tree.node("two").timesSolved, 2);
});

test("revision mode needs a revision", () =>
{
    const tree = sampleTree();
    assert.equal(tree.applyProgress(progress([], null), true), false);
    assert.equal(tree.applyProgress(progress([], null), false), true);
});

test("sections count the problems under them", () =>
{
    const tree = sampleTree();
    tree.applyProgress(progress(["two"], null), false);
    const first = tree.rootNodes[0];
    assert.deepEqual(L.courseNodeCounts(first), { total: 2, solved: 1 });
    assert.deepEqual(L.courseNodeCounts(first.children[1]), { total: 1, solved: 1 });
    assert.equal(tree.node("nope"), null);
    assert.equal(tree.node("toString"), null);
});

test("times solved shows from two, or from one in a revision", () =>
{
    assert.equal(L.courseTreeTimesLabel(1, false), "");
    assert.equal(L.courseTreeTimesLabel(3, false), "\u00D73");
    assert.equal(L.courseTreeTimesLabel(1, true), "\u00D71");
    assert.equal(L.courseTreeTimesLabel(0, true), "");
});

// CodeRun

test("finds a language's worker, and refuses names that are not slugs", () =>
{
    assert.equal(L.codeRunWorkerPath("ruby"), "js/runtimes/ruby/worker.js");
    assert.equal(L.codeRunWorkerPath("../secrets"), null);
    assert.equal(L.codeRunWorkerPath("Ruby"), null);
    assert.equal(L.codeRunWorkerPath(null), null);
});

test("shows what the program printed, then any error", () =>
{
    assert.equal(L.codeRunOutputText({ status: "ok", stdout: "hello\n3\n", stderr: "" }), "hello\n3");
    assert.equal(L.codeRunOutputText({ status: "error", stdout: "1\n", stderr: "main.rb:2: boom\n" }), "1\nmain.rb:2: boom");
    assert.equal(L.codeRunOutputText({ status: "ok", stdout: "", stderr: "" }), "(Your program printed nothing.)");
});

test("explains a timeout, cut output and a missing runtime", () =>
{
    const timeout = L.codeRunOutputText({ status: "timeout", stdout: "", stderr: "" });
    assert.match(timeout, /more than 5 seconds/);
    assert.doesNotMatch(timeout, /printed nothing/);
    assert.equal(L.codeRunOutputText({ status: "ok", stdout: "xx", stderr: "", truncated: true }), "xx\n(Output cut short.)");
    assert.equal(L.codeRunOutputText({ status: "ok", stdout: "x".repeat(20010), stderr: "" }).length,
                 20000 + "\n(Output cut short.)".length);
    assert.match(L.codeRunOutputText({ status: "unavailable" }), /^Could not start/);
});

// Wording

test("course progress wording", () =>
{
    assert.equal(L.summaryProgressText({ solved_count: 3, problem_count: 6, times_completed: 0 }), "3 / 6 solved");
    assert.equal(L.summaryProgressText({ solved_count: 6, problem_count: 6, times_completed: 1 }),
                 "6 / 6 solved \u00B7 completed 1 time");
    assert.equal(L.revisionNumberText(2), "Revision 1");
});
