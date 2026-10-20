/*
    The mobile site: startup, routing, the course menu, My progress, and
    registering, logging in and out. The course screen is course.js.

    It does what the frontend's AppController.j does (see
    ../frontend/docs/architecture.md and accounts.md), laid out for a phone:

    - Navigation always goes through the URL hash; the hashchange listener
      routes. Never both set the hash and route.
    - A rejected session starts over once per page load, never more: an
      unbounded retry once created 54,000 learners.
    - Passkey ceremonies start straight from a tap, with their options
      fetched beforehand, because Safari refuses a ceremony that is not
      started by the user.
*/
(function(root)
{
    "use strict";

    var L = root.ManabaseLogic,
        D = root.ManabaseDom,
        h = D.h;

    function App(config)
    {
        this.api = new D.Api(config.apiBaseUrl);
        this.auth = new L.AuthStore(root.localStorage);
        this.content = document.getElementById("app");
        this.ready = false;
        this.routeGeneration = 0;
        this.sessionRestarts = 0;
        this.course = null;     // the CourseScreen, kept while in one course
    }

    App.prototype.start = function()
    {
        var self = this;
        root.addEventListener("hashchange", function() { self.route(); });
        this._wireNavbar();
        this.showMessage(D.spinner());
        this.startSession();
    };

    // The account entries in the navigation bar (source/index.weave).
    App.prototype._wireNavbar = function()
    {
        var self = this;
        $(document).on("click", "#navbar a", function()
        {
            // The bar is collapsed into the menu button on a phone: close it.
            $("#navbar.in").collapse("hide");
        });
        $(document).on("click", ".account-logout a", function(event)
        {
            event.preventDefault();
            self.logOut();
        });
    };

    App.prototype._updateNavbar = function()
    {
        var state = this.auth.state();
        $(".account-email").toggle(state === "registered");
        $(".account-email .nav-label").contents().filter(function() { return this.nodeType === 3; }).remove();
        $(".account-email .nav-label").append(document.createTextNode(" " + (this.auth.email() || "")));
        $(".account-register").toggle(state !== "registered");
        $(".account-login").toggle(state !== "registered");
        $(".account-logout").toggle(state === "registered");
    };

    // Startup: who is the learner? Then show the screen the URL asks for.

    App.prototype.startSession = function()
    {
        var self = this,
            state = this.auth.state();

        if (state === "registered" || state === "anonymous")
        {
            this.api.token = this.auth.token();
            this.api.get("/me").then(function(r)
            {
                if (r.status === 401)
                    return self.sessionWasRejected();
                if (r.status !== 200)
                    return self.showError("Could not reach the server (" + r.status + ").");
                self.auth.setEmail(r.body.email);
                self.authChanged();
            });
        }
        else if (state === "loggedOut")
            this.authChanged();
        else
        {
            this.api.token = null;
            this.api.post("/learners").then(function(r)
            {
                if (r.status !== 201)
                    return self.showError("Could not reach the server (" + r.status + ").");
                self.auth.startAnonymousSession(r.body.token);
                self.authChanged();
            });
        }
    };

    // Who we are changed: update everything that depends on it, then show
    // hash, or the current screen again. Routes exactly once.
    App.prototype.authChanged = function(hash)
    {
        this.ready = true;
        this.api.token = this.auth.token();
        this._updateNavbar();
        if (this.course)
            this.course.destroy(); // its progress belonged to the previous learner
        this.course = null;

        if (hash && hash !== root.location.hash)
            root.location.hash = hash;
        else
            this.route();
    };

    // The server no longer knows our session. Start over, but only once.
    App.prototype.sessionWasRejected = function()
    {
        if (++this.sessionRestarts > 1)
            return this.showError("The server keeps rejecting this browser's session. Please reload the page to try again.");
        this.auth.endSession();
        this.startSession();
    };

    // Screens

    App.prototype.route = function()
    {
        if (!this.ready)
            return;

        var route = L.routerParse(root.location.hash),
            generation = ++this.routeGeneration;

        document.body.classList.toggle("on-course", route.screen === "course");

        if (route.screen !== "course" && this.course)
        {
            this.course.destroy();
            this.course = null;
        }

        if (this.auth.state() === "loggedOut" && route.screen !== "register" && route.screen !== "login")
            return this.showLogin(true);

        switch (route.screen)
        {
            case "course":   return this.showCourse(route);
            case "me":       return this.showProfile(generation);
            case "register": return this.showRegister();
            case "login":    return this.showLogin(false);
            default:         return this.showMenu(generation);
        }
    };

    App.prototype.isCurrent = function(generation)
    {
        return generation === this.routeGeneration;
    };

    App.prototype.show = function(node)
    {
        this.content.textContent = "";
        this.content.appendChild(node);
    };

    App.prototype.showPage = function()
    {
        var page = h("div", { class: "page" }, Array.prototype.slice.call(arguments));
        this.show(page);
        root.scrollTo(0, 0);
        return page;
    };

    App.prototype.showMessage = function(content)
    {
        this.showPage(content);
    };

    App.prototype.showError = function(message)
    {
        this.showPage(D.alertBox("danger", message));
    };

    App.prototype.showMenu = function(generation)
    {
        var self = this;
        this.showMessage(D.spinner());
        this.api.get("/courses").then(function(r)
        {
            if (!self.isCurrent(generation))
                return;
            if (r.status !== 200)
                return self.showError("Could not load the courses (" + r.status + ").");

            self.showPage(h("h1", { class: "page-title", text: "Courses" }),
                          h("div", { class: "course-cards" }, r.body.map(courseCard)));
        });
    };

    App.prototype.showProfile = function(generation)
    {
        var self = this;
        this.showMessage(D.spinner());
        this.api.get("/me").then(function(r)
        {
            if (!self.isCurrent(generation))
                return;
            if (r.status === 401)
                return self.sessionWasRejected();
            if (r.status !== 200)
                return self.showError("Could not load your progress (" + r.status + ").");

            var me = r.body;
            self.showPage(
                h("h1", { class: "page-title", text: "My progress" }),
                me.email
                    ? h("p", { class: "lead-text" }, "Logged in as ", h("strong", { text: me.email }), ".")
                    : h("div", { class: "card-box" },
                        h("p", { text: "You are not registered, so your progress is kept only in this browser. " +
                                       "Register with your email and a passkey to keep it, and to log in from other devices." }),
                        h("a", { class: "btn btn-primary btn-block", href: "#/register" }, D.icon("user-plus"), " Register")),
                me.courses.length === 0 && h("div", { class: "card-box" },
                    h("p", { text: "You have not started a course yet." }),
                    h("a", { class: "btn btn-default btn-block", href: "#/" }, "Browse courses")),
                h("div", { class: "course-cards" }, me.courses.map(courseCard)));
        });
    };

    // A course from GET /courses or GET /me, with progress when known.
    function courseCard(summary)
    {
        var started = summary.solved_count !== null && summary.solved_count !== undefined,
            link = L.routerCoursePath(summary.id, summary.next_problem_id, false),
            percent = summary.problem_count ? Math.round(100 * (summary.solved_count || 0) / summary.problem_count) : 0;

        return h("div", { class: "course-card" },
            h("a", { class: "course-card-title", href: link }, h("h2", { text: summary.title })),
            summary.description && h("p", { class: "course-card-description clamped", text: L.textFormatReflow(summary.description),
                                            onclick: function() { this.classList.toggle("clamped"); } }),
            started && h("div", { class: "course-card-progress" },
                h("div", { class: "progress" },
                    h("div", { class: "progress-bar", role: "progressbar", style: "width: " + percent + "%",
                               "aria-valuenow": summary.solved_count, "aria-valuemin": 0, "aria-valuemax": summary.problem_count })),
                h("div", { class: "progress-text", text: L.summaryProgressText(summary) })),
            h("a", { class: "btn btn-primary btn-block", href: link },
              started && summary.solved_count > 0 ? "Continue" : "Start", " ", D.icon("arrow-right")),
            started && summary.revision && h("div", { class: "course-card-revision" },
                h("div", { class: "progress-text",
                           text: L.revisionNumberText(summary.revision.number) + ": " + summary.revision.solved_count +
                                 " / " + summary.problem_count + " solved" }),
                h("a", { class: "btn btn-default btn-block", href: L.routerCoursePath(summary.id, summary.revision.next_problem_id, true) },
                  D.icon("refresh"), " Continue revision")));
    }

    App.prototype.showCourse = function(route)
    {
        if (!this.course || this.course.courseId !== route.courseId)
        {
            if (this.course)
                this.course.destroy();
            this.course = new root.ManabaseCourse.CourseScreen(this, route.courseId);
        }
        if (this.content.firstChild !== this.course.element)
            this.show(this.course.element);
        this.course.showProblem(route.problemId, route.revision);
    };

    // Account: register. Two steps: the email, then the passkey, so that
    // the passkey is created straight from a tap (see the top of the file).

    App.prototype.showRegister = function()
    {
        var self = this,
            state = this.auth.state();

        if (state === "registered")
            return root.location.replace("#/me");

        var feedback = h("div", { class: "form-feedback" }),
            email = h("input", { class: "form-control input-lg", type: "email", name: "email", required: true,
                                 autocomplete: "username webauthn", autocapitalize: "off", placeholder: "you@example.com",
                                 "aria-label": "Email" }),
            submit = h("button", { class: "btn btn-primary btn-lg btn-block", type: "submit" }, "Continue"),
            form = h("form", { class: "account-form", novalidate: true }, email, submit, feedback);

        var fail = function(message)
        {
            feedback.textContent = "";
            if (message)
                feedback.appendChild(D.alertBox("danger", message));
            submit.disabled = false;
        };

        form.addEventListener("submit", function(event)
        {
            event.preventDefault();
            var address = email.value.trim();
            if (!address)
                return fail("Enter your email first.");
            fail("");
            submit.disabled = true;
            self._registrationOptions(address).then(function(result)
            {
                if (result.error)
                    return fail(result.error);
                self._showCreatePasskey(address, result.token, result.options);
            });
        });

        this.showPage(
            h("h1", { class: "page-title", text: state === "loggedOut" ? "Create an account" : "Register" }),
            h("p", { text: state === "loggedOut"
                ? "Create a new account with your email and a passkey."
                : "Enter your email, then create a passkey for it. Your progress so far is kept. " +
                  "You log in with the passkey from then on, with no password." }),
            form,
            h("p", { class: "account-switch" }, "Already registered? ", h("a", { href: "#/login", text: "Log in" })));
    };

    // A logged-out browser registers a brand new learner, whose token is
    // only kept once registration succeeds, so that giving up halfway does
    // not leave this browser anonymous. Resolves to { token, options } or
    // { error }.
    App.prototype._registrationOptions = function(address)
    {
        var self = this,
            session = this.auth.token()
                ? Promise.resolve({ token: this.auth.token() })
                : this.api.post("/learners").then(function(r)
                  {
                      return r.status === 201 ? { token: r.body.token } : { error: "Could not reach the server (" + r.status + ")." };
                  });

        return session.then(function(s)
        {
            if (s.error)
                return s;
            self.api.token = s.token;
            return self.api.post("/registration/options", { email: address }).then(function(r)
            {
                if (r.status !== 200)
                    return { error: L.registrationErrorMessage(r.body && r.body.error, r.status) };
                return { token: s.token, options: r.body };
            });
        });
    };

    App.prototype._showCreatePasskey = function(address, token, options)
    {
        var self = this,
            feedback = h("div", { class: "form-feedback" }),
            button = h("button", { class: "btn btn-primary btn-lg btn-block", type: "button" }, D.icon("key"), " Create passkey");

        button.addEventListener("click", function()
        {
            button.disabled = true;
            feedback.textContent = "";
            D.passkeyCeremony("create", options).then(function(result)
            {
                if (result.error)
                    return { error: result.error };
                return self.api.post("/registration", { credential: result.credential }).then(function(r)
                {
                    if (r.status !== 200)
                        return { error: L.registrationErrorMessage(r.body && r.body.error, r.status) };
                    self.auth.becomeRegistered(r.body.email, token);
                    self.authChanged("#/me");
                    return {};
                });
            }).then(function(result)
            {
                if (!result.error)
                    return;
                feedback.appendChild(D.alertBox("danger", result.error));
                button.disabled = false;
                // A used or expired challenge cannot be tried again.
                if (/took too long|could not be verified/.test(result.error))
                    feedback.appendChild(h("a", { class: "btn btn-default btn-block", href: "#/register",
                                                  onclick: function() { self.route(); } }, "Start again"));
            });
        });

        this.showPage(
            h("h1", { class: "page-title", text: "Create a passkey" }),
            h("p", {}, "For ", h("strong", { text: address }), ". Your phone or browser will ask you to confirm with your " +
                       "fingerprint, face or screen lock."),
            button, feedback,
            h("p", { class: "account-switch" }, h("a", { href: "#/register", onclick: function() { self.route(); },
                                                         text: "Use a different email" })));
    };

    // Account: log in and out.

    // loggedOut: shown instead of whatever the URL asks for, which is shown
    // after logging in. Otherwise #/login, which goes to the menu after.
    App.prototype.showLogin = function(isRequired)
    {
        var self = this,
            options = null,
            optionsAt = 0,
            feedback = h("div", { class: "form-feedback" }),
            button = h("button", { class: "btn btn-primary btn-lg btn-block", type: "button", disabled: true },
                       D.icon("key"), " Log in with a passkey");

        // Fetched now, so that the tap starts the ceremony directly. The
        // challenge lasts five minutes; an older one is fetched again.
        var fetchOptions = function()
        {
            button.disabled = true;
            return self.api.post("/login/options").then(function(r)
            {
                if (r.status !== 200)
                {
                    feedback.textContent = "";
                    feedback.appendChild(D.alertBox("danger", "Could not reach the server (" + r.status + ")."));
                    return;
                }
                options = r.body;
                optionsAt = Date.now();
                button.disabled = false;
            });
        };

        var logIn = function()
        {
            feedback.textContent = "";
            if (!options || Date.now() - optionsAt > 4 * 60 * 1000)
                return fetchOptions().then(function() { if (options) logIn(); });

            button.disabled = true;
            var used = options;
            options = null;
            D.passkeyCeremony("get", used).then(function(result)
            {
                if (result.error)
                    return { error: result.error };
                return self.api.post("/login", { credential: result.credential }).then(function(r)
                {
                    if (r.status !== 200)
                        return { error: r.body && r.body.error === "unknown_passkey"
                            ? "This passkey does not belong to an account here."
                            : "Could not log in (" + r.status + ")." };
                    // Any anonymous progress in this browser is left behind.
                    self.auth.becomeRegistered(r.body.email, r.body.token);
                    self.authChanged(isRequired ? null : "#/");
                    return {};
                });
            }).then(function(result)
            {
                if (!result.error)
                    return;
                feedback.appendChild(D.alertBox("danger", result.error));
                fetchOptions(); // a challenge is good for one try
            });
        };

        button.addEventListener("click", logIn);

        this.showPage(
            h("h1", { class: "page-title", text: isRequired ? "You are logged out" : "Log in" }),
            h("p", { text: isRequired ? "Log in with your passkey to carry on where you left off."
                                      : "Log in with the passkey you registered. Progress made here without an account stays behind." }),
            button, feedback,
            h("p", { class: "account-switch" }, isRequired ? "Or start again with " : "No account yet? ",
              h("a", { href: "#/register", text: isRequired ? "a new account" : "Register" })));

        fetchOptions();
    };

    App.prototype.logOut = function()
    {
        // The session ends locally whatever the server says.
        this.api.del("/session");
        this.auth.endSession();
        this.authChanged();
    };

    root.ManabaseApp = App;
})(this);
