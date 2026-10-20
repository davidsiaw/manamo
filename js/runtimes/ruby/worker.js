/*
    Runs Ruby programs for Manabase, on mruby compiled to WebAssembly
    (runtimes/mruby/build). It runs in a Web Worker so that a program that
    never ends cannot freeze the page: the page terminates the worker instead.

    Every language's worker speaks the same protocol (docs/runtimes.md):

      page -> worker   { id, code }
      worker -> page   { id, type: "started" }   the runtime is loaded and the program starts
      worker -> page   { id, type: "done", status, stdout, stderr, truncated }
                       status 0: it ran to the end; anything else: it failed, and stderr says why
      worker -> page   { type: "failed", message }   the runtime could not be loaded
*/

importScripts("mruby.js");

// Bytes of output kept per program; a program printing in a loop would
// otherwise fill memory until the page gives up on it.
var MAX_OUTPUT_BYTES = 100000;

var stdoutBytes = [],
    stderrBytes = [],
    outputBytes = 0,
    truncated = false;

function collectInto(bytes)
{
    return function(aByte)
    {
        if (aByte === null)
            return; // a flush
        if (outputBytes >= MAX_OUTPUT_BYTES)
        {
            truncated = true;
            return;
        }
        outputBytes++;
        bytes.push(aByte);
    };
}

function decode(bytes)
{
    return new TextDecoder().decode(new Uint8Array(bytes));
}

// Emscripten calls these for every byte, which keeps output that does not
// end in a new line (print "x") and decodes UTF-8 correctly. There is no
// input: gets returns nil.
var runtime = createMruby({
    stdin: function() { return null; },
    stdout: collectInto(stdoutBytes),
    stderr: collectInto(stderrBytes)
});

runtime.catch(function(anError)
{
    postMessage({ type: "failed", message: String(anError) });
});

onmessage = function(anEvent)
{
    var id = anEvent.data.id,
        code = anEvent.data.code;

    runtime.then(function(mruby)
    {
        stdoutBytes.length = 0;
        stderrBytes.length = 0;
        outputBytes = 0;
        truncated = false;

        postMessage({ id: id, type: "started" });
        var status = mruby.ccall("manabase_run", "number", ["string"], [code]);
        postMessage({
            id: id,
            type: "done",
            status: status,
            stdout: decode(stdoutBytes),
            stderr: decode(stderrBytes),
            truncated: truncated
        });
    });
};
