/*
    The code editor for the mobile site's code problems: CodeMirror 6,
    bundled into one script (js/editors/codemirror/codemirror.js) by ./build.

    The same API as ../frontend/editors/codemirror/editor.js, so the two can
    be compared line by line. What differs: a dark theme to match the site,
    a 16px font (a smaller one makes iOS zoom in when the editor is
    focused), and no autocorrect or capitalisation from touch keyboards.

      ManabaseCodeEditor.create(parent, { code, language, plain, readOnly }) -> editor
      editor.getCode() / editor.setCode(code) / editor.focus() / editor.destroy()

    plain is for text that is not code, such as pasted program output: no
    line numbers, highlighting or bracket handling. readOnly is for showing
    code in problem text: highlighted and selectable, but not editable, and
    as tall as its content.
*/
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { StreamLanguage, HighlightStyle, indentOnInput, indentUnit, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { zig } from "./zig-mode.js";

// Syntax highlighting per problem language; unknown languages get none.
const LANGUAGES = {
    ruby: () => StreamLanguage.define(ruby),
    rust: () => StreamLanguage.define(rust),
    shell: () => StreamLanguage.define(shell),
    zig: () => StreamLanguage.define(zig)
};

// Matches css/manabase.css.
const COLORS = {
    background: "#0b0e1c",
    codeBackground: "#11152a",
    gutter: "#0b0e1c",
    border: "#3b3f5c",
    text: "#e0e2ec",
    muted: "#6b7192",
    activeLine: "#161a33",
    selection: "#2c3566",
    cursor: "#1ab394"
};

const darkHighlight = HighlightStyle.define([
    { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.moduleKeyword, tags.definitionKeyword], color: "#c792ea" },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "#c3e88d" },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "#f78c6c" },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#6b7192", fontStyle: "italic" },
    { tag: [tags.typeName, tags.className, tags.namespace], color: "#ffcb6b" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], color: "#82aaff" },
    { tag: [tags.definition(tags.variableName), tags.variableName], color: "#e0e2ec" },
    { tag: [tags.propertyName, tags.attributeName], color: "#89ddff" },
    { tag: [tags.operator, tags.punctuation, tags.bracket], color: "#89ddff" },
    { tag: [tags.meta, tags.annotation, tags.processingInstruction], color: "#ffcb6b" },
    { tag: tags.invalid, color: "#ff5370" }
]);

const touchKeyboard = EditorView.contentAttributes.of({
    autocapitalize: "off", autocorrect: "off", spellcheck: "false"
});

const theme = EditorView.theme({
    "&": { height: "100%", fontSize: "16px", color: COLORS.text, backgroundColor: COLORS.background },
    ".cm-scroller": { fontFamily: "Menlo, Consolas, 'DejaVu Sans Mono', monospace", overflow: "auto" },
    ".cm-content": { caretColor: COLORS.cursor },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: COLORS.cursor, borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: COLORS.selection },
    ".cm-gutters": { backgroundColor: COLORS.gutter, color: COLORS.muted, borderRight: "1px solid " + COLORS.border },
    ".cm-activeLine": { backgroundColor: COLORS.activeLine },
    ".cm-activeLineGutter": { backgroundColor: COLORS.activeLine, color: COLORS.text },
    "&.cm-focused .cm-matchingBracket": { backgroundColor: "#2f4f4f", outline: "none" },
    "&.cm-focused": { outline: "none" }
}, { dark: true });

const readOnlyTheme = EditorView.theme({
    "&": { fontSize: "14px", color: COLORS.text, backgroundColor: COLORS.codeBackground },
    ".cm-scroller": { fontFamily: "Menlo, Consolas, 'DejaVu Sans Mono', monospace", lineHeight: "20px", overflowX: "auto" },
    ".cm-content": { padding: "10px 0" },
    ".cm-line": { padding: "0 12px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: COLORS.selection },
    "&.cm-focused": { outline: "none" }
}, { dark: true });

function readOnlyExtensions(language)
{
    const extensions = [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        syntaxHighlighting(darkHighlight),
        EditorState.tabSize.of(4),
        readOnlyTheme
    ];
    if (LANGUAGES[language])
        extensions.push(LANGUAGES[language]());
    return extensions;
}

function plainExtensions()
{
    return [drawSelection(), history(), keymap.of([...defaultKeymap, ...historyKeymap]), touchKeyboard, theme];
}

function extensionsFor(language)
{
    const extensions = [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        syntaxHighlighting(darkHighlight),
        indentUnit.of("  "),
        EditorState.tabSize.of(2),
        // Tab indents. Escape, then Tab, leaves the editor (CodeMirror's
        // answer to the keyboard trap an indenting Tab would be).
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        touchKeyboard,
        theme
    ];
    if (LANGUAGES[language])
        extensions.push(LANGUAGES[language]());
    return extensions;
}

window.ManabaseCodeEditor = {
    create(parent, options)
    {
        const extensions = options.readOnly ? readOnlyExtensions(options.language)
            : options.plain ? plainExtensions() : extensionsFor(options.language),
            view = new EditorView({
                parent,
                state: EditorState.create({ doc: options.code || "", extensions })
            });

        return {
            getCode: () => view.state.doc.toString(),
            // A new state, so undo does not go back into the previous problem.
            setCode: (code) => view.setState(EditorState.create({ doc: code || "", extensions })),
            // Inserts text at the cursor, for the keys a touch keyboard lacks.
            insert: (text) =>
            {
                view.dispatch(view.state.replaceSelection(text));
                view.focus();
            },
            focus: () => view.focus(),
            destroy: () => view.destroy()
        };
    }
};
