class_name Molang
extends RefCounted
## Bedrock "Molang" expression compiler/evaluator (docs/ARCHITECTURE.md §7).
##
## Expressions found in the DMZ `.animation.json` files are compiled ONCE into a
## flat RPN program (packed arrays, no per-frame allocation) and then evaluated
## every frame against a context Dictionary:
##
##     var e := Molang.compile("-math.cos(query.anim_time *360) * 32")
##     e.evaluate({"query.anim_time": 0.25})
##
## Supported: numbers, `+ - * /`, unary minus, `!`, parentheses, comparisons
## (`< > <= >= == !=`), `&& ||`, the ternary `c ? a : b`, and the functions
## math.sin/cos/tan/asin/acos/atan/atan2/abs/clamp/lerp/lerprotate/mod/sqrt/
## floor/ceil/round/trunc/pow/min/max/exp/ln/sign/random/die_roll/hermite_blend.
## Trigonometric functions take/return DEGREES, like Bedrock.
##
## Variable namespaces are canonicalised so `q.` == `query.`, `v.` == `variable.`,
## `t.` == `temp.`, `c.` == `context.`; identifiers are lower-cased (the DMZ files
## contain both `math.sin` and `Math.sin`). Unknown variables - including every
## `variable.*` / `temp.*` the game does not set - evaluate to 0.
##
## Expressions without variables or randomness are constant-folded at compile
## time, and the arithmetic/trig operators each get their own opcode so the hot
## loop is one if/elif chain: a GDScript `match` costs ~0.28 us per hit, far too
## slow for the ~15 live expressions an animated entity evaluates per frame.

# --- op codes -----------------------------------------------------------------
const OP_CONST := 0
const OP_VAR := 1
const OP_MUL := 2
const OP_ADD := 3
const OP_SUB := 4
const OP_COS := 5
const OP_SIN := 6
const OP_NEG := 7
const OP_DIV := 8
const OP_CALL1 := 9
const OP_CALL2 := 10
const OP_CALL3 := 11
const OP_CMP := 12
const OP_TERNARY := 13
const OP_NOT := 14

# --- binary / logic operator ids (arg of OP_CMP) ------------------------------
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
const BIN_OPCODE := {B_ADD: OP_ADD, B_SUB: OP_SUB, B_MUL: OP_MUL, B_DIV: OP_DIV}

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
const DEG2RAD := 0.017453292519943295

# --- compiled program ---------------------------------------------------------
var code: PackedInt32Array = PackedInt32Array()
var args: PackedInt32Array = PackedInt32Array()
var consts: PackedFloat32Array = PackedFloat32Array()
var names: Array[StringName] = []
var source := ""
var is_constant := false          ## true when the expression has no variables/randomness
var constant_value := 0.0
var error := ""

static var _cache: Dictionary = {}
var _st: PackedFloat32Array = PackedFloat32Array()

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
	var sp := 0
	var n := code.size()
	for i in n:
		var op := code[i]
		if op == OP_CONST:
			_st[sp] = consts[args[i]]
			sp += 1
		elif op == OP_VAR:
			_st[sp] = float(ctx.get(names[args[i]], 0.0))
			sp += 1
		elif op == OP_MUL:
			sp -= 1
			_st[sp - 1] = _st[sp - 1] * _st[sp]
		elif op == OP_ADD:
			sp -= 1
			_st[sp - 1] = _st[sp - 1] + _st[sp]
		elif op == OP_SUB:
			sp -= 1
			_st[sp - 1] = _st[sp - 1] - _st[sp]
		elif op == OP_COS:
			_st[sp - 1] = cos(_st[sp - 1] * DEG2RAD)
		elif op == OP_SIN:
			_st[sp - 1] = sin(_st[sp - 1] * DEG2RAD)
		elif op == OP_NEG:
			_st[sp - 1] = -_st[sp - 1]
		elif op == OP_DIV:
			sp -= 1
			var d := _st[sp]
			_st[sp - 1] = 0.0 if d == 0.0 else _st[sp - 1] / d
		elif op == OP_CALL1:
			_st[sp - 1] = _call1(args[i], _st[sp - 1])
		elif op == OP_CALL2:
			sp -= 1
			_st[sp - 1] = _call2(args[i], _st[sp - 1], _st[sp])
		elif op == OP_CALL3:
			sp -= 2
			_st[sp - 1] = _call3(args[i], _st[sp - 1], _st[sp], _st[sp + 1])
		elif op == OP_TERNARY:
			sp -= 2
			_st[sp - 1] = _st[sp] if _st[sp - 1] != 0.0 else _st[sp + 1]
		elif op == OP_NOT:
			_st[sp - 1] = 0.0 if _st[sp - 1] != 0.0 else 1.0
		else:
			sp -= 1
			_st[sp - 1] = _compare(args[i], _st[sp - 1], _st[sp])
	return _st[0] if sp > 0 else 0.0

func _compare(o: int, l: float, r: float) -> float:
	match o:
		B_LT: return 1.0 if l < r else 0.0
		B_GT: return 1.0 if l > r else 0.0
		B_LE: return 1.0 if l <= r else 0.0
		B_GE: return 1.0 if l >= r else 0.0
		B_EQ: return 1.0 if is_equal_approx(l, r) else 0.0
		B_NE: return 0.0 if is_equal_approx(l, r) else 1.0
		B_AND: return 1.0 if (l != 0.0 and r != 0.0) else 0.0
		B_OR: return 1.0 if (l != 0.0 or r != 0.0) else 0.0
	return 0.0

func _call1(f: int, a: float) -> float:
	match f:
		F_ABS: return absf(a)
		F_SQRT: return sqrt(maxf(a, 0.0))
		F_FLOOR: return floorf(a)
		F_CEIL: return ceilf(a)
		F_ROUND: return roundf(a)
		F_TAN: return tan(a * DEG2RAD)
		F_ASIN: return rad_to_deg(asin(clampf(a, -1.0, 1.0)))
		F_ACOS: return rad_to_deg(acos(clampf(a, -1.0, 1.0)))
		F_ATAN: return rad_to_deg(atan(a))
		F_TRUNC: return float(int(a))
		F_EXP: return exp(a)
		F_LN: return log(maxf(a, 1e-6))
		F_SIGN: return signf(a)
		F_HERMITE:
			var t := clampf(a, 0.0, 1.0)
			return 3.0 * t * t - 2.0 * t * t * t
	return 0.0

func _call2(f: int, a: float, b: float) -> float:
	match f:
		F_MOD: return 0.0 if is_zero_approx(b) else fposmod(a, b)
		F_POW: return pow(a, b)
		F_MIN: return minf(a, b)
		F_MAX: return maxf(a, b)
		F_ATAN2: return rad_to_deg(atan2(a, b))
		F_RANDOM: return randf_range(a, b)
	return 0.0

func _call3(f: int, a: float, b: float, c: float) -> float:
	match f:
		F_CLAMP: return clampf(a, b, c)
		F_LERP: return a + (b - a) * clampf(c, 0.0, 1.0)
		F_LERPROTATE: return a + wrapf(b - a, -180.0, 180.0) * clampf(c, 0.0, 1.0)
		F_DIE_ROLL:
			var total := 0.0
			for i in int(maxf(a, 0.0)):
				total += randf_range(b, c)
			return total
	return 0.0

# --- compiler -----------------------------------------------------------------

func _compile(expr: String) -> void:
	source = expr
	var body := expr.strip_edges()
	# Statement lists ("...; return x;") - keep the last non-empty statement.
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
	_st.resize(code.size() + 8)
	# Constant folding: no variables and no randomness -> evaluate once.
	var pure := true
	for i in code.size():
		var op := code[i]
		if op == OP_VAR:
			pure = false
			break
		if (op == OP_CALL2 and args[i] == F_RANDOM) or (op == OP_CALL3 and args[i] == F_DIE_ROLL):
			pure = false
			break
	if pure:
		constant_value = evaluate({})
		is_constant = true

func _fallback() -> void:
	code = PackedInt32Array()
	args = PackedInt32Array()
	_st.resize(8)
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
	var canon := StringName(_canon_var(name))
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
## "bin" (value = B_*), "un" (OP_NEG/OP_NOT), "fn" (value = F_*), "(", "?" or ":".
func _shunting_yard(toks: Array) -> void:
	var ops: Array = []
	var prev_value := false          # was the previous token a value / closing paren?
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
		"bin":
			var b: int = entry[1]
			_emit(int(BIN_OPCODE.get(b, OP_CMP)), b)
		"un":
			_emit(int(entry[1]))
		"fn":
			var fid: int = entry[1]
			if fid == F_SIN:
				_emit(OP_SIN)
			elif fid == F_COS:
				_emit(OP_COS)
			else:
				var arity: int = FUNC_ARITY.get(fid, 1)
				_emit(OP_CALL1 if arity == 1 else (OP_CALL2 if arity == 2 else OP_CALL3), fid)
		"?":
			_emit(OP_TERNARY)
		":":
			pass          # both values stay on the stack; OP_TERNARY consumes them
