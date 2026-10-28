// Node module hooks: route @minecraft/* imports to the mocks.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const MAP = {
  '@minecraft/server': pathToFileURL(path.join(here, 'mc_server_mock.mjs')).href,
  '@minecraft/server-ui': pathToFileURL(path.join(here, 'mc_server_ui_mock.mjs')).href,
};
export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  return next(specifier, context);
}
