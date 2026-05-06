#!/usr/bin/env node
import { createMemoryToolFromEnv } from "./memory-tool.js";

async function main(): Promise<void> {
  const [command = "show", ...args] = process.argv.slice(2);
  const tool = createMemoryToolFromEnv();

  if (command === "show" || command === "list") {
    console.log(tool.load() || "(empty)");
    return;
  }

  if (command === "get") {
    const key = args.join(" ").trim();
    if (!key) usage("Missing key.");
    const entry = tool.get(key);
    console.log(entry ? `${entry.key}: ${entry.value}` : "(missing)");
    process.exitCode = entry ? 0 : 2;
    return;
  }

  if (command === "set" || command === "add") {
    const parsed = parseSetArgs(args);
    if (!parsed) usage("Usage: qq-memory set <key> <value> or qq-memory set <key>=<value>");
    const result = tool.set(parsed.key, parsed.value);
    console.log(`set ${result.key}`);
    if (result.warning) console.warn(`warning: ${result.warning}`);
    return;
  }

  if (command === "del" || command === "delete" || command === "remove") {
    const key = args.join(" ").trim();
    if (!key) usage("Missing key.");
    const deleted = tool.delete(key);
    console.log(deleted ? `deleted ${key}` : `(missing) ${key}`);
    process.exitCode = deleted ? 0 : 2;
    return;
  }

  if (command === "clear") {
    const hadMemory = tool.clear();
    console.log(hadMemory ? "cleared" : "(empty)");
    return;
  }

  usage(`Unknown command: ${command}`);
}

function parseSetArgs(args: string[]): { key: string; value: string } | undefined {
  const input = args.join(" ").trim();
  if (!input) return undefined;

  const equalsIndex = input.indexOf("=");
  if (equalsIndex > 0) {
    const key = input.slice(0, equalsIndex).trim();
    const value = input.slice(equalsIndex + 1).trim();
    return key && value ? { key, value } : undefined;
  }

  const [key, ...valueParts] = args;
  const value = valueParts.join(" ").trim();
  return key && value ? { key, value } : undefined;
}

function usage(message: string): never {
  console.error(message);
  console.error("Commands: show, get <key>, set <key> <value>, set <key>=<value>, del <key>, clear");
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
