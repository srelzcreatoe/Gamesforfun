// Module resolution hook: maps the Minecraft script modules onto the headless
// mocks so the real behavior-pack scripts can run under Node for the
// integration tests. Registered with `register()` from tests/integration.test.mjs.
const MAP = {
  '@minecraft/server': new URL('./minecraft-server.mjs', import.meta.url).href,
  '@minecraft/server-ui': new URL('./minecraft-server-ui.mjs', import.meta.url).href,
};

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  return next(specifier, context);
}
