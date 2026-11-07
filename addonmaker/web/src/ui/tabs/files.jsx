import { useState, useMemo } from 'preact/hooks';
import { Card, Btn, Icon } from '../common.jsx';
import { previewFiles, issues } from '../exporting.js';
import { IssueList } from '../screens/issues.jsx';
import { copyText } from '../native.js';
import { toast } from '../store.js';
import { bytesToBase64 } from '../../core/util.js';

function highlight(json) {
  const esc = json.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi, (m, str, colon, kw, n) => {
    if (str) return colon ? `<span class="j-k">${str}</span>${colon}` : `<span class="j-s">${str}</span>`;
    if (kw) return `<span class="j-b">${kw}</span>`;
    return `<span class="j-n">${n}</span>`;
  });
}

export function FilesTab({ e, p }) {
  const packs = useMemo(() => previewFiles(p), [p, state_rev()]);
  const mine = (f) => f.path.includes(`/${e.name}.`) || f.path.includes(`/${e.name}_`) || f.path.endsWith(`/${e.name}.json`) || f.path.startsWith(`entity/${e.name}`);
  const all = [...packs.bp.files.map((f) => ({ ...f, pack: 'BP', dir: packs.bp.dir })), ...packs.rp.files.map((f) => ({ ...f, pack: 'RP', dir: packs.rp.dir }))];
  const [sel, setSel] = useState(all.find((f) => f.pack === 'BP' && f.path.startsWith('entities/') && mine(f))?.path || all[0]?.path);
  const [showAll, setShowAll] = useState(false);
  const list = issues(p).filter((i) => i.e === e.uid || !i.e);
  const cur = all.find((f) => f.path === sel) || all[0];
  const shown = showAll ? all : all.filter((f) => mine(f) || ['manifest.json', 'sounds.json', 'texts/en_US.lang'].includes(f.path));
  const notes = packs.notes[e.name] || [];
  return (
    <div class="tab-files">
      <Card title="Checks" sub={list.length ? `${list.filter((x) => x.level === 'error').length} errors · ${list.filter((x) => x.level === 'warn').length} warnings · ${list.filter((x) => x.level === 'info').length} tips` : 'No problems found'}>
        {list.length ? <IssueList list={list} /> : <p class="ok-line"><Icon name="check" /> This entity is ready to export.</p>}
      </Card>
      {notes.length > 0 && <Card title="Wired automatically" sub="Added to the exported files for you"><ul class="notes">{notes.map((n) => <li>{n}</li>)}</ul></Card>}
      <Card title="Generated files" right={<Btn small kind="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'This entity' : 'All files'}</Btn>}>
        <div class="file-list">
          {shown.map((f) => (
            <button type="button" class={`file ${f.path === cur?.path ? 'on' : ''}`} onClick={() => setSel(f.path)}>
              <span class={`pk ${f.pack}`}>{f.pack}</span><span class="mono">{f.path}</span>
            </button>
          ))}
        </div>
        {cur && (
          <div class="file-view">
            <div class="inline"><code class="grow">{cur.dir}/{cur.path}</code>
              {typeof cur.data === 'string' && <Btn small kind="ghost" icon="copy" onClick={() => { copyText(cur.data); toast('Copied'); }}>Copy</Btn>}</div>
            {typeof cur.data === 'string'
              ? <pre class="code" dangerouslySetInnerHTML={{ __html: cur.path.endsWith('.json') ? highlight(cur.data) : cur.data.replace(/</g, '&lt;') }} />
              : cur.path.endsWith('.png') ? <img class="png-view" alt={cur.path} src={`data:image/png;base64,${bytesToBase64(cur.data)}`} /> : <p class="hint">{cur.data.length} bytes</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

import { state } from '../store.js';
function state_rev() { return state.rev; }
