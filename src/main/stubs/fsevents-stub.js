const alreadyLogged = globalThis.__FSEVENTS_STUB_LOGGED;

if (!alreadyLogged) {
  globalThis.__FSEVENTS_STUB_LOGGED = true;
  console.warn('[FSEVENTS-STUB] fsevents module replaced with stub; forcing chokidar to use polling');
}

module.exports = null;
