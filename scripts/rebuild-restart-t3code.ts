#!/usr/bin/env node

import { spawnSync } from "node:child_process";

type RestartTarget = "web" | "dev";

interface RestartOptions {
  readonly target: RestartTarget;
  readonly skipBuild: boolean;
}

function parseArgs(args: string[]): RestartOptions {
  let target: RestartTarget = "web";
  let skipBuild = false;

  for (const arg of args) {
    if (arg === "web" || arg === "dev") {
      target = arg;
      continue;
    }
    if (arg === "--skip-build") {
      skipBuild = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: bun run rebuild:restart -- [web|dev] [--skip-build]",
          "",
          "Targets:",
          "  web  Rebuild apps/web and restart PM2 app t3code-web",
          "  dev  Restart PM2 apps t3code-dev-server and t3code-dev-web",
        ].join("\n"),
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { target, skipBuild };
}

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function restartWeb(skipBuild: boolean) {
  if (!skipBuild) {
    runCommand("bun", ["run", "--cwd", "apps/web", "build"]);
  }
  runCommand("pm2", ["restart", "t3code-web"]);
  runCommand("pm2", ["describe", "t3code-web"]);
}

function restartDev() {
  runCommand("pm2", ["restart", "t3code-dev-server", "t3code-dev-web"]);
  runCommand("pm2", ["describe", "t3code-dev-server"]);
  runCommand("pm2", ["describe", "t3code-dev-web"]);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.target === "web") {
    restartWeb(options.skipBuild);
    return;
  }
  restartDev();
}

main();
