// Entry point. The app is loaded with dynamic imports so a file that fails to download
// (bad connection, a server hiccup) shows a "try again" message instead of hanging on "Loading…".

window.addEventListener('error', e => console.error('[trip-planner]', e.error || e.message));

function failed(err) {
  console.error(err);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="loading"><div style="text-align:center;padding:24px">
    <p>Couldn’t load the app${navigator.onLine === false ? ' — you seem to be offline' : ''}.</p>
    <button class="btn primary" id="retry">Try again</button></div></div>`;
  document.getElementById('retry').addEventListener('click', () => location.reload());
}

Promise.all([import('./photos.js'), import('./app.js')])
  .then(([photos, app]) => photos.initPhotos().then(app.start))
  .catch(failed);
