class_name Molang
extends RefCounted
## Bedrock "Molang" expression compiler/evaluator (docs/ARCHITECTURE.md §7).
##
## Expressions found in the DMZ `.animation.json` files are compiled ONCE into a
## flat RPN program (three packed arrays, no per-frame allocations) and then
## evaluated every frame against a context Dictionary:
##
##     var e := Molang.compile("-math.cos(query.anim_time *360) * 32")
##     e.evaluate({"query.anim_time": 0.25})
##
## Supported: numbers, `+ - * /`, unary minus, `!`, parentheses, comparisons
## (`< > <= >= == !=`), `&& ||`, the ternary `c ? a : b`, and the functions
## math.sin/cos/tan/asin/acos/atan/abs/clamp/lerp/lerprotate/mod/sqrt/floor/
## ceil/round/trunc/pow/min/max/exp/ln/sign/random/die_roll/hermite_blend.
## Trigonometric functions take/return DEGREES, like Bedrock.
##
## Variable namespaces are canonicalised so `q.` == `query.`, `v.` == `variable.`,
## `t.` == `temp.`, `c.` == `context.`; identifiers are lower-cased (the DMZ files
## contain both `math.sin` and `Math.sin`). Unknown variables evaluate to 0.
## `variable.*` / `temp.*` default to 0 as required by the contract.

# --- op codes -----------------------------------------------------------------
const OP_CONST := 0
const OP_VAR := 1
const OP_CALL := 2
const OP_BIN := 3
const OP_NEG := 4
const OP_NOT := 5
const OP_TERNARY := 6

# --- binary operators ---------------------------------------------------------
const B_ADD := 0
const B_SUB := 1
const B_MUL := 2
const B_DIV := 3
const B_LT := 4
const B_GT := 5
const B_LE := 6
const B_GE := 7
const B_EQ := 8
const B_NE := 9
const B_AND := 10
const B_OR := 11

const BIN_NAMES := {
	"+": B_ADD, "-": B_SUB, "*": B_MUL, "/": B_DIV,
	"<": B_LT, ">": B_GT, "<=": B_LE, ">=": B_GE,
	"==": B_EQ, "!=": B_NE, "&&": B_AND, "||": B_OR,
}
const BIN_PREC := {
	B_OR: 2, B_AND: 3, B_EQ: 4, B_NE: 4, B_LT: 5, B_GT: 5, B_LE: 5, B_GE: 5,
	B_ADD: 6, B_SUB: 6, B_MUL: 7, B_DIV: 7,
}

# --- functions ----------------------------------------------------------------
const F_SIN := 0
const F_COS := 1
const F_ABS := 2
const F_CLAMP := 3
const F_LERP := 4
const F_MOD := 5
const F_SQRT := 6
const F_FLOOR := 7
const F_POW := 8
const F_MIN := 9
const F_MAX := 10
const F_RANDOM := 11
const F_CEIL := 12
const F_ROUND := 13
const F_TRUNC := 14
const F_EXP := 15
const F_LN := 16
const F_SIGN := 17
const F_TAN := 18
const F_ASIN := 19
const F_ACOS := 20
const F_ATAN := 21
const F_ATAN2 := 22
const F_DIE_ROLL := 23
const F_HERMITE := 24
const F_LERPROTATE := 25

const FUNCS := {
	"math.sin": F_SIN, "math.cos": F_COS, "math.abs": F_ABS, "math.clamp": F_CLAMP,
	"math.lerp": F_LERP, "math.mod": F_MOD, "math.sqrt": F_SQRT, "math.floor": F_FLOOR,
	"math.pow": F_POW, "math.min": F_MIN, "math.max": F_MAX, "math.random": F_RANDOM,
	"math.ceil": F_CEIL, "math.round": F_ROUND, "math.trunc": F_TRUNC, "math.exp": F_EXP,
	"math.ln": F_LN, "math.sign": F_SIGN, "math.tan": F_TAN, "math.asin": F_ASIN,
	"math.acos": F_ACOS, "math.atan": F_ATAN, "math.atan2": F_ATAN2,
	"math.die_roll": F_DIE_ROLL, "math.die_roll_integer": F_DIE_ROLL,
	"math.hermite_blend": F_HERMITE, "math.lerprotate": F_LERPROTATE,
	"math.random_integer": F_RANDOM,
}
const FUNC_ARITY := {
	F_SIN: 1, F_COS: 1, F_ABS: 1, F_CLAMP: 3, F_LERP: 3, F_MOD: 2, F_SQRT: 1,
	F_FLOOR: 1, F_POW: 2, F_MIN: 2, F_MAX: 2, F_RANDOM: 2, F_CEIL: 1, F_ROUND: 1,
	F_TRUNC: 1, F_EXP: 1, F_LN: 1, F_SIGN: 1, F_TAN: 1, F_ASIN: 1, F_ACOS: 1,
	F_ATAN: 1, F_ATAN2: 2, F_DIE_ROLL: 3, F_HERMITE: 1, F_LERPROTATE: 3,
}

# --- compiled program ---------------------------------------------------------
var code: PackedInt32Array = PackedInt32Array()
var args: PackedInt32Array = PackedInt32Array()
var consts: PackedFloat32Array = PackedFloat32Array()
var names: PackedStringArray = PackedStringArray()
var source := ""
var is_constant := false          ## true when the expression has no variables/random
var constant_value := 0.0
var error := ""

static var _cache: Dictionary = {}
static var _stack: PackedFloat32Array = PackedFloat32Array()

# --- public API ---------------------------------------------------------------

## Compile (cached) a Molang expression. Never returns null; a broken expression
## compiles to the constant 0 and records `error`.
static func compile(expr: String) -> Molang:
	var cached: Variant = _cache.get(expr)
	if cached != null:
		return cached
	var m := Molang.new()
	m._compile(expr)
	_cache[expr] = m
	return m

## Compile `v` when it is a String, wrap it when it is a number. Returns null for
## anything else so callers can skip the channel.
static func of(v: Variant) -> Molang:
	if v is String:
		return compile(v)
	if v is float or v is int:
		return compile(str(v))
	return null

## One-shot helper: number straight through, String compiled+evaluated.
static func value(v: Variant, ctx: Dictionary) -> float:
	if v is float or v is int:
		return float(v)
	if v is String:
		return compile(v).evaluate(ctx)
	return 0.0

static func clear_cache() -> void:
	_cache.clear()

func evaluate(ctx: Dictionary) -> float:
	if is_constant:
		return constant_value
	var n := code.size()
	if _stack.size() < n + 4:
		_stack.resize(n + 8)
	var sp := 0
	for i in n:
		var op := code[i]
		var a := args[i]
		match op:
			OP_CONST:
				_stack[sp] = consts[a]
				sp += 1
			OP_VAR:
				var v: Variant = ctx.get(names[a])
				_stack[sp] = float(v) if (v is float or v is int or v is bool) else 0.0
				sp += 1
			OP_NEG:
				_stack[sp - 1] = -_stack[sp - 1]
			OP_NOT:
				_stack[sp - 1] = 0.0 if _stack[sp - 1] != 0.0 else 1.0
			OP_BIN:
				sp -= 1
				var r := _stack[sp]
				var l := _stack[sp - 1]
				_stack[sp - 1] = _apply_bin(a, l, r)
			OP_CALL:
				var arity: int = FUNC_ARITY.get(a, 1)
				sp -= arity
				_stack[sp] = _apply_call(a, sp, arity)
				sp += 1
			OP_TERNARY:
				sp -= 2
				var cond := _stack[sp - 1]
				_stack[sp - 1] = _stack[sp] if cond != 0.0 else _stack[sp + 1]
	return _stack[0] if sp > 0 else 0.0

func _apply_bin(o: int, l: float, r: float) -> float:
	match o:
		B_ADD: return l + r
		B_SUB: return l - r
		B_MUL: return l * r
		B_DIV: return 0.0 if is_zero_approx(r) else l / r
		B_LT: return 1.0 if l < r else 0.0
		B_GT: return 1.0 if l > r else 0.0
		B_LE: return 1.0 if l <= r else 0.0
		B_GE: return 1.0 if l >= r else 0.0
		B_EQ: return 1.0 if is_equal_approx(l, r) else 0.0
		B_NE: return 0.0 if is_equal_approx(l, r) else 1.0
		B_AND: return 1.0 if (l != 0.0 and r != 0.0) else 0.0
		B_OR: return 1.0 if (l != 0.0 or r != 0.0) else 0.0
	return 0.0

func _apply_call(f: int, base: int, arity: int) -> float:
	var a := _stack[base] if arity > 0 else 0.0
	var b := _stack[base + 1] if arity > 1 else 0.0
	var c := _stack[base + 2] if arity > 2 else 0.0
	match f:
		F_SIN: return sin(deg_to_rad(a))
		F_COS: return cos(deg_to_rad(a))
		F_TAN: return tan(deg_to_rad(a))
		F_ASIN: return rad_to_deg(asin(clampf(a, -1.0, 1.0)))
		F_ACOS: return rad_to_deg(acos(clampf(a, -1.0, 1.0)))
		F_ATAN: return rad_to_deg(atan(a))
		F_ATAN2: return rad_to_deg(atan2(a, b))
		F_ABS: return absf(a)
		F_CLAMP: return clampf(a, b, c)
		F_LERP: return a + (b - a) * clampf(c, 0.0, 1.0)
		F_LERPROTATE: return a + wrapf(b - a, -180.0, 180.0) * clampf(c, 0.0, 1.0)
		F_MOD: return 0.0 if is_zero_approx(b) else fposmod(a, b)
		F_SQRT: return sqrt(maxf(a, 0.0))
		F_FLOOR: return floorf(a)
		F_CEIL: return ceilf(a)
		F_ROUND: return roundf(a)
		F_TRUNC: return truncf(a)
		F_EXP: return exp(a)
		F_LN: return log(maxf(a, 1e-6))
		F_SIGN: return signf(a)
		F_POW: return pow(a, b)
		F_MIN: return minf(a, b)
		F_MAX: return maxf(a, b)
		F_RANDOM: return randf_range(a, b)
		F_DIE_ROLL:
			var total := 0.0
			for i in int(maxf(a, 0.0)):
				total += randf_range(b, c)
			return total
		F_HERMITE:
			var t := clampf(a, 0.0, 1.0)
			return 3.0 * t * t - 2.0 * t * t * t
	return 0.0

# --- compiler -----------------------------------------------------------------

func _compile(expr: String) -> void:
	source = expr
	var body := expr.strip_edges()
	# Statement lists ("...; return x;") – keep the last non-empty statement.
	if body.contains(";"):
		var parts := body.split(";", false)
		for i in range(parts.size() - 1, -1, -1):
			if parts[i].strip_edges() != "":
				body = parts[i].strip_edges()
				break
	if body.to_lower().begins_with("return "):
		body = body.substr(7)
	var toks := _tokenize(body)
	if error != "":
		_fallback()
		return
	_shunting_yard(toks)
	if error != "":
		_fallback()
		return
	# Constant folding: no variables and no randomness -> evaluate once.
	var pure := true
	for i in code.size():
		if code[i] == OP_VAR:
			pure = false
			break
		if code[i] == OP_CALL and (args[i] == F_RANDOM or args[i] == F_DIE_ROLL):
			pure = false
			break
	if pure:
		constant_value = evaluate({})
		is_constant = true

func _fallback() -> void:
	code = PackedInt32Array()
	args = PackedInt32Array()
	is_constant = true
	constant_value = 0.0

## Tokens are [kind, text] with kind in {"num","id","op","(",")",",","?",":"}.
func _tokenize(s: String) -> Array:
	var out: Array = []
	var i := 0
	var n := s.length()
	while i < n:
		var c := s[i]
		if c == " " or c == "\t" or c == "\n" or c == "\r":
			i += 1
			continue
		if _is_digit(c) or (c == "." and i + 1 < n and _is_digit(s[i + 1])):
			var j := i
			while j < n and (_is_digit(s[j]) or s[j] == "."):
				j += 1
			out.append(["num", s.substr(i, j - i)])
			i = j
			continue
		if _is_ident_start(c):
			var j2 := i
			while j2 < n and (_is_ident_start(s[j2]) or _is_digit(s[j2]) or s[j2] == "."):
				j2 += 1
			out.append(["id", s.substr(i, j2 - i).to_lower()])
			i = j2
			continue
		if c == "(" or c == ")" or c == "," or c == "?" or c == ":":
			out.append([c, c])
			i += 1
			continue
		var two := s.substr(i, 2)
		if two in ["<=", ">=", "==", "!=", "&&", "||"]:
			out.append(["op", two])
			i += 2
			continue
		if c in ["+", "-", "*", "/", "<", ">", "!", "="]:
			out.append(["op", "==" if c == "=" else c])
			i += 1
			continue
		error = "unexpected character '%s' in '%s'" % [c, s]
		return out
	return out

func _is_digit(c: String) -> bool:
	return c >= "0" and c <= "9"

func _is_ident_start(c: String) -> bool:
	return (c >= "a" and c <= "z") or (c >= "A" and c <= "Z") or c == "_"

func _emit(op: int, a := 0) -> void:
	code.append(op)
	args.append(a)

func _emit_const(v: float) -> void:
	var idx := consts.size()
	consts.append(v)
	_emit(OP_CONST, idx)

func _emit_var(name: String) -> void:
	var canon := _canon_var(name)
	var idx := names.find(canon)
	if idx < 0:
		idx = names.size()
		names.append(canon)
	_emit(OP_VAR, idx)

static func _canon_var(name: String) -> String:
	if name.begins_with("q."):
		return "query." + name.substr(2)
	if name.begins_with("v."):
		return "variable." + name.substr(2)
	if name.begins_with("t."):
		return "temp." + name.substr(2)
	if name.begins_with("c."):
		return "context." + name.substr(2)
	return name

## Shunting-yard. Operator stack entries are [kind, value] where kind is
## "bin" (value = B_*), "un" (OP_NEG/OP_NOT), "fn" (value = F_*), "(" , "?" or ":".
func _shunting_yard(toks: Array) -> void:
	var ops: Array = []
	var prev_value := false          # was the previous token a value/close paren?
	for t in toks:
		var kind: String = t[0]
		var text: String = t[1]
		match kind:
			"num":
				_emit_const(float(text))
				prev_value = true
			"id":
				if FUNCS.has(text):
					ops.append(["fn", int(FUNCS[text])])
					prev_value = false
				else:
					_emit_var(text)
					prev_value = true
			"(":
				ops.append(["(", 0])
				prev_value = false
			")":
				var found := false
				while ops.size() > 0:
					var top: Array = ops.pop_back()
					if top[0] == "(":
						found = true
						break
					_flush(top)
				if not found:
					error = "unbalanced ')' in '%s'" % source
					return
				if ops.size() > 0 and ops[-1][0] == "fn":
					_flush(ops.pop_back())
				prev_value = true
			",":
				while ops.size() > 0 and ops[-1][0] != "(":
					_flush(ops.pop_back())
				prev_value = false
			"?":
				while ops.size() > 0 and _prec(ops[-1]) > 1:
					_flush(ops.pop_back())
				ops.append(["?", 0])
				prev_value = false
			":":
				while ops.size() > 0 and _prec(ops[-1]) > 2:
					_flush(ops.pop_back())
				ops.append([":", 0])
				prev_value = false
			"op":
				if text == "!":
					ops.append(["un", OP_NOT])
					prev_value = false
					continue
				if (text == "-" or text == "+") and not prev_value:
					if text == "-":
						ops.append(["un", OP_NEG])
					prev_value = false
					continue
				var b: int = BIN_NAMES.get(text, -1)
				if b < 0:
					error = "unknown operator '%s'" % text
					return
				var p: int = BIN_PREC[b]
				while ops.size() > 0 and _prec(ops[-1]) >= p and ops[-1][0] != "(":
					_flush(ops.pop_back())
				ops.append(["bin", b])
				prev_value = false
	while ops.size() > 0:
		var top2: Array = ops.pop_back()
		if top2[0] == "(":
			error = "unbalanced '(' in '%s'" % source
			return
		_flush(top2)

func _prec(entry: Array) -> int:
	match entry[0]:
		"(": return 0
		"?": return 1
		":": return 2
		"bin": return int(BIN_PREC[entry[1]])
		"un": return 9
		"fn": return 10
	return 0

func _flush(entry: Array) -> void:
	match entry[0]:
		"bin": _emit(OP_BIN, entry[1])
		"un": _emit(int(entry[1]))
		"fn": _emit(OP_CALL, entry[1])
		"?": _emit(OP_TERNARY)
		":": pass          # values stay on the stack; OP_TERNARY consumes both
