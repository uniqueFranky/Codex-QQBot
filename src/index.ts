import { loadConfig } from "./config.js";
import { StateStore } from "./state.js";
import { createMemoryTool } from "./memory-tool.js";
import { QQAuth } from "./qq/auth.js";
import { QQMessages } from "./qq/messages.js";
import { QQGateway } from "./qq/gateway.js";
import { CodexRunner } from "./codex/runner.js";
import { BotController } from "./app/controller.js";
import { configureGlobalProxy } from "./proxy.js";
import { writeRuntimeEnvFile } from "./runtime-env.js";

async function main(): Promise<void> {
  configureGlobalProxy();

  const config = loadConfig();
  writeRuntimeEnvFile(config);
  const stateStore = new StateStore(config.stateFile);
  const memoryTool = createMemoryTool(config, stateStore);
  const auth = new QQAuth(config);
  const messages = new QQMessages(config, auth);
  const codex = new CodexRunner(config);
  const controller = new BotController(config, stateStore, memoryTool, messages, codex);

  console.log("codex-qqbot starting");
  console.log(`workspace: ${config.workspaceDir}`);
  console.log(`data: ${config.dataDir}`);

  const gateway = new QQGateway(config, auth, stateStore, (message) =>
    controller.handlePrivateMessage(message)
  );
  await gateway.start();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
