interface HookContext {
  taskId: string;
  action: "create" | "execute" | "cleanup" | string;
  branchName?: string;
  command?: string;
}

async function run(): Promise<void> {
  const contextRaw = process.env.ARIVE_HOOK_CONTEXT || "{}";
  let context: HookContext;
  try {
    context = JSON.parse(contextRaw) as HookContext;
  } catch {
    context = { taskId: "", action: "" };
  }

  const { action, taskId } = context;

  if (action !== "create" && action !== "execute") {
    process.exit(0);
  }

  console.log(`[pre-integrate] Hook started for task: ${taskId}, action: ${action}`);
}

run().catch((err: unknown) => {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(errMsg);
  process.exit(1);
});