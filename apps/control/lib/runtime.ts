import "server-only";
import {
  PostgresRepository,
  createPlatformRepository,
  createFeedbackRepository,
  assertRestrictedRuntimeDatabasePrincipal,
} from "@openround/db";
import {
  loadControlConfig,
  ManagedOperatorOidcProvider,
  OperatorAuthService,
  OperatorService,
} from "@openround/control-plane";

let instance: Promise<ReturnType<typeof buildRuntime>> | undefined;
function buildRuntime() {
  const config = loadControlConfig();
  if (!config.CONTROL_ENABLED || !config.CONTROL_DATABASE_URL)
    throw new Error("Operator control is not configured");
  const repository = new PostgresRepository(config.CONTROL_DATABASE_URL);
  const platform = createPlatformRepository(repository);
  const auth = new OperatorAuthService(platform, config, new ManagedOperatorOidcProvider(config));
  const operators = new OperatorService(platform, config.INTEGRATION_SECRET_KEY, async () => {
    const rows = await createFeedbackRepository(repository).list(undefined, 50);
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      category: row.category,
      message: row.message,
      page: row.page,
      allowContact: row.allowContact,
      contactEmail: row.allowContact ? row.contactEmail : null,
      createdAt: row.createdAt,
    }));
  });
  return { config, repository, platform, auth, operators };
}
export async function controlRuntime() {
  if (!instance)
    instance = (async () => {
      const runtime = buildRuntime();
      await runtime.repository.initialize();
      if (runtime.config.NODE_ENV === "production") {
        assertRestrictedRuntimeDatabasePrincipal(
          await runtime.repository.inspectRuntimeDatabasePrincipal(),
        );
      }
      await runtime.auth.provisionConfiguredOperators();
      return runtime;
    })().catch((error: unknown) => {
      instance = undefined;
      throw error;
    });
  return instance;
}
