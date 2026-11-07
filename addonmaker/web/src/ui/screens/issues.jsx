import { Icon } from '../common.jsx';
import { go, closeModal, state } from '../store.js';

export function IssueList({ list, max = 60 }) {
  return (
    <ul class="issues">
      {list.slice(0, max).map((i) => (
        <li class={`issue ${i.level}`}>
          <Icon name={i.level === 'error' ? 'warn' : i.level === 'warn' ? 'warn' : 'info'} size={16} />
          <span class="issue-msg">{i.entity && <strong>{i.entity}: </strong>}{i.msg}</span>
          {i.e && (
            <button type="button" class="btn sm ghost" onClick={() => { closeModal(); go({ screen: 'entity', entityUid: i.e, tab: i.tab }, { keepTab: true }); state.tab = i.tab || 'overview'; }}>Fix</button>
          )}
        </li>
      ))}
      {list.length > max && <li class="hint">…and {list.length - max} more</li>}
    </ul>
  );
}
