import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const skillDir = join(root, 'SKILL');
const requiredFiles = ['SKILL.md', 'CLI.md', 'API.md', 'INTEGRATION.md', 'AUTOMATION.md', 'OPERATIONS.md', 'VERSION.md'];
const requiredRoutes = ['/health', '/oauth/start/google', '/oauth/start/github', '/oauth/callback', '/v1/me', '/v1/logout', '/v1/handoff/exchange', '/v1/projects', '/v1/projects/:projectId'];
const forbiddenPatterns = [/\bephemeral\b/i, /\brenderSigned/i, /\brenderSignIn/i, /server-rendered/i, /limited words/i];

function fail(message) {
  console.error(`SKILL validation failed: ${message}`);
  process.exitCode = 1;
}

if (!existsSync(skillDir)) fail('SKILL directory is missing');

for (const file of requiredFiles) {
  const path = join(skillDir, file);
  if (!existsSync(path)) fail(`required file is missing: ${relative(root, path)}`);
}

const markdownFiles = existsSync(skillDir)
  ? readdirSync(skillDir).filter((file) => file.endsWith('.md')).map((file) => join(skillDir, file))
  : [];
const contents = new Map(markdownFiles.map((path) => [path, readFileSync(path, 'utf8')]));
const combined = [...contents.values()].join('\n');

for (const route of requiredRoutes) {
  if (!combined.includes(route)) fail(`API route is not documented: ${route}`);
}

for (const [path, content] of contents) {
  const fenceCount = (content.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 !== 0) fail(`unbalanced Markdown code fences: ${relative(root, path)}`);
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) fail(`prohibited wording ${pattern} found in ${relative(root, path)}`);
  }
  for (const match of content.matchAll(/\]\((\.\/[^)]+)\)/g)) {
    const target = join(skillDir, match[1].replace(/^\.\//, ''));
    if (!existsSync(target)) fail(`broken internal link in ${relative(root, path)}: ${match[1]}`);
  }
}

for (const directive of ['NEX_AUTH_ADMIN_TOKEN', 'HTTP-only', 'ownership', 'Google', 'GitHub', 'handoff', 'same-site', 'single-use', 'redirect_uri_not_allowed']) {
  if (!combined.toLowerCase().includes(directive.toLowerCase())) fail(`required directive is missing: ${directive}`);
}

if (!process.exitCode) console.log(`SKILL validation passed: ${markdownFiles.length} Markdown files, ${requiredRoutes.length} routes, and all required directives present.`);
