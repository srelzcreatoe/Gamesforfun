"""A small, strict Molang parser/evaluator for offline verification.

Supports what Tailwail (and the supplied clips) use: numbers, 'strings', variables
(v./variable./t./temp.), queries (q./query. with optional arguments), math.* functions,
unary - and !, * / + -, comparisons, == !=, && ||, ?? , ternary ?:, parentheses, and
statement lists `a = expr; b = expr;`.  Unknown identifiers or functions raise, so a typo
in a pack file fails the build instead of silently evaluating to 0 in game.
"""
import math
import re

TOKEN = re.compile(r"\s*(?:(\d+\.\d*|\.\d+|\d+)|('(?:[^'])*')|([A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*)|(\?\?|&&|\|\||==|!=|<=|>=|[-+*/()<>!?:,;=]))")

MATH = {
    "sin": lambda x: math.sin(math.radians(x)),
    "cos": lambda x: math.cos(math.radians(x)),
    "asin": lambda x: math.degrees(math.asin(max(-1, min(1, x)))),
    "acos": lambda x: math.degrees(math.acos(max(-1, min(1, x)))),
    "atan": lambda x: math.degrees(math.atan(x)),
    "atan2": lambda y, x: math.degrees(math.atan2(y, x)),
    "abs": abs, "max": max, "min": min, "sqrt": lambda x: math.sqrt(max(0, x)), "floor": math.floor, "ceil": math.ceil,
    "round": round, "trunc": math.trunc, "pow": lambda a, b: math.pow(a, b), "exp": math.exp, "ln": lambda x: math.log(x),
    "clamp": lambda x, lo, hi: max(lo, min(hi, x)),
    "mod": lambda a, b: math.fmod(a, b) if b else 0.0,
    "lerp": lambda a, b, t: a + (b - a) * t,
    "lerprotate": lambda a, b, t: a + (((b - a + 180) % 360) - 180) * t,
    "hermite_blend": lambda t: 3 * t * t - 2 * t * t * t,
    "sign": lambda x: (x > 0) - (x < 0),
    "pi": None,
}


class MolangError(Exception):
    pass


def tokenize(src):
    pos = 0
    out = []
    src = src.strip()
    while pos < len(src):
        m = TOKEN.match(src, pos)
        if not m or m.end() == pos:
            raise MolangError("bad token at %r" % src[pos:pos + 20])
        num, s, ident, op = m.groups()
        if num is not None:
            out.append(("num", float(num)))
        elif s is not None:
            out.append(("str", s[1:-1]))
        elif ident is not None:
            out.append(("id", ident.lower()))
        else:
            out.append(("op", op))
        pos = m.end()
    out.append(("end", None))
    return out


class Parser:
    def __init__(self, toks):
        self.t = toks
        self.i = 0

    def peek(self, k=0):
        return self.t[self.i + k]

    def take(self, kind=None, val=None):
        tok = self.t[self.i]
        if kind and tok[0] != kind or val is not None and tok[1] != val:
            raise MolangError("expected %s %s got %s" % (kind, val, tok))
        self.i += 1
        return tok

    def program(self):
        stmts = []
        while self.peek()[0] != "end":
            if self.peek() == ("op", ";"):
                self.take()
                continue
            stmts.append(self.statement())
            if self.peek() == ("op", ";"):
                self.take()
        return ("prog", stmts)

    def statement(self):
        tok = self.peek()
        if tok[0] == "id" and tok[1] == "return":
            self.take()
            return ("return", self.expr())
        if tok[0] == "id" and self.peek(1) == ("op", "="):
            name = self.take()[1]
            self.take("op", "=")
            if not re.match(r"^(v|variable|t|temp)\.", name):
                raise MolangError("can only assign variables, not %s" % name)
            return ("assign", canon(name), self.expr())
        return ("expr", self.expr())

    def expr(self):
        return self.ternary()

    def ternary(self):
        c = self.coalesce()
        if self.peek() == ("op", "?"):
            self.take()
            a = self.ternary()
            if self.peek() == ("op", ":"):
                self.take()
                b = self.ternary()
            else:
                b = ("num", 0.0)
            return ("tern", c, a, b)
        return c

    def coalesce(self):
        left = self.orr()
        while self.peek() == ("op", "??"):
            self.take()
            left = ("??", left, self.orr())
        return left

    def orr(self):
        left = self.andd()
        while self.peek() == ("op", "||"):
            self.take()
            left = ("||", left, self.andd())
        return left

    def andd(self):
        left = self.eq()
        while self.peek() == ("op", "&&"):
            self.take()
            left = ("&&", left, self.eq())
        return left

    def eq(self):
        left = self.rel()
        while self.peek()[0] == "op" and self.peek()[1] in ("==", "!="):
            op = self.take()[1]
            left = (op, left, self.rel())
        return left

    def rel(self):
        left = self.add()
        while self.peek()[0] == "op" and self.peek()[1] in ("<", "<=", ">", ">="):
            op = self.take()[1]
            left = (op, left, self.add())
        return left

    def add(self):
        left = self.mul()
        while self.peek()[0] == "op" and self.peek()[1] in ("+", "-"):
            op = self.take()[1]
            left = (op, left, self.mul())
        return left

    def mul(self):
        left = self.unary()
        while self.peek()[0] == "op" and self.peek()[1] in ("*", "/"):
            op = self.take()[1]
            left = (op, left, self.unary())
        return left

    def unary(self):
        if self.peek() == ("op", "-"):
            self.take()
            return ("neg", self.unary())
        if self.peek() == ("op", "!"):
            self.take()
            return ("not", self.unary())
        return self.primary()

    def primary(self):
        tok = self.take()
        if tok[0] == "num":
            return ("num", tok[1])
        if tok[0] == "str":
            return ("str", tok[1])
        if tok == ("op", "("):
            e = self.expr()
            self.take("op", ")")
            return e
        if tok[0] == "id":
            name = tok[1]
            args = None
            if self.peek() == ("op", "("):
                self.take()
                args = []
                if self.peek() != ("op", ")"):
                    args.append(self.expr())
                    while self.peek() == ("op", ","):
                        self.take()
                        args.append(self.expr())
                self.take("op", ")")
            return ("id", canon(name), args)
        raise MolangError("unexpected %s" % (tok,))


def canon(name):
    head, _, rest = name.partition(".")
    head = {"variable": "v", "query": "q", "temp": "t", "context": "c"}.get(head, head)
    return head + ("." + rest if rest else "")


def num(x):
    if isinstance(x, bool):
        return 1.0 if x else 0.0
    return x


class Context:
    """Evaluation context: variables + query callbacks.  queries: dict name -> value or callable(*args)."""

    def __init__(self, variables=None, queries=None, strict=True):
        self.v = variables if variables is not None else {}
        self.q = queries or {}
        self.strict = strict
        self.unknown = set()

    def ident(self, name, args):
        ns = name.split(".")[0]
        if ns in ("v", "t"):
            if name not in self.v:
                self.unknown.add(name)
                return 0.0
            return self.v[name]
        if ns == "q":
            if name not in self.q:
                raise MolangError("unknown query %s" % name)
            val = self.q[name]
            if callable(val):
                return val(*(args or []))
            return val
        if ns == "math":
            fname = name[5:]
            if fname == "pi":
                return 180.0 / 180.0 * math.pi
            if fname not in MATH or MATH[fname] is None:
                raise MolangError("unknown math function %s" % name)
            return float(MATH[fname](*[float(num(a)) for a in args or []]))
        raise MolangError("unknown identifier %s" % name)


def ev(node, ctx):
    k = node[0]
    if k == "num" or k == "str":
        return node[1]
    if k == "id":
        args = [ev(a, ctx) for a in node[2]] if node[2] is not None else None
        return ctx.ident(node[1], args)
    if k == "neg":
        return -num(ev(node[1], ctx))
    if k == "not":
        return 0.0 if num(ev(node[1], ctx)) else 1.0
    if k == "tern":
        return ev(node[2], ctx) if num(ev(node[1], ctx)) else ev(node[3], ctx)
    if k == "??":
        try:
            return ev(node[1], ctx)
        except MolangError:
            return ev(node[2], ctx)
    a = ev(node[1], ctx)
    if k == "&&":
        return 1.0 if num(a) and num(ev(node[2], ctx)) else 0.0
    if k == "||":
        return 1.0 if num(a) or num(ev(node[2], ctx)) else 0.0
    b = ev(node[2], ctx)
    if k == "==":
        return 1.0 if a == b else 0.0
    if k == "!=":
        return 1.0 if a != b else 0.0
    a, b = num(a), num(b)
    if isinstance(a, str) or isinstance(b, str):
        raise MolangError("arithmetic on string")
    if k == "+":
        return a + b
    if k == "-":
        return a - b
    if k == "*":
        return a * b
    if k == "/":
        return a / b if b else 0.0
    if k == "<":
        return 1.0 if a < b else 0.0
    if k == "<=":
        return 1.0 if a <= b else 0.0
    if k == ">":
        return 1.0 if a > b else 0.0
    if k == ">=":
        return 1.0 if a >= b else 0.0
    raise MolangError("bad node %s" % (k,))


_cache = {}


def parse(src):
    if isinstance(src, (int, float)):
        return ("prog", [("expr", ("num", float(src)))])
    if src not in _cache:
        _cache[src] = Parser(tokenize(src)).program()
    return _cache[src]


def run(src, ctx):
    """Executes a statement list; returns the value of the last expression / return."""
    prog = parse(src)
    val = 0.0
    for st in prog[1]:
        if st[0] == "assign":
            ctx.v[st[1]] = ev(st[2], ctx)
            val = ctx.v[st[1]]
        elif st[0] == "return":
            return ev(st[1], ctx)
        else:
            val = ev(st[1], ctx)
    return val


def identifiers(src):
    """All identifiers referenced (for static checks)."""
    out = set()

    def walk(n):
        if not isinstance(n, tuple):
            return
        if n[0] == "id":
            out.add(n[1])
            for a in n[2] or []:
                walk(a)
            return
        if n[0] == "assign":
            out.add(n[1])
            walk(n[2])
            return
        for c in n[1:]:
            if isinstance(c, tuple):
                walk(c)
            elif isinstance(c, list):
                for x in c:
                    walk(x)

    walk(parse(src))
    return out
