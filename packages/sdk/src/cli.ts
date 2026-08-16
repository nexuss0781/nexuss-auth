#!/usr/bin/env node
import { createManagementClient, type CreateProjectInput, type Provider, type UpdateProjectInput } from './index.js';

type ParsedArgs = Record<string, string | string[] | true>;

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item || !item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    if (value !== true) index += 1;
    const previous = parsed[key];
    if (value === true) {
      parsed[key] = true;
    } else if (Array.isArray(previous)) {
      parsed[key] = [...previous, value];
    } else if (typeof previous === 'string') {
      parsed[key] = [previous, value];
    } else {
      parsed[key] = value;
    }
  }
  return parsed;
}

function values(args: ParsedArgs, key: string): string[] {
  const value = args[key];
  return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
}

function value(args: ParsedArgs, key: string): string | undefined {
  return values(args, key)[0];
}

function required(args: ParsedArgs, key: string): string {
  const result = value(args, key);
  if (!result) throw new Error(`Missing required --${key} value`);
  return result;
}

function output(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function help(): void {
  process.stdout.write(`Nexuss-auth project management CLI\n\nCommands:\n  nexuss-auth project list\n  nexuss-auth project inspect --id <project-id>\n  nexuss-auth project create --id <id> --name <name> --home <url> --redirect <url> [--provider google] [--provider github]\n  nexuss-auth project update --id <id> [--name <name>] [--home <url>] [--redirect <url>] [--provider google] [--provider github] [--status active|disabled]\n\nEnvironment:\n  NEXUSS_AUTH_URL\n  NEXUSS_AUTH_ADMIN_TOKEN\n`);
}

async function main(): Promise<void> {
  const [resource, action, ...rest] = process.argv.slice(2);
  if (resource !== 'project' || !action || action === 'help' || action === '--help') return help();
  const authUrl = process.env.NEXUSS_AUTH_URL;
  const adminToken = process.env.NEXUSS_AUTH_ADMIN_TOKEN;
  if (!authUrl || !adminToken) throw new Error('NEXUSS_AUTH_URL and NEXUSS_AUTH_ADMIN_TOKEN are required');
  const client = createManagementClient({ authUrl, adminToken });
  const args = parseArgs(rest);

  if (action === 'list') return output(await client.listProjects());
  if (action === 'inspect') return output(await client.getProject(required(args, 'id')));
  if (action === 'create') {
    const providers = values(args, 'provider') as Provider[];
    const redirects = values(args, 'redirect');
    const origins = values(args, 'origin');
    const project: CreateProjectInput = {
      projectId: required(args, 'id'),
      name: required(args, 'name'),
      homepageUrl: required(args, 'home'),
      description: value(args, 'description') ?? '',
      avatarUrl: value(args, 'avatar') ?? null,
      allowedRedirectUris: redirects,
      allowedOrigins: origins.length > 0 ? origins : redirects.map((redirect) => new URL(redirect).origin),
      enabledProviders: providers.length > 0 ? providers : ['google', 'github'],
      status: value(args, 'status') === 'disabled' ? 'disabled' : 'active',
    };
    return output(await client.createProject(project));
  }
  if (action === 'update') {
    const id = required(args, 'id');
    const providers = values(args, 'provider') as Provider[];
    const redirects = values(args, 'redirect');
    const origins = values(args, 'origin');
    const updates: UpdateProjectInput = {};
    const name = value(args, 'name');
    const home = value(args, 'home');
    const description = value(args, 'description');
    const avatar = value(args, 'avatar');
    const status = value(args, 'status');
    if (name) updates.name = name;
    if (home) updates.homepageUrl = home;
    if (description) updates.description = description;
    if (avatar) updates.avatarUrl = avatar;
    if (redirects.length > 0) updates.allowedRedirectUris = redirects;
    if (origins.length > 0) updates.allowedOrigins = origins;
    if (providers.length > 0) updates.enabledProviders = providers;
    if (status === 'active' || status === 'disabled') updates.status = status;
    return output(await client.updateProject(id, updates));
  }
  help();
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
