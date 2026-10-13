import { z } from "zod";

export const AccountingEntitySchema = z.enum([
  "Invoice",
  "SalesReceipt",
  "CreditMemo",
  "RefundReceipt",
]);
export const AccountingMappingSchema = z
  .object({
    stripeTransactionId: z.string().min(1).max(128),
    entity: AccountingEntitySchema,
    externalId: z.string().regex(/^\d+$/),
  })
  .strict();
export const AccountingReconciliationInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    externalCustomerId: z.string().regex(/^\d+$/),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    homeCurrency: z.string().regex(/^[A-Z]{3}$/),
    snapshotAt: z.iso.datetime(),
    stripeTransactions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            kind: z.enum(["sale", "refund"]),
            amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
            currency: z.string().regex(/^[A-Z]{3}$/),
            occurredAt: z.iso.datetime(),
            paymentId: z.string().nullable(),
            invoiceId: z.string().nullable(),
            sourceEventId: z.string(),
          })
          .strict(),
      )
      .max(10_000),
    transactionMappings: z.array(AccountingMappingSchema).max(1000),
  })
  .strict();

export type AccountingDocument = {
  entity: z.infer<typeof AccountingEntitySchema>;
  externalId: string;
  documentNumber: string | null;
  date: string;
  amountMinor: number;
  currency: string;
};

export function accountingMinorAmount(amount: number, currency: string): number {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits;
  if (digits === undefined || digits > 3)
    throw new Error("Unsupported accounting currency precision");
  const scaled = amount * 10 ** digits;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || rounded < 0 || Math.abs(scaled - rounded) > 0.000001)
    throw new Error("Accounting amount cannot be represented in currency minor units");
  return rounded;
}

// Only an explicit mapping establishes identity. Matching amounts alone cannot prove that
// an accounting document represents the same sale, refund, or accounting treatment.
export function reconcileAccountingDocuments(
  input: z.infer<typeof AccountingReconciliationInputSchema>,
  documents: AccountingDocument[],
) {
  const byDocument = new Map(
    documents.map((document) => [`${document.entity}:${document.externalId}`, document]),
  );
  const mappings = new Map<string, z.infer<typeof AccountingMappingSchema>>();
  const used = new Set<string>();
  for (const mapping of input.transactionMappings) {
    const key = `${mapping.entity}:${mapping.externalId}`;
    if (mappings.has(mapping.stripeTransactionId) || used.has(key))
      throw new Error("Accounting mappings must be one-to-one");
    mappings.set(mapping.stripeTransactionId, mapping);
    used.add(key);
  }
  const results = input.stripeTransactions.map((transaction) => {
    const mapping = mappings.get(transaction.id);
    const document = mapping
      ? byDocument.get(`${mapping.entity}:${mapping.externalId}`)
      : undefined;
    const status = !mapping
      ? "unmapped"
      : !document
        ? "missing_document"
        : (transaction.kind === "sale") !== ["Invoice", "SalesReceipt"].includes(document.entity)
          ? "kind_mismatch"
          : transaction.currency !== document.currency
            ? "currency_mismatch"
            : transaction.amountMinor !== document.amountMinor
              ? "amount_mismatch"
              : "matched";
    return {
      stripeTransactionId: transaction.id,
      paymentId: transaction.paymentId,
      invoiceId: transaction.invoiceId,
      sourceEventId: transaction.sourceEventId,
      kind: transaction.kind,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      occurredAt: transaction.occurredAt,
      externalEntity: mapping?.entity ?? null,
      externalId: mapping?.externalId ?? null,
      accountingAmountMinor: document?.amountMinor ?? null,
      accountingCurrency: document?.currency ?? null,
      status,
    };
  });
  const unlinkedDocuments = documents.filter(
    (document) => !used.has(`${document.entity}:${document.externalId}`),
  );
  return {
    snapshotAt: input.snapshotAt,
    importedStripeTransactions: results.length,
    matched: results.filter((entry) => entry.status === "matched").length,
    mismatches: results.filter((entry) => !["matched", "unmapped"].includes(entry.status)).length,
    unmapped: results.filter((entry) => entry.status === "unmapped").length,
    unlinkedAccountingDocuments: unlinkedDocuments.length,
    results,
    unlinkedDocuments,
    // Provider facts are compared; no posting, allocation, tax treatment, or refund is executed.
    readOnly: true,
  };
}
