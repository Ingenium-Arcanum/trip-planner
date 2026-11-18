// Entry point.
import { initPhotos } from './photos.js';
import { start } from './app.js';

window.addEventListener('error', e => console.error('[trip-planner]', e.error || e.message));
initPhotos().then(start).catch(err => {
  console.error(err);
  document.getElementById('app').innerHTML = '<div class="loading">Something went wrong loading the app. Reload to try again.</div>';
});
