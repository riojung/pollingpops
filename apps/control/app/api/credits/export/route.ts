import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  exportCreditLedgerCsv,
  readCompleteCreditLedgerExport,
  requireOperatorCapability,
} from "@openround/control-plane";
import { authenticatedRequest, safeError } from "../../../../lib/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const { platform, context, requestId } = await authenticatedRequest(request);
    requireOperatorCapability(context, "credits.read");
    const organizationId = z
      .string()
      .uuid()
      .parse(request.nextUrl.searchParams.get("organizationId"));
    const from = z.iso.date().parse(request.nextUrl.searchParams.get("from"));
    const through = z.iso.date().parse(request.nextUrl.searchParams.get("through"));
    const ledger = await readCompleteCreditLedgerExport(
      platform,
      organizationId,
      new Date(`${from}T00:00:00.000Z`),
      new Date(`${through}T23:59:59.999Z`),
    );
    await platform.appendAuditEvent({
      actorId: context.operator.id,
      organizationId,
      action: "credits.export",
      targetId: organizationId,
      reason: "Operator downloaded credit ledger",
      requestId,
      before: null,
      after: { entries: ledger.length, from, through, completePeriod: true },
    });
    return new Response(exportCreditLedgerCsv(ledger), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="pollingpops-credit-ledger-${from}-${through}.csv"`,
        "x-export-complete-period": "true",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return safeError(error);
  }
}
