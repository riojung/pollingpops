import { jsonResponse } from "../../../lib/http";
export const runtime = "nodejs";
export async function GET() {
  return jsonResponse({ status: "ok", service: "pollingpops-control" });
}
