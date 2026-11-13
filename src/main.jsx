import { render } from 'preact';
import { App } from './App.jsx';
import './styles.css';

render(<App />, document.getElementById('root'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
