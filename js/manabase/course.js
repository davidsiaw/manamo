/*
    The course screen: the problem, with the problem tree in a drawer that
    slides in from the left (on a wide screen, a column beside it), a bar
    with the course and where the learner is, and Previous and Next along
    the bottom. Revision mode lives at the top of the drawer.

    Behaves as the frontend's CourseController.j and ProblemView.j do; see
    ../frontend/docs/course-screen.md.
*/
(function(root)
{
    "use strict";

    var L = root.ManabaseLogic,
        D = root.ManabaseDom,
        R = root.ManabaseRunner,
        h = D.h;

    var REVISION_HELP = [
        "Revision mode lets you go through the course again from the start, to practise what you have learned. " +
        "It is often said that you need to do an exercise three times before you truly know it.",
        "Your first time through is kept: switch revision mode off to see it and carry on with it.",
        "In a revision the answers are shuffled, so that you have to know the answer rather than remember where it was.",
        "The \u00D7N next to a problem shows how many times you have solved it. Start over begins a new revision; " +
        "an unfinished one is left behind."
    ];

    // The keys a phone keyboard hides away, for code problems.
    var CODE_KEYS = ["\u21E5", "(", ")", "{", "}", "[", "]", "|", ":", ";", "=", "\"", "'", "#", "<", ">", "&", "_"];

    // Shared by every problem, so that a runtime is downloaded once.
    var sharedRunner = null;
    function codeRunner()
    {
        return sharedRunner || (sharedRunner = new R.CodeRunner());
    }

    function CourseScreen(app, courseId)
    {
        this.app = app;
        this.api = app.api;
        this.courseId = courseId;
        this.tree = null;
        this.progress = null;
        this.revisionMode = false;
        this.startingRevision = false;
        this.currentProblemId = null;
        this.wantedProblemId = null;
        this.problem = null;
        this.editor = null;
        this.running = false;

        this._build();
        this.load();
    }

    CourseScreen.prototype._build = function()
    {
        var self = this;

        this.titleEl = h("span", { class: "course-bar-title", text: "" });
        this.countEl = h("span", { class: "course-bar-count" });
        this.bar = h("div", { class: "course-bar" },
            h("button", { class: "btn btn-default course-bar-toggle", type: "button", "aria-label": "Problems",
                          onclick: function() { self.openDrawer(); } }, D.icon("list-ul"), h("span", { text: " Problems" })),
            this.titleEl, this.countEl);

        this.revisionCheck = h("input", { type: "checkbox", disabled: true, onchange: function() { self.toggleRevisionMode(); } });
        this.roundEl = h("div", { class: "revision-status" });
        this.helpEl = h("div", { class: "revision-help", hidden: true }, REVISION_HELP.map(function(t) { return h("p", { text: t }); }));
        this.startOverButton = h("button", { class: "btn btn-default btn-sm", type: "button", hidden: true,
                                             onclick: function() { self.startOver(); } }, D.icon("refresh"), " Start over");
        this.treeEl = h("nav", { class: "problem-tree", "aria-label": "Problems" });
        this.drawerTitle = h("h3", { class: "drawer-title" });

        this.drawer = h("aside", { class: "course-drawer", "aria-label": "Course" },
            h("div", { class: "drawer-head" },
                this.drawerTitle,
                h("button", { class: "btn btn-link drawer-close", type: "button", "aria-label": "Close",
                              onclick: function() { self.closeDrawer(); } }, D.icon("times"))),
            h("div", { class: "revision-box" },
                h("div", { class: "revision-row" },
                    h("label", { class: "switch" }, this.revisionCheck, h("span", { class: "switch-track" }), " Revision mode"),
                    h("button", { class: "btn btn-link revision-help-toggle", type: "button", "aria-label": "What is revision mode?",
                                  onclick: function() { self.helpEl.hidden = !self.helpEl.hidden; } }, D.icon("question-circle"))),
                this.helpEl, this.roundEl, this.startOverButton),
            this.treeEl);
        this.backdrop = h("div", { class: "drawer-backdrop", onclick: function() { self.closeDrawer(); } });

        this.problemEl = h("main", { class: "problem" }, D.spinner());
        this.prevLink = h("a", { class: "problem-nav-prev" });
        this.nextLink = h("a", { class: "problem-nav-next" });
        this.nav = h("div", { class: "problem-nav" }, this.prevLink, this.nextLink);

        this.element = h("div", { class: "course-screen" },
            this.bar, h("div", { class: "course-layout" }, this.drawer, this.backdrop, this.problemEl), this.nav);

        this._onKey = function(event) { if (event.key === "Escape") self.closeDrawer(); };
        document.addEventListener("keydown", this._onKey);
    };

    CourseScreen.prototype.destroy = function()
    {
        this.destroyed = true;
        this._stopRunning();
        document.removeEventListener("keydown", this._onKey);
        document.body.classList.remove("drawer-open");
    };

    CourseScreen.prototype.openDrawer = function()
    {
        document.body.classList.add("drawer-open");
        var current = this.treeEl.querySelector(".current");
        if (current)
            current.scrollIntoView({ block: "center" });
    };

    CourseScreen.prototype.closeDrawer = function()
    {
        document.body.classList.remove("drawer-open");
    };

    CourseScreen.prototype.path = function(suffix)
    {
        return "/courses/" + encodeURIComponent(this.courseId) + (suffix || "");
    };

    CourseScreen.prototype.load = function()
    {
        var self = this;
        this.api.get(this.path()).then(function(r)
        {
            if (self.destroyed)
                return;
            if (r.status !== 200)
                return self.showStatus(r.status === 404 ? "There is no such course." : "Could not load the course (" + r.status + ").");

            self.tree = new L.CourseTree(r.body);
            self.titleEl.textContent = r.body.title;
            self.drawerTitle.textContent = r.body.title;
            document.title = r.body.title + " \u00B7 Manabase";
            // Top-level sections start open.
            self.tree.rootNodes.forEach(function(node) { node.open = true; });

            return self.api.get(self.path("/progress")).then(function(r)
            {
                if (self.destroyed)
                    return;
                if (r.status === 401)
                    return self.app.sessionWasRejected();
                if (r.status !== 200)
                    return self.showStatus("Could not load your progress (" + r.status + ").");

                self.progress = r.body;
                self.revisionCheck.disabled = false;
                self.showProblem(self.wantedProblemId, self.revisionMode);
            });
        });
    };

    CourseScreen.prototype.showStatus = function(message)
    {
        this.problemEl.textContent = "";
        this.problemEl.appendChild(D.alertBox("danger", message));
    };

    // The round answers go to: 1, or the current revision's number.
    CourseScreen.prototype.round = function()
    {
        return this.revisionMode && this.progress && this.progress.revision ? this.progress.revision.number : 1;
    };

    /*
        null means wherever the learner should carry on: the first problem
        not solved in the round shown. Revision mode without a revision
        starts one.
    */
    CourseScreen.prototype.showProblem = function(problemId, isRevision)
    {
        var self = this,
            modeChanged = isRevision !== this.revisionMode;

        this.wantedProblemId = problemId;
        this.revisionMode = isRevision;
        this.closeDrawer();
        if (!this.tree || !this.progress)
            return; // load() comes back here

        if (isRevision && !this.progress.revision)
            return this.startRevision();

        if (modeChanged || !this.currentProblemId)
            this.applyProgress();

        if (!problemId || !this.tree.node(problemId))
            // Put the problem in the URL; the router then comes back here.
            return root.location.replace(L.routerCoursePath(this.courseId, this.tree.firstUnsolvedProblemId(), isRevision));

        if (problemId === this.currentProblemId && !modeChanged)
            return;

        this.currentProblemId = problemId;
        L.courseNodeAncestors(this.tree.node(problemId)).forEach(function(node) { node.open = true; });
        this.renderTree();
        this._stopRunning();
        this.problemEl.textContent = "";
        this.problemEl.appendChild(D.spinner());

        var round = this.round();
        this.api.get(this.path("/problems/" + encodeURIComponent(problemId) + (round > 1 ? "?round=" + round : ""))).then(function(r)
        {
            // A slower, earlier request may answer after the learner moved on.
            if (self.destroyed || problemId !== self.currentProblemId || round !== self.round())
                return;
            if (r.status !== 200)
                return self.showStatus("Could not load this problem (" + r.status + ").");

            self.renderProblem(r.body);
            root.scrollTo(0, 0);
        });
    };

    // The tree, the bar and the revision box, for the round shown.
    CourseScreen.prototype.applyProgress = function()
    {
        var tree = this.tree,
            progress = this.progress,
            total = tree.problemIds.length,
            times = progress.times_completed;

        tree.applyProgress(progress, this.revisionMode);
        this.renderTree();

        this.revisionCheck.checked = this.revisionMode;
        this.startOverButton.hidden = !this.revisionMode;
        this.element.classList.toggle("revision-mode", this.revisionMode);
        this.countEl.textContent = tree.solvedCount() + "/" + total;
        this.roundEl.textContent = this.revisionMode
            ? L.revisionNumberText(progress.revision.number) + ": " + tree.solvedCount() + " / " + total + " solved"
            : (times === 0 ? "Not completed yet" : "Completed " + L.timesText(times));
    };

    CourseScreen.prototype.renderTree = function()
    {
        var self = this;
        this.treeEl.textContent = "";
        this.treeEl.appendChild(h("ul", {}, this.tree.rootNodes.map(function(node) { return self._treeNode(node); })));
    };

    CourseScreen.prototype._treeNode = function(node)
    {
        var self = this;

        if (node.problemId)
        {
            var times = L.courseTreeTimesLabel(node.timesSolved, this.revisionMode),
                current = node.problemId === this.currentProblemId;
            return h("li", {},
                h("a", { class: "tree-problem" + (node.solved ? " solved" : "") + (current ? " current" : ""),
                         href: L.routerCoursePath(this.courseId, node.problemId, this.revisionMode),
                         "aria-current": current ? "page" : null },
                  h("span", { class: "tree-mark", text: node.solved ? "\u2713" : "\u25CB" }),
                  h("span", { class: "tree-title", text: node.title }),
                  times && h("span", { class: "times", text: times })));
        }

        var counts = L.courseNodeCounts(node),
            done = counts.total > 0 && counts.solved === counts.total,
            details = h("details", { open: !!node.open },
                h("summary", { class: done ? "solved" : "" },
                  h("span", { class: "tree-mark", text: done ? "\u2713" : "\u25CB" }),
                  h("span", { class: "tree-title", text: node.title }),
                  h("span", { class: "count", text: counts.solved + "/" + counts.total })),
                h("ul", {}, node.children.map(function(child) { return self._treeNode(child); })));
        details.addEventListener("toggle", function() { node.open = details.open; });
        return h("li", {}, details);
    };

    // Revisions

    CourseScreen.prototype.toggleRevisionMode = function()
    {
        // The URL decides; applyProgress() then sets the switch to match.
        this.revisionCheck.checked = this.revisionMode;
        root.location.hash = L.routerCoursePath(this.courseId, null, !this.revisionMode);
    };

    CourseScreen.prototype.startRevision = function()
    {
        var self = this;
        if (this.startingRevision)
            return;
        this.startingRevision = true;

        this.api.post(this.path("/revisions")).then(function(r)
        {
            self.startingRevision = false;
            if (self.destroyed)
                return;
            if (r.status === 401)
                return self.app.sessionWasRejected();
            if (r.status !== 201)
                return self.showStatus("Could not start a revision (" + r.status + ").");

            self.progress = r.body;
            self.currentProblemId = null;
            // To the first problem in revision mode, through the router if
            // the URL changes (it then comes back here), or directly.
            var path = L.routerCoursePath(self.courseId, null, true);
            if (root.location.hash === path)
                self.showProblem(null, true);
            else
                root.location.replace(path);
        });
    };

    CourseScreen.prototype.startOver = function()
    {
        var solved = this.tree.solvedCount();
        if (solved === 0)
            return; // nothing to lose, and nothing to gain

        var finished = solved === this.tree.problemIds.length,
            question = finished
                ? "Start another revision? You go through the course again from the start."
                : "Start this revision over? It is left unfinished, and you go through the course again from the start. Your other progress is kept.";
        if (root.confirm(question))
            this.startRevision();
    };

    // The problem

    CourseScreen.prototype.renderProblem = function(problem)
    {
        var self = this,
            isCode = problem.type === "code",
            isLocal = isCode && problem.run === "local",
            node = this.tree.node(problem.id);

        this.problem = problem;
        if (this.editor)
            this.editor.destroy();
        this.editor = null;

        this.titleEl2 = h("h1", { class: "problem-title" }, h("span", { text: problem.title }), h("span", { class: "solved-mark", text: " \u2713" }));
        this.feedbackEl = h("div", { class: "feedback", "aria-live": "polite" });
        this.checkButton = h("button", { class: "btn btn-primary btn-lg btn-block", type: "button",
                                         onclick: function() { self.check(); } }, D.icon("check"), " Check answer");
        this.outputEl = h("pre", { class: "run-output", hidden: true });

        var exercise = [];
        if (isCode)
        {
            var host = h("div", { class: "code-editor" + (isLocal ? " code-editor-local" : "") }, h("pre", { text: problem.starter_code || "" }));
            this.editor = new R.CodeEditor(host, { code: problem.starter_code, language: problem.language });
            exercise.push(host, this._keyBar());

            if (isLocal)
            {
                this.pasteEl = h("textarea", { class: "form-control paste-box", rows: 6, autocapitalize: "off", autocorrect: "off",
                                               spellcheck: "false", placeholder: "Paste the output here" });
                exercise.push(
                    h("button", { class: "btn btn-default btn-block", type: "button", onclick: function() { self.copyCode(); } },
                      D.icon("copy"), " Copy code"),
                    h("label", { class: "paste-label", text: "What your program printed:" }),
                    this.pasteEl, this.checkButton);
            }
            else
            {
                this.runButton = h("button", { class: "btn btn-default btn-lg", type: "button", onclick: function() { self.runThenSubmit(false); } },
                                   D.icon("play"), " Run");
                this.checkButton.classList.remove("btn-block");
                exercise.push(h("div", { class: "button-row" }, this.runButton, this.checkButton), this.outputEl);
            }
        }
        else
        {
            exercise.push(h("div", { class: "choices", role: "radiogroup", "aria-label": "Answers" },
                (problem.choices || []).map(function(choice)
                {
                    return h("label", { class: "choice" },
                        h("input", { type: "radio", name: "choice", value: choice.id,
                                     onchange: function() { if (!self.solved) self.showFeedback(null); } }),
                        h("span", { class: "choice-text", text: choice.text }));
                })),
                this.checkButton);
        }

        this.problemEl.textContent = "";
        this.problemEl.appendChild(h("article", {},
            this.titleEl2,
            D.richText(problem.body, problem.language, "problem-body"),
            D.richText(problem.question, problem.language, "problem-question"),
            exercise,
            this.feedbackEl));

        this._setNeighbour(this.prevLink, problem.previous, [D.icon("chevron-left"), " "], null);
        this._setNeighbour(this.nextLink, problem.next, null, [" ", D.icon("chevron-right")]);
        this.setSolved(node && node.solved);
    };

    CourseScreen.prototype._setNeighbour = function(link, neighbour, before, after)
    {
        link.textContent = "";
        link.classList.toggle("disabled", !neighbour);
        if (!neighbour)
        {
            link.removeAttribute("href");
            return;
        }
        link.href = L.routerCoursePath(this.courseId, neighbour.id, this.revisionMode);
        link.appendChild(h("span", { class: "problem-nav-inner" }, before, h("span", { class: "problem-nav-title", text: neighbour.title }), after));
    };

    CourseScreen.prototype._keyBar = function()
    {
        var self = this;
        return h("div", { class: "key-bar", "aria-hidden": "true" }, CODE_KEYS.map(function(key)
        {
            var button = h("button", { class: "btn btn-default", type: "button", tabindex: "-1", text: key });
            // Keep the focus, and with it the keyboard, in the editor.
            button.addEventListener("pointerdown", function(event) { event.preventDefault(); });
            button.addEventListener("mousedown", function(event) { event.preventDefault(); });
            button.addEventListener("click", function() { self.editor.insert(key === "\u21E5" ? "  " : key); });
            return button;
        }));
    };

    CourseScreen.prototype.setSolved = function(isSolved)
    {
        this.solved = !!isSolved;
        this.titleEl2.classList.toggle("solved", this.solved);
    };

    // message: text (formatted, code and all) or null to clear.
    CourseScreen.prototype.showFeedback = function(message, isCorrect)
    {
        this.feedbackEl.textContent = "";
        if (!message)
            return;
        this.feedbackEl.appendChild(D.alertBox(isCorrect ? "success" : "danger", D.richText(message, this.problem.language)));
        this.feedbackEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };

    CourseScreen.prototype.check = function()
    {
        var problem = this.problem;
        if (problem.type === "code" && problem.run === "local")
        {
            var pasted = this.pasteEl.value;
            if (!pasted.trim())
                return this.showFeedback("Run the program on your computer and paste what it printed first.", false);
            this.showFeedback(null);
            return this.submit({ output: pasted }, "Not quite: your program ran, but did not print what the question asks for.");
        }
        if (problem.type === "code")
            return this.runThenSubmit(true);

        var picked = this.problemEl.querySelector("input[name=choice]:checked");
        if (!picked)
            return this.showFeedback("Pick an answer first.", false);
        this.submit({ choice: picked.value }, "Not quite. Try again.");
    };

    CourseScreen.prototype.copyCode = function()
    {
        var self = this,
            failed = function() { self.showFeedback("Could not copy it for you: select the code in the editor and copy it.", false); };

        if (!navigator.clipboard || !navigator.clipboard.writeText)
            return failed();
        navigator.clipboard.writeText(this.editor.getCode()).then(function()
        {
            self.showFeedback("Copied. Paste it into src/main.rs.", true);
        }, failed);
    };

    /*
        Runs the program and shows what it printed. To check the answer, the
        output is then sent, but only if the program ran to the end.
    */
    CourseScreen.prototype.runThenSubmit = function(shouldSubmit)
    {
        var self = this,
            problem = this.problem;

        this._setRunning(true);
        this.showFeedback(null);
        this._showOutput("Running\u2026");

        codeRunner().run(this.editor.getCode(), problem.language, function(message)
        {
            if (self.problem === problem)
                self._showOutput(message);
        }, function(result)
        {
            if (self.problem !== problem || self.destroyed)
                return;
            self._setRunning(false);
            self._showOutput(L.codeRunOutputText(result));

            if (!shouldSubmit)
                return;
            if (result.status === "ok")
                self.submit({ output: result.stdout }, "Not quite: your program ran, but did not print what the question asks for.");
            else if (result.status === "error")
                self.showFeedback("Your program stopped with an error. Fix it and try again.", false);
        });
    };

    CourseScreen.prototype._showOutput = function(text)
    {
        this.outputEl.hidden = false;
        this.outputEl.textContent = text;
    };

    CourseScreen.prototype._setRunning = function(isRunning)
    {
        this.running = isRunning;
        if (this.runButton)
            this.runButton.disabled = isRunning;
        if (this.checkButton)
            this.checkButton.disabled = isRunning;
    };

    CourseScreen.prototype._stopRunning = function()
    {
        if (this.running)
            codeRunner().stop();
        this.running = false;
    };

    CourseScreen.prototype.submit = function(answer, wrongMessage)
    {
        var self = this,
            problemId = this.currentProblemId,
            round = this.round(),
            button = this.checkButton;

        answer.round = round;
        button.disabled = true;
        this.api.post(this.path("/problems/" + encodeURIComponent(problemId) + "/answer"), answer).then(function(r)
        {
            if (self.destroyed)
                return;
            button.disabled = false;
            if (r.status === 401)
                return self.app.sessionWasRejected();
            if (problemId !== self.currentProblemId || round !== self.round())
                return;
            if (r.status === 409)
                return self.showFeedback("This revision was replaced by a newer one. Reload the page to carry on.", false);
            if (r.status !== 200)
                return self.showFeedback("Could not check your answer (" + r.status + ").", false);
            if (!r.body.correct)
                return self.showFeedback(wrongMessage, false);

            var timesBefore = self.progress.times_completed;
            self.progress = r.body.progress;
            self.applyProgress();
            self.setSolved(true);

            var message = "Correct! " + (r.body.explanation || "");
            if (self.progress.times_completed > timesBefore)
                message += "\n\n" + (self.revisionMode ? "Revision complete! " : "Course complete! ") +
                           "You have completed this course " + L.timesText(self.progress.times_completed) + ".";
            self.showFeedback(message, true);
        });
    };

    root.ManabaseCourse = { CourseScreen: CourseScreen };
})(this);
