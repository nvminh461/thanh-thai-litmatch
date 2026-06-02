import { readFileSync } from "node:fs";
import path from "node:path";
import { resetAdminCredentials } from "../src/server/admin-credentials.js";

type CliOptions = {
  username?: string;
  password?: string;
  envFile: string;
  dryRun: boolean;
  help: boolean;
};

function parseEnvFile(filePath: string) {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  let content = "";

  try {
    content = readFileSync(resolvedPath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex < 1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function readNextArg(args: string[], index: number, name: string) {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    envFile: ".env",
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--username") {
      options.username = readNextArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--username=")) {
      options.username = arg.slice("--username=".length);
      continue;
    }

    if (arg === "--password") {
      options.password = readNextArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--password=")) {
      options.password = arg.slice("--password=".length);
      continue;
    }

    if (arg === "--env-file") {
      options.envFile = readNextArg(args, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`
Reset admin username/password in MongoDB.

Usage:
  npm run reset-admin-password
  npm run reset-admin-password -- --username admin --password "new-password"
  npm run reset-admin-password -- --env-file .env.production

Default:
  Reads DATABASE_URL, DATABASE_NAME, ADMIN_USERNAME and ADMIN_PASSWORD from .env.

Options:
  --username <value>   Override ADMIN_USERNAME.
  --password <value>   Override ADMIN_PASSWORD.
  --env-file <path>    Load another env file. Default: .env.
  --dry-run            Validate input without writing MongoDB.
  --help               Show this help.
`.trim());
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

parseEnvFile(options.envFile);

const username = options.username ?? process.env.ADMIN_USERNAME?.trim();
const password = options.password ?? process.env.ADMIN_PASSWORD?.trim();

if (!username || !password) {
  throw new Error(
    "Missing admin credentials. Set ADMIN_USERNAME and ADMIN_PASSWORD in env or pass --username/--password.",
  );
}

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("Missing DATABASE_URL.");
}

if (options.dryRun) {
  console.log(`Dry run OK. Admin username: ${username}`);
  process.exit(0);
}

await resetAdminCredentials(username, password);

console.log(`Admin password was reset for username: ${username}`);
