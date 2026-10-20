/*
    What the mobile site knows without touching the page: who the learner
    is, URL hash routing, WebAuthn JSON conversion, problem text, the
    problem tree and what to show for a program run.

    Each part is a port of a pure-logic file in ../frontend (AuthStore.j,
    Router.j, Passkeys.j, TextFormat.j, CourseTree.j, CodeRun.j) and behaves
    the same; the frontend's docs explain the decisions. Nothing here uses
    the DOM, so test/logic.test.js runs it in Node.
*/
(function(root)
{
    "use strict";

    // AuthStore: the session and the learner's state, in localStorage (or
    // any object with getItem, setItem and removeItem).
    //
    //   anonymous   a session for a learner with no email
    //   registered  a session for a learner with an email
    //   loggedOut   no session, and this browser has been registered or
    //               logged in before: it must log in or create an account,
    //               and does not quietly become anonymous again
    //   fresh       no session and never logged in; becomes anonymous

    var TOKEN_KEY = "manabase.token",
        EMAIL_KEY = "manabase.email",
        HAS_LOGGED_IN_KEY = "manabase.hasLoggedIn";

    function AuthStore(storage)
    {
        this.storage = storage;
    }

    AuthStore.prototype.token = function() { return this.storage.getItem(TOKEN_KEY); };
    AuthStore.prototype.email = function() { return this.storage.getItem(EMAIL_KEY); };

    AuthStore.prototype.state = function()
    {
        if (this.token())
            return this.email() ? "registered" : "anonymous";
        return this.storage.getItem(HAS_LOGGED_IN_KEY) ? "loggedOut" : "fresh";
    };

    AuthStore.prototype.startAnonymousSession = function(token)
    {
        this.storage.setItem(TOKEN_KEY, token);
        this.storage.removeItem(EMAIL_KEY);
    };

    // After registering, or after logging in with a new token.
    AuthStore.prototype.becomeRegistered = function(email, token)
    {
        if (token)
            this.storage.setItem(TOKEN_KEY, token);
        this.storage.setItem(EMAIL_KEY, email);
        this.storage.setItem(HAS_LOGGED_IN_KEY, "1");
    };

    // The server's view of who we are, from GET /me.
    AuthStore.prototype.setEmail = function(email)
    {
        if (email)
            this.becomeRegistered(email, null);
        else
            this.storage.removeItem(EMAIL_KEY);
    };

    // Logging out, or a session the server no longer knows.
    AuthStore.prototype.endSession = function()
    {
        this.storage.removeItem(TOKEN_KEY);
        this.storage.removeItem(EMAIL_KEY);
    };

    // Router: the URL hash decides the screen.
    //
    //   #/                          the course menu (also anything unknown)
    //   #/courses/<id>              a course, at its first unsolved problem
    //   #/courses/<id>/<problem>    a problem in a course
    //   #/revise/<id>[/<problem>]   the same, in revision mode
    //   #/me                        the learner's own page
    //   #/register                  registering an email and a passkey
    //   #/login                     logging in with a passkey

    function routerParse(hash)
    {
        var parts = (hash || "").replace(/^#\/?/, "").split("/").filter(function(p) { return p.length > 0; });

        if ((parts[0] === "courses" || parts[0] === "revise") && parts.length >= 2 && parts.length <= 3)
            return { screen: "course", courseId: decodeURIComponent(parts[1]),
                     problemId: parts[2] ? decodeURIComponent(parts[2]) : null,
                     revision: parts[0] === "revise" };

        if (parts.length === 1 && (parts[0] === "me" || parts[0] === "register" || parts[0] === "login"))
            return { screen: parts[0] };

        return { screen: "menu" };
    }

    function routerCoursePath(courseId, problemId, isRevision)
    {
        return (isRevision ? "#/revise/" : "#/courses/") + encodeURIComponent(courseId) +
               (problemId ? "/" + encodeURIComponent(problemId) : "");
    }

    // Passkeys: the server speaks WebAuthn options and credentials as JSON
    // with binary fields in base64url; navigator.credentials wants and
    // returns ArrayBuffers.

    function base64URLToBuffer(string)
    {
        var base64 = string.replace(/-/g, "+").replace(/_/g, "/");
        while (base64.length % 4)
            base64 += "=";

        var binary = atob(base64),
            bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }

    function bufferToBase64URL(buffer)
    {
        var bytes = new Uint8Array(buffer),
            binary = "";
        for (var i = 0; i < bytes.length; i++)
            binary += String.fromCharCode(bytes[i]);
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    function descriptors(list)
    {
        return (list || []).map(function(d)
        {
            var copy = Object.assign({}, d);
            copy.id = base64URLToBuffer(d.id);
            return copy;
        });
    }

    function passkeysCreationOptions(json)
    {
        var options = Object.assign({}, json);
        options.challenge = base64URLToBuffer(json.challenge);
        options.user = Object.assign({}, json.user, { id: base64URLToBuffer(json.user.id) });
        options.excludeCredentials = descriptors(json.excludeCredentials);
        return options;
    }

    function passkeysRequestOptions(json)
    {
        var options = Object.assign({}, json);
        options.challenge = base64URLToBuffer(json.challenge);
        options.allowCredentials = descriptors(json.allowCredentials);
        return options;
    }

    // A PublicKeyCredential as the JSON the webauthn gem reads.
    function passkeysCredentialToJSON(credential)
    {
        var response = credential.response,
            json = {};

        ["clientDataJSON", "attestationObject", "authenticatorData", "signature", "userHandle"].forEach(function(key)
        {
            if (response[key])
                json[key] = bufferToBase64URL(response[key]);
        });
        if (response.getTransports)
            json.transports = response.getTransports();

        return {
            type: credential.type,
            id: credential.id,
            rawId: bufferToBase64URL(credential.rawId),
            authenticatorAttachment: credential.authenticatorAttachment,
            clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
            response: json
        };
    }

    function passkeysErrorMessage(error)
    {
        // NotAllowedError covers both "cancelled" and "timed out".
        if (error && error.name === "NotAllowedError")
            return "The passkey request was cancelled.";
        return "The passkey request failed" + (error && error.message ? ": " + error.message : ".");
    }

    function registrationErrorMessage(code, status)
    {
        switch (code)
        {
            case "email_taken":         return "That email is already registered. Log in instead.";
            case "invalid_email":       return "That does not look like an email address.";
            case "already_registered":  return "You are already registered.";
            case "challenge_expired":   return "That took too long. Please try again.";
            case "invalid_credential":  return "The passkey could not be verified. Please try again.";
            default:                    return "Could not register (" + status + ").";
        }
    }

    // TextFormat: problem text from YAML, split into prose and code. Prose
    // lines within a paragraph are joined; a list item ("- ", "* ", "1. ")
    // keeps its own line, continued by lines indented up to its text; any
    // other indented line is code.

    var LIST_ITEM = /^(([-*]|\d+\.)\s+)/;

    // [{ code: false, text }, { code: true, text }, ...]. Consecutive prose
    // paragraphs make one block, separated by a blank line; code has its
    // common indentation removed.
    function textFormatBlocks(string)
    {
        var text = (string || "").replace(/\r\n/g, "\n").replace(/^\s*\n/, "").replace(/\s+$/, ""),
            blocks = [];

        if (!text)
            return blocks;

        var paragraphs = text.split(/\n[ \t]*\n/);
        for (var i = 0; i < paragraphs.length; i++)
        {
            var pieces = textFormatParagraph(paragraphs[i]);
            for (var j = 0; j < pieces.length; j++)
            {
                var piece = pieces[j],
                    last = blocks[blocks.length - 1];

                if (last && last.code === piece.code && j === 0)
                    Array.prototype.push.apply(last.lines, [""].concat(piece.lines));
                else
                    blocks.push(piece);
            }
        }

        return blocks.map(function(block)
        {
            return { code: block.code, text: block.code ? dedent(block.lines) : block.lines.join("\n") };
        });
    }

    // All of it as one string, with code indented by four spaces.
    function textFormatReflow(string)
    {
        return textFormatBlocks(string).map(function(block)
        {
            return block.code ? block.text.replace(/^(?=.)/gm, "    ") : block.text;
        }).join("\n\n");
    }

    function textFormatParagraph(paragraph)
    {
        var lines = paragraph.split("\n"),
            pieces = [],
            itemColumn = null;   // the column a list item's text starts at, while in one

        for (var i = 0; i < lines.length; i++)
        {
            var line = lines[i],
                indent = line.match(/^[ \t]*/)[0].length,
                item = line.match(LIST_ITEM),
                piece = pieces[pieces.length - 1];

            if (indent > 0 && !(itemColumn !== null && indent <= itemColumn))
            {
                itemColumn = null;
                if (piece && piece.code)
                    piece.lines.push(line);
                else
                    pieces.push({ code: true, lines: [line] });
                continue;
            }

            if (!piece || piece.code)
                pieces.push(piece = { code: false, lines: [] });

            if (item)
            {
                itemColumn = item[1].length;
                piece.lines.push(line);
            }
            else if (piece.lines.length)
                piece.lines[piece.lines.length - 1] += " " + line.trim();
            else
                piece.lines.push(line);
        }
        return pieces;
    }

    function dedent(lines)
    {
        var indents = lines.filter(function(l) { return l.trim(); })
                           .map(function(l) { return l.match(/^[ \t]*/)[0].length; }),
            common = indents.length ? Math.min.apply(Math, indents) : 0;

        return lines.map(function(l) { return l.substring(common); }).join("\n");
    }

    // CourseTree: the section tree from GET /courses/:id, and what is
    // solved in the round shown. A node is a section ({ title, children })
    // or a problem ({ title, problemId }).

    function CourseTree(json)
    {
        this.title = json.title;
        this.problemIds = [];   // in tree order
        this.byProblemId = {};
        this.rootNodes = this._sections(json.sections || [], null);
    }

    CourseTree.prototype._sections = function(sections, parent)
    {
        var self = this;
        return sections.map(function(section)
        {
            var node = { title: section.title, parent: parent, children: [] };
            // A section's own problems come before its subsections, as on the server.
            (section.problems || []).forEach(function(problem)
            {
                var child = { title: problem.title, problemId: problem.id, parent: node, solved: false, timesSolved: 0 };
                self.problemIds.push(problem.id);
                self.byProblemId[problem.id] = child;
                node.children.push(child);
            });
            node.children = node.children.concat(self._sections(section.sections || [], node));
            return node;
        });
    };

    CourseTree.prototype.node = function(problemId)
    {
        return Object.prototype.hasOwnProperty.call(this.byProblemId, problemId) ? this.byProblemId[problemId] : null;
    };

    // Shows round 1, or the current revision. Returns false when revision
    // mode is asked for but no revision has been started.
    CourseTree.prototype.applyProgress = function(progress, isRevision)
    {
        if (isRevision && !progress.revision)
            return false;

        var self = this;
        this.problemIds.forEach(function(id)
        {
            var node = self.byProblemId[id];
            node.solved = false;
            node.timesSolved = (progress.times_solved || {})[id] || 0;
        });
        // Ids the server does not know about any more are ignored.
        (isRevision ? progress.revision.solved : progress.solved).forEach(function(id)
        {
            var node = self.node(id);
            if (node)
                node.solved = true;
        });
        return true;
    };

    CourseTree.prototype.solvedCount = function()
    {
        var self = this;
        return this.problemIds.filter(function(id) { return self.byProblemId[id].solved; }).length;
    };

    CourseTree.prototype.firstUnsolvedProblemId = function()
    {
        for (var i = 0; i < this.problemIds.length; i++)
            if (!this.byProblemId[this.problemIds[i]].solved)
                return this.problemIds[i];
        return this.problemIds[0];
    };

    // Problems under a node, and how many of them are solved.
    function courseNodeCounts(node)
    {
        if (node.problemId)
            return { total: 1, solved: node.solved ? 1 : 0 };
        return node.children.reduce(function(sum, child)
        {
            var counts = courseNodeCounts(child);
            return { total: sum.total + counts.total, solved: sum.solved + counts.solved };
        }, { total: 0, solved: 0 });
    }

    // Outermost first.
    function courseNodeAncestors(node)
    {
        var result = [];
        for (var current = node.parent; current; current = current.parent)
            result.unshift(current);
        return result;
    }

    // "×N" after a problem: the rounds it has been solved in. Shown from two
    // on; in revision mode also at one, which marks what was solved before.
    function courseTreeTimesLabel(timesSolved, isRevision)
    {
        return timesSolved >= 2 || (isRevision && timesSolved >= 1) ? "\u00D7" + timesSolved : "";
    }

    // CodeRun: what to show for a program run.

    var CODE_RUN_TIMEOUT_SECONDS = 5,
        CODE_RUN_MAX_SHOWN = 20000;

    // The worker for a language, or null for a name that is not a plain
    // slug, so that a problem cannot point the site at another path.
    function codeRunWorkerPath(language)
    {
        if (typeof language !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(language))
            return null;
        return "js/runtimes/" + language + "/worker.js";
    }

    // result: { status: "ok" | "error" | "timeout" | "unavailable", stdout, stderr, truncated }
    function codeRunOutputText(result)
    {
        if (result.status === "unavailable")
            return "Could not start the runtime for this language. Reload the page and try again.";

        var parts = [];
        if (result.stdout)
            parts.push(result.stdout.replace(/\n$/, ""));
        if (result.stderr)
            parts.push(result.stderr.replace(/\n$/, ""));

        var text = parts.join("\n"),
            cut = result.truncated || text.length > CODE_RUN_MAX_SHOWN;
        text = text.substring(0, CODE_RUN_MAX_SHOWN);

        var notes = [];
        if (cut)
            notes.push("(Output cut short.)");
        if (result.status === "timeout")
            notes.push("Your program ran for more than " + CODE_RUN_TIMEOUT_SECONDS + " seconds and was stopped. Is there a loop that never ends?");
        if (!text && !notes.length)
            notes.push("(Your program printed nothing.)");

        return [text].concat(notes).filter(function(s) { return s; }).join("\n");
    }

    // Progress wording, as on the frontend's menu and course header.

    function timesText(n)
    {
        return n + (n === 1 ? " time" : " times");
    }

    function summaryProgressText(summary)
    {
        var times = summary.times_completed;
        return summary.solved_count + " / " + summary.problem_count + " solved" +
               (times ? " \u00B7 completed " + timesText(times) : "");
    }

    // Revision numbers shown to the learner start at 1: the backend's round 2.
    function revisionNumberText(round)
    {
        return "Revision " + (round - 1);
    }

    var exported = {
        AuthStore: AuthStore,
        routerParse: routerParse,
        routerCoursePath: routerCoursePath,
        base64URLToBuffer: base64URLToBuffer,
        bufferToBase64URL: bufferToBase64URL,
        passkeysCreationOptions: passkeysCreationOptions,
        passkeysRequestOptions: passkeysRequestOptions,
        passkeysCredentialToJSON: passkeysCredentialToJSON,
        passkeysErrorMessage: passkeysErrorMessage,
        registrationErrorMessage: registrationErrorMessage,
        textFormatBlocks: textFormatBlocks,
        textFormatReflow: textFormatReflow,
        CourseTree: CourseTree,
        courseNodeCounts: courseNodeCounts,
        courseNodeAncestors: courseNodeAncestors,
        courseTreeTimesLabel: courseTreeTimesLabel,
        CODE_RUN_TIMEOUT_SECONDS: CODE_RUN_TIMEOUT_SECONDS,
        codeRunWorkerPath: codeRunWorkerPath,
        codeRunOutputText: codeRunOutputText,
        timesText: timesText,
        summaryProgressText: summaryProgressText,
        revisionNumberText: revisionNumberText
    };

    if (typeof module !== "undefined" && module.exports)
        module.exports = exported;
    else
        root.ManabaseLogic = exported;
})(this);
