import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'SKILL');
const target = join(root, 'packages', 'sdk', 'SKILL');

if (!existsSync(source)) throw new Error(`SKILL directory is missing: ${source}`);
rmSync(target, { recursive: true, force: true });
mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Copied SKILL to ${target}`);
