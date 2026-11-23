#!/usr/bin/env node
// One command to flip city: `npm run switch -- istanbul`, or `city istanbul`
// after `npm link`. Plain Node 22.18+ (it imports the app's TypeScript logic
// directly; Node strips the types). No build step, no dependencies.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`Node 22.18 or newer is needed (this is ${process.versions.node}). On 22.6 to 22.17 run: node --experimental-strip-types cli/switch.mjs`);
}

const { runSwitch } = await import('../src/lib/cli.ts');

const result = await runSwitch(process.argv.slice(2), {
  env: process.env,
  now: new Date(),
  log: (line) => console.log(line),
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
  fetch: (url, init) => fetch(url, init),
});
process.exitCode = result.code;
