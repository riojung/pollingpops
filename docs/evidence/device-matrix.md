# Physical-device and network matrix

- Date/time (UTC):
- Protocol/version:
- Build commit and image digest:
- Single-VM staging URL (redacted if private):
- Test owner:
- Independent reviewer:
- Frozen supported-device/browser policy reference:
- Run ID and evidence index/checksum:

Use real devices and the final QR hostname; browser emulation does not satisfy a row. Freeze exact
hardware model, OS build, browser version, network/carrier or managed-network profile, and UTC run
time before execution. Each row must cover both a Round and a Presentation: scan/open, nickname
join, acknowledged answer, temporary network loss, resume without duplicate acceptance, reveal,
and final result. A desktop facilitator must verify roster and ready-report reconciliation against
the accepted-answer count.

| Run ID | Hardware/OS build   | Browser/version | Network/carrier profile    | Round result | Presentation result | Reconnect/deduplication | Report reconciliation | Evidence/issue |
| ------ | ------------------- | --------------- | -------------------------- | ------------ | ------------------- | ----------------------- | --------------------- | -------------- |
|        | Current iPhone/iOS  | Safari          | Wi-Fi                      | Pending      | Pending             | Pending                 | Pending               |                |
|        | Previous iPhone/iOS | Safari          | Cellular                   | Pending      | Pending             | Pending                 | Pending               |                |
|        | Current Android     | Chrome          | Wi-Fi                      | Pending      | Pending             | Pending                 | Pending               |                |
|        | Previous Android    | Chrome          | Cellular                   | Pending      | Pending             | Pending                 | Pending               |                |
|        | Windows laptop      | Chrome and Edge | Managed Wi-Fi              | Pending      | Pending             | Pending                 | Pending               |                |
|        | macOS laptop        | Safari/Chrome   | Managed Wi-Fi              | Pending      | Pending             | Pending                 | Pending               |                |
|        | Chromebook          | Chrome          | School-like filtered Wi-Fi | Pending      | Pending             | Pending                 | Pending               |                |

## Canvas extension when enabled

Freeze supported authoring and guest-only devices before execution. Each Canvas row must link to
an exact hardware/OS/browser/network row above and the same reviewed candidate. Do not substitute
headless/emulated browsers for physical hardware. This extension does not replace any required
Round/Presentation row or the thirty-device lobby, and it grants no higher object/editor capacity.

- Canvas scope and enabled feature controls:
- Team/workshop scene inventory checksum, object counts, image dimensions/bytes, and participant roles:
- Separate organization-owned creator workspaces and explicit board-share roles verified:
- Physical input/display timing method, network profile and saturation evidence reference:

| Run ID / device row | Supported role/input scope | Team editing, outline and geometry | Touch pan/pinch/drawing | Draft conflict, deleted target and reconnect | Scanned image, saved version, linked preview and exports | Guided privacy, publication, timer and follow | Evidence/issue |
| ------------------- | -------------------------- | ---------------------------------- | ----------------------- | -------------------------------------------- | -------------------------------------------------------- | --------------------------------------------- | -------------- |
|                     | Physical desktop/keyboard  | Pending                            | Pending                 | Pending                                      | Pending                                                  | Pending                                       |                |
|                     | Physical mobile/touch      | Pending                            | Pending                 | Pending                                      | Pending                                                  | Pending                                       |                |
|                     | Board viewer               | Pending                            | Pending                 | Pending                                      | Pending                                                  | Pending                                       |                |
|                     | Accountless guided guest   | Pending                            | Pending                 | Pending                                      | Pending                                                  | Pending                                       |                |

Record an inapplicable action only when the frozen role/support policy explains it; a viewer or
guest must not acquire editing privileges to complete a row. Include board-share revocation,
team-only image exclusion, explicit guest publication/removal, authorized history and target-link
boundaries. Guests must not receive team comments, history or identities. For timing, record cold
open, visible peer update, guest publication, reconnect and navigation observations with their
measurement limits; animation callbacks alone are not physical display timing. Follow the
[Canvas execution scenarios](../runbooks/device-matrix.md#canvas-scenarios-when-enabled).

- Canvas required scenarios completed/required:
- Canvas physical-device failures and exclusions:
- Canvas owner decision (accepted/rejected/pending): Pending
- Canvas independent reviewer decision (accepted/rejected/pending): Pending

## Shared lobby and final acceptance

- Thirty-device concurrent lobby run ID, device mix, joined/currently-connected/disconnected counts, and duration:
- Thirty-device acceptance: all devices join the same reviewed room, host counts reconcile, every
  selected responder receives the current block and authoritative acknowledgement, reconnects do
  not duplicate an answer, and the ready report reconciles accepted answers with zero unexplained
  participant or response loss.
- Camera/QR permission observations:
- Firewall, captive portal, proxy, VPN, or WebSocket restrictions and fallback behavior:
- Accepted answers/reconciled answers by run:
- Open blockers and issue URLs:
- Test owner decision (accepted/rejected/pending): Pending
- Independent reviewer decision (accepted/rejected/pending): Pending

Every required row and the thirty-device lobby must pass for the gate to be accepted. Any omitted
row requires a reviewed support-policy change before the campaign begins; it cannot be waived
after seeing the result. Follow the [physical-device execution runbook](../runbooks/device-matrix.md).
When Canvas is enabled, its frozen device/role scenarios must also be complete before accepting
the candidate. No physical Canvas result is established by the pending template above.
