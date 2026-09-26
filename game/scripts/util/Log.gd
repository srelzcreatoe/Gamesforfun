class_name Log
## Tiny leveled logger. Use instead of print in gameplay code.
enum Level { DEBUG, INFO, WARN, ERROR }
static var level: int = Level.INFO

static func d(msg: String) -> void:
	if level <= Level.DEBUG:
		print("[D] " + msg)

static func i(msg: String) -> void:
	if level <= Level.INFO:
		print("[I] " + msg)

static func w(msg: String) -> void:
	if level <= Level.WARN:
		push_warning(msg)
		print("[W] " + msg)

static func e(msg: String) -> void:
	push_error(msg)
	print("[E] " + msg)
