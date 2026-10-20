/*
    Zig syntax highlighting, as a CodeMirror stream mode: keywords, types,
    builtins (@import), strings, characters, numbers and comments. Zig has no
    maintained CodeMirror package, and this is all that problem text and
    beginner programs need.
*/
const KEYWORDS = new Set((
    "addrspace align allowzero and anyframe anytype asm break callconv catch comptime const continue " +
    "defer else enum errdefer error export extern fn for if inline linksection noalias noinline nosuspend " +
    "opaque or orelse packed pub resume return struct suspend switch test threadlocal try union " +
    "unreachable usingnamespace var volatile while"
).split(" "));

const ATOMS = new Set(["true", "false", "null", "undefined"]);

const TYPE = /^(?:[iu]\d+|f16|f32|f64|f80|f128|usize|isize|bool|void|noreturn|type|anyerror|anyopaque|comptime_int|comptime_float|c_char|c_short|c_ushort|c_int|c_uint|c_long|c_ulong|c_longlong|c_ulonglong|c_longdouble)$/;

export const zig = {
    name: "zig",
    token(stream) {
        if (stream.eatSpace()) return null;
        if (stream.match("//")) {
            stream.skipToEnd();
            return "comment";
        }
        if (stream.match("\\\\")) {          // a line of a multiline string
            stream.skipToEnd();
            return "string";
        }
        if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/))
            return "string";
        if (stream.match(/^@[A-Za-z_]\w*/))
            return "builtin";
        if (stream.match(/^(?:0x[\da-fA-F_]+(?:\.[\da-fA-F_]+)?|0o[0-7_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/))
            return "number";
        if (stream.match(/^[A-Za-z_]\w*/)) {
            const word = stream.current();
            if (KEYWORDS.has(word)) return "keyword";
            if (ATOMS.has(word)) return "atom";
            if (TYPE.test(word)) return "type";
            return "variable";
        }
        stream.next();
        return null;
    },
    languageData: { commentTokens: { line: "//" } },
};
