import { render } from 'preact';
import { App } from './app.jsx';
import './styles.css';

window.addEventListener('error', (e) => {
  const el = document.getElementById('crash');
  if (el) { el.hidden = false; el.textContent = 'Something went wrong: ' + (e.message || e.error) + '. Your work is saved; restart the app.'; }
});
render(<App />, document.getElementById('root'));
