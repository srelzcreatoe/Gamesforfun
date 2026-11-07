// Export helpers shared by the project screen and the entity screen.
import { buildPacks, makeAddon, makePack, packFolderName } from '../core/packgen.js';
import { validateProject } from '../core/validate.js';
import { base64ToBytes } from '../core/util.js';
import { catalog, vanilla } from './meta.js';
import { renderFrontSprite } from './textures.js';
import { saveFile, openInGame, shareFile } from './native.js';
import { toast, saveNow } from './store.js';

export async function packIconBytes(project) {
  if (project.icon) return base64ToBytes(project.icon);
  const e = project.entities.find((x) => x.spawnable) || project.entities[0];
  if (!e) return undefined;
  try {
    return base64ToBytes(await renderFrontSprite(e, 256));
  } catch { return undefined; }
}

export function issues(project) { return validateProject(project, catalog, vanilla); }

export async function exportAddon(project, how) {
  saveNow();
  const icon = await packIconBytes(project);
  const base = packFolderName(project);
  try {
    if (how === 'bp' || how === 'rp') {
      const bytes = makePack(project, how, { icon });
      const name = `${base} ${how.toUpperCase()}.mcpack`;
      const r = await saveFile(name, bytes);
      toast(r.ok ? `Saved ${name}` : r.msg || 'Save cancelled', r.ok ? 'ok' : 'info');
      return;
    }
    const bytes = makeAddon(project, { icon });
    const name = `${base}.mcaddon`;
    if (how === 'game') {
      const r = openInGame(name, bytes);
      toast(r.msg, r.ok ? 'ok' : 'error', 5000);
    } else if (how === 'share') {
      await shareFile(name, bytes);
    } else {
      const r = await saveFile(name, bytes);
      toast(r.ok ? `Saved ${name}` : r.msg || 'Save cancelled', r.ok ? 'ok' : 'info');
    }
  } catch (e) {
    console.error(e);
    toast('Export failed: ' + e.message, 'error', 6000);
  }
}

export async function exportBackup(project) {
  saveNow();
  const bytes = new TextEncoder().encode(JSON.stringify({ mobsmith: 1, project }, null, 1));
  const r = await saveFile(`${packFolderName(project)}.mobsmith.json`, bytes, 'application/json');
  toast(r.ok ? 'Backup saved' : r.msg || 'Cancelled', r.ok ? 'ok' : 'info');
}

export function previewFiles(project) {
  return buildPacks(project);
}
