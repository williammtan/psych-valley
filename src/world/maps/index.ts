/**
 * Map + area barrel.
 *
 * Modules are discovered by glob rather than listed by hand. Several people add
 * maps and area scripts at the same time, and a hand-maintained import list is
 * a shared file they all have to edit — which reliably ends with someone
 * importing a file that does not exist yet and breaking the build for everyone.
 *
 * To add a map: create `src/world/maps/<id>.ts` and call `registerMap(...)` at
 * module scope. To add its logic: create `src/world/areas/<id>.ts` and call
 * `registerArea(...)`. Nothing else needs touching.
 *
 * Maps are imported before areas so an area script can assume its map exists.
 */

const mapModules = import.meta.glob('./*.ts', { eager: true });
const areaModules = import.meta.glob('../areas/*.ts', { eager: true });

if (import.meta.env?.DEV) {
  const maps = Object.keys(mapModules).filter((k) => !k.endsWith('/index.ts')).length;
  const areas = Object.keys(areaModules).length;
  console.info(`[psyche] loaded ${maps} map module(s), ${areas} area script(s)`);
}

export {};
