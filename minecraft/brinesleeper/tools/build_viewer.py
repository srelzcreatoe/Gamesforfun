"""Bundle geometry, texture, animations and meta into the single-file interactive viewer."""
import base64, json, sys
out = sys.argv[1] if len(sys.argv) > 1 else '../preview/viewer.html'
tpl = open('viewer_template.html').read()
geo = json.dumps(json.load(open('out/brinesleeper.geo.json')), separators=(',', ':'))
anim = json.dumps(json.load(open('out/brinesleeper.animation.json')), separators=(',', ':'))
meta = json.dumps(json.load(open('out/preview_meta.json')), separators=(',', ':'))
tex = 'data:image/png;base64,' + base64.b64encode(open('out/brinesleeper.png', 'rb').read()).decode()
for k, v in (('__GEO__', geo), ('__ANIM__', anim), ('__META__', meta), ('__TEX__', tex)):
    assert k in tpl
    tpl = tpl.replace(k, v)
assert '</script' not in geo + anim + meta
open(out, 'w').write(tpl)
print('viewer html bytes', len(tpl), '->', out)
