import { spawn, spawnSync } from "node:child_process";

const backendPort = Number(process.env.HUB_DEV_API_PORT ?? "5182");
if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) {
  throw new Error("HUB_DEV_API_PORT must be an integer from 1 to 65535.");
}
const backendUrl = `http://127.0.0.1:${backendPort}`;
const build = spawnSync("dotnet", ["build", "server", "--configuration", "Debug", "-p:UseAppHost=false", "--output", "server/bin/local-dev"], { stdio: "inherit" });
if (build.error) console.error(build.error.message);
if (build.status !== 0) process.exit(build.status ?? 1);

const children = [
  spawn("dotnet", ["bin/local-dev/1Reports.dll", "--urls", backendUrl], {
    cwd: "server",
    stdio: "inherit",
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Development", DOTNET_ENVIRONMENT: "Development" },
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, HUB_DEV_API_URL: backendUrl },
  }),
];

function stop(code) {
  if (process.exitCode !== undefined) return;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code ?? 1));
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
