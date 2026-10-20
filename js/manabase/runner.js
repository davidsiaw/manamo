/*
    Running learners' programs, and the code editor. Ports of the frontend's
    CodeRunner.j and CodeEditor.j (see ../frontend/docs/runtimes.md); the
    runtimes themselves are the frontend's, copied by bin/sync-runtimes.
*/
(function(root)
{
    "use strict";

    var L = root.ManabaseLogic;

    /*
        Runs a program in a Web Worker per language
        (js/runtimes/<language>/worker.js), downloaded the first time a
        program in that language runs, and kept for the next run.

        One program runs at a time. Starting another, or stop(), terminates
        the worker of the one before, and its callback is never called. So
        does a program that runs longer than CODE_RUN_TIMEOUT_SECONDS; its
        callback gets status "timeout". The clock starts when the program
        starts, not while the runtime downloads or compiles.
    */
    function CodeRunner()
    {
        this.workers = {};      // language -> Worker
        this.current = null;    // { id, language, callback, progress, timer }
        this.lastId = 0;
    }

    CodeRunner.prototype.run = function(code, language, progress, callback)
    {
        this.stop();

        var worker = this._workerFor(language);
        if (!worker)
            return callback({ status: "unavailable" });

        this.current = { id: ++this.lastId, language: language, callback: callback, progress: progress, timer: null };
        worker.postMessage({ id: this.current.id, code: code });
    };

    CodeRunner.prototype.isRunning = function()
    {
        return !!this.current;
    };

    CodeRunner.prototype.stop = function()
    {
        if (!this.current)
            return;
        this._discardWorker(this.current.language);
        this._endCurrent();
    };

    CodeRunner.prototype._workerFor = function(language)
    {
        if (this.workers[language])
            return this.workers[language];

        var path = L.codeRunWorkerPath(language);
        if (!path)
            return null;

        var self = this, worker;
        try
        {
            worker = new Worker(path);
        }
        catch (e)
        {
            return null;
        }

        worker.onmessage = function(event) { self._said(worker, language, event.data); };
        // A worker script that fails to load or throws while starting.
        worker.onerror = function(event)
        {
            event.preventDefault();
            self._said(worker, language, { type: "failed", message: event.message });
        };

        this.workers[language] = worker;
        return worker;
    };

    CodeRunner.prototype._said = function(worker, language, message)
    {
        var self = this,
            current = this.current;

        if (this.workers[language] !== worker)
            return; // terminated already

        if (message.type === "failed")
        {
            this._discardWorker(language);
            if (current && current.language === language)
                this._finish({ status: "unavailable" });
            return;
        }

        if (!current || message.id !== current.id)
            return;

        if (message.type === "progress")
        {
            if (current.progress)
                current.progress(message.message);
        }
        else if (message.type === "started")
        {
            current.timer = root.setTimeout(function()
            {
                self._discardWorker(language);
                self._finish({ status: "timeout", stdout: "", stderr: "" });
            }, L.CODE_RUN_TIMEOUT_SECONDS * 1000);
        }
        else if (message.type === "done")
        {
            this._finish({
                status: message.status === 0 ? "ok" : "error",
                stdout: message.stdout,
                stderr: message.stderr,
                truncated: message.truncated
            });
        }
    };

    CodeRunner.prototype._discardWorker = function(language)
    {
        if (this.workers[language])
            this.workers[language].terminate();
        delete this.workers[language];
    };

    CodeRunner.prototype._endCurrent = function()
    {
        if (this.current && this.current.timer)
            root.clearTimeout(this.current.timer);
        this.current = null;
    };

    CodeRunner.prototype._finish = function(result)
    {
        var callback = this.current.callback;
        this._endCurrent();
        callback(result);
    };

    // The editor script, loaded once, when the first code is shown.
    var editorScript = null;

    function loadEditor()
    {
        if (!editorScript)
            editorScript = new Promise(function(resolve, reject)
            {
                var script = document.createElement("script");
                script.src = "js/editors/codemirror/codemirror.js";
                script.onload = function()
                {
                    root.ManabaseCodeEditor ? resolve(root.ManabaseCodeEditor) : reject(new Error("no editor in script"));
                };
                script.onerror = function() { reject(new Error("could not load " + script.src)); };
                document.head.appendChild(script);
            });
        return editorScript;
    }

    /*
        A code editor in host: CodeMirror once its script has loaded, and a
        plain textarea if it cannot be, so the learner can still work. Until
        then, getCode() returns the code it was given.

        options: { code, language, readOnly }
    */
    function CodeEditor(host, options)
    {
        var self = this;
        this.host = host;
        this.pendingCode = options.code || "";
        this.editor = null;
        this.fallback = null;

        loadEditor().then(function(factory)
        {
            if (self.destroyed)
                return;
            host.textContent = "";
            self.editor = factory.create(host, { code: self.pendingCode, language: options.language, readOnly: options.readOnly });
        }, function()
        {
            if (self.destroyed || options.readOnly)
                return; // read-only code stays as the placeholder shows it
            self.fallback = document.createElement("textarea");
            self.fallback.className = "code-fallback";
            self.fallback.value = self.pendingCode;
            self.fallback.setAttribute("autocapitalize", "off");
            self.fallback.setAttribute("autocorrect", "off");
            self.fallback.spellcheck = false;
            host.textContent = "";
            host.appendChild(self.fallback);
        });
    }

    CodeEditor.prototype.getCode = function()
    {
        if (this.editor)
            return this.editor.getCode();
        if (this.fallback)
            return this.fallback.value;
        return this.pendingCode;
    };

    // Text at the cursor, for the keys a phone keyboard hides.
    CodeEditor.prototype.insert = function(text)
    {
        if (this.editor)
            return this.editor.insert(text);
        if (this.fallback)
        {
            var area = this.fallback, start = area.selectionStart;
            area.setRangeText(text, start, area.selectionEnd, "end");
            area.focus();
        }
    };

    CodeEditor.prototype.destroy = function()
    {
        this.destroyed = true;
        if (this.editor)
            this.editor.destroy();
    };

    root.ManabaseRunner = { CodeRunner: CodeRunner, CodeEditor: CodeEditor, loadEditor: loadEditor };
})(this);
