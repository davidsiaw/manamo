/*
    Small helpers for building the page, and the API client. Everything the
    backend sends is put on the page as text (textContent), never as HTML.
*/
(function(root)
{
    "use strict";

    var L = root.ManabaseLogic;

    // h("div", { class: "x", onclick: f }, "text", child, [more children])
    function h(tag, props)
    {
        var el = document.createElement(tag);
        Object.keys(props || {}).forEach(function(key)
        {
            var value = props[key];
            if (value === null || value === undefined || value === false)
                return;
            if (key === "class")
                el.className = value;
            else if (key === "text")
                el.textContent = value;
            else if (key.indexOf("on") === 0 && typeof value === "function")
                el.addEventListener(key.substring(2), value);
            else
                el.setAttribute(key, value === true ? "" : value);
        });
        append(el, Array.prototype.slice.call(arguments, 2));
        return el;
    }

    function append(el, children)
    {
        children.forEach(function(child)
        {
            if (child === null || child === undefined || child === false)
                return;
            if (Array.isArray(child))
                append(el, child);
            else
                el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
        });
    }

    function icon(name)
    {
        return h("i", { class: "fa fa-" + name, "aria-hidden": "true" });
    }

    /*
        Problem text: prose in paragraphs, code in read-only highlighted
        editors (the plain code is shown until the editor script loads).
        Lines kept apart by the formatter, such as list items, stay apart
        through CSS (white-space: pre-line).
    */
    function richText(text, language, className)
    {
        var box = h("div", { class: "rich-text " + (className || "") });
        L.textFormatBlocks(text).forEach(function(block)
        {
            if (!block.code)
                return block.text.split("\n\n").forEach(function(paragraph)
                {
                    box.appendChild(h("p", { text: paragraph }));
                });

            var host = h("div", { class: "code-block" }, h("pre", { text: block.text }));
            box.appendChild(host);
            new root.ManabaseRunner.CodeEditor(host, { code: block.text, language: language, readOnly: true });
        });
        return box;
    }

    // An alert box: kind is success, danger, info or warning.
    function alertBox(kind, content)
    {
        return h("div", { class: "alert alert-" + kind, role: kind === "danger" ? "alert" : "status" }, content);
    }

    function spinner(text)
    {
        return h("div", { class: "loading" }, h("span", { class: "spinner" }), text || "Loading\u2026");
    }

    /*
        JSON over fetch. Resolves to { status, body } whatever the status;
        status 0 means the server could not be reached.
    */
    function Api(baseURL)
    {
        this.baseURL = baseURL;
        this.token = null;
    }

    Api.prototype.request = function(method, path, body)
    {
        var headers = {};
        if (this.token)
            headers.Authorization = "Bearer " + this.token;
        if (body)
            headers["Content-Type"] = "application/json";

        return fetch(this.baseURL + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
            .then(function(response)
            {
                return response.text().then(function(text)
                {
                    var parsed = null;
                    try { parsed = JSON.parse(text); } catch (e) { }
                    return { status: response.status, body: parsed };
                });
            }, function()
            {
                return { status: 0, body: null };
            });
    };

    Api.prototype.get = function(path) { return this.request("GET", path); };
    Api.prototype.post = function(path, body) { return this.request("POST", path, body); };
    Api.prototype.del = function(path) { return this.request("DELETE", path); };

    // Runs a WebAuthn ceremony. Resolves to { credential } or { error }.
    function passkeyCeremony(kind, optionsJSON)
    {
        if (!root.PublicKeyCredential || !navigator.credentials)
            return Promise.resolve({ error: "This browser does not support passkeys." });

        var call = kind === "create"
            ? navigator.credentials.create({ publicKey: L.passkeysCreationOptions(optionsJSON) })
            : navigator.credentials.get({ publicKey: L.passkeysRequestOptions(optionsJSON) });

        return call.then(function(credential)
        {
            return { credential: L.passkeysCredentialToJSON(credential) };
        }, function(error)
        {
            return { error: L.passkeysErrorMessage(error) };
        });
    }

    root.ManabaseDom = {
        h: h, icon: icon, richText: richText, alertBox: alertBox, spinner: spinner,
        Api: Api, passkeyCeremony: passkeyCeremony
    };
})(this);
