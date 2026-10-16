import assert from "node:assert/strict";

const prometheusUrl = (process.env.PROMETHEUS_URL ?? "http://127.0.0.1:9090").replace(/\/$/, "");
const grafanaUrl = (process.env.GRAFANA_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const grafanaUser = process.env.OPENROUND_GRAFANA_USER ?? "admin";
const grafanaPassword = process.env.OPENROUND_GRAFANA_PASSWORD ?? "openround-local-change-me";

function materializeGrafanaBuiltIns(expression: string) {
  return expression
    .replaceAll("$__rate_interval", "1m")
    .replaceAll("$__interval", "1m")
    .replaceAll("$__range", "1h");
}

async function waitFor(url: string, init: RequestInit = {}, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, init);
      lastStatus = response.status;
      if (response.ok) return response;
    } catch {
      // The container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not become ready (last status ${lastStatus})`);
}

async function waitForJson<T>(
  url: string,
  predicate: (value: T) => boolean,
  init: RequestInit = {},
  timeoutMs = 60_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        const value = (await response.json()) as T;
        if (predicate(value)) return value;
      }
    } catch {
      // The service may still be starting or provisioning.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not return the expected state`);
}

async function main() {
  await waitFor(`${prometheusUrl}/-/ready`);
  const targets = await waitForJson<{
    data: { activeTargets: Array<{ labels: { job?: string }; health: string }> };
  }>(`${prometheusUrl}/api/v1/targets`, ({ data }) =>
    data.activeTargets.some(({ labels, health }) => labels.job === "openround" && health === "up"),
  );
  const openRoundTarget = targets.data.activeTargets.find(
    ({ labels }) => labels.job === "openround",
  );
  assert.equal(openRoundTarget?.health, "up");

  const query = await waitForJson<{
    data: { result: Array<{ value: [number, string] }> };
  }>(
    `${prometheusUrl}/api/v1/query?query=${encodeURIComponent('up{job="openround"}')}`,
    ({ data }) => data.result[0]?.value[1] === "1",
  );
  assert.equal(query.data.result[0]?.value[1], "1");

  const rules = await waitForJson<{
    data: { groups: Array<{ rules: Array<{ name: string }> }> };
  }>(
    `${prometheusUrl}/api/v1/rules?type=alert`,
    ({ data }) => data.groups.flatMap(({ rules: groupRules }) => groupRules).length >= 10,
  );
  const alerts = rules.data.groups
    .flatMap(({ rules: groupRules }) => groupRules)
    .map(({ name }) => name);
  assert.ok(alerts.includes("OpenRoundAnswerAcknowledgementP99High"));
  assert.ok(alerts.includes("OpenRoundClientReceiptTimeouts"));
  assert.ok(alerts.length >= 10);

  const authorization = `Basic ${Buffer.from(`${grafanaUser}:${grafanaPassword}`).toString("base64")}`;
  const grafanaHealth = await waitFor(`${grafanaUrl}/api/health`).then((response) =>
    response.json(),
  );
  assert.equal((grafanaHealth as { database: string }).database, "ok");
  const datasource = await waitForJson<{
    uid: string;
    name: string;
    type: string;
    url: string;
  }>(
    `${grafanaUrl}/api/datasources/uid/openround-prometheus`,
    ({ uid }) => uid === "openround-prometheus",
    { headers: { authorization } },
  );
  assert.equal(datasource.name, "Polling Pops Prometheus");
  assert.equal(datasource.type, "prometheus");
  assert.equal(datasource.url, "http://prometheus:9090");
  const dashboards = await waitForJson<Array<{ uid: string }>>(
    `${grafanaUrl}/api/search?query=Polling Pops`,
    (results) => results.some(({ uid }) => uid === "openround-operations"),
    { headers: { authorization } },
  );
  assert.ok(dashboards.some(({ uid }) => uid === "openround-operations"));
  const dashboardResponse = await waitForJson<{
    dashboard: {
      panels: Array<{ targets?: Array<{ expr?: string }> }>;
      uid: string;
    };
  }>(
    `${grafanaUrl}/api/dashboards/uid/openround-operations`,
    ({ dashboard }) => dashboard.uid === "openround-operations",
    { headers: { authorization } },
  );
  const dashboardQueries = dashboardResponse.dashboard.panels.flatMap(({ targets = [] }) =>
    targets.map(({ expr }) => expr).filter((expr): expr is string => !!expr),
  );
  assert.ok(dashboardQueries.length >= 10);
  for (const expression of dashboardQueries) {
    const executableExpression = materializeGrafanaBuiltIns(expression);
    const response = await fetch(
      `${prometheusUrl}/api/v1/query?query=${encodeURIComponent(executableExpression)}`,
    );
    assert.equal(
      response.status,
      200,
      `Dashboard query failed to parse: ${expression} (materialized as ${executableExpression})`,
    );
    assert.equal(
      ((await response.json()) as { status: string }).status,
      "success",
      `Dashboard query failed: ${expression}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        prometheusTarget: openRoundTarget.health,
        alertRules: alerts.length,
        grafanaDatabase: "ok",
        grafanaDatasource: datasource.uid,
        dashboard: "openround-operations",
        dashboardQueries: dashboardQueries.length,
      },
      null,
      2,
    )}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
