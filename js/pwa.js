// Installable app + offline support (see sw.js). Everything here is optional and fails quietly:
// inside the claude.ai artifact viewer service workers and install prompts simply aren't available.

const state = { installEvt: null, installed: false, online: navigator.onLine !== false };
let onChange = () => {};

export const pwa = {
  /** Chrome offered to install the app and we haven't used that offer yet. */
  get canInstall() { return !!state.installEvt && !state.installed; },
  /** Running as the installed app (its own window, no browser bar). */
  get standalone() {
    try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; }
  },
  get online() { return state.online; }
};

/** Call once at startup. `changed` is called when install/online state changes (to re-render). */
export function initPwa(changed) {
  onChange = changed || onChange;
  try {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(err => console.warn('[pwa] no offline support:', err.message));
    }
  } catch (e) { /* not allowed here */ }

  // Ask the browser not to clear our saved trips when the phone runs low on space.
  // Chrome decides by itself (installed apps get it); there's no popup.
  try { navigator.storage?.persist?.().catch(() => {}); } catch (e) { /* ignore */ }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // we show our own "Install app" button instead of Chrome's banner
    state.installEvt = e;
    onChange();
  });
  window.addEventListener('appinstalled', () => { state.installed = true; state.installEvt = null; onChange('installed'); });
  window.addEventListener('online', () => { state.online = true; onChange('online'); });
  window.addEventListener('offline', () => { state.online = false; onChange('offline'); });
}

/** Show Chrome's install dialog. Resolves true if the user accepted. */
export async function promptInstall() {
  const e = state.installEvt;
  if (!e) return false;
  state.installEvt = null;
  try {
    e.prompt();
    const choice = await e.userChoice;
    onChange();
    return choice?.outcome === 'accepted';
  } catch (err) { onChange(); return false; }
}
