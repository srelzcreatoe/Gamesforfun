// Maps the two Minecraft modules to the mocks and propagates a per-run ?run=N query through the add-on's own module graph so every
// scenario gets a fresh, self-consistent set of module instances (state.js shared between main.js and the test, not duplicated).
const MAP = { '@minecraft/server': new URL('./minecraft-server.mjs', import.meta.url).href, '@minecraft/server-ui': new URL('./minecraft-server-ui.mjs', import.meta.url).href };
export async function resolve(specifier, context, nextResolve) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  const r = await nextResolve(specifier, context);
  const m = (context.parentURL || '').match(/\?run=(\d+)/);
  if (m && r.url.includes('/Grinshackle_BP/scripts/') && !r.url.includes('?run=')) return { ...r, url: r.url + '?run=' + m[1] };
  return r;
}
