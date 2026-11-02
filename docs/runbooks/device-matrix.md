# Physical-device and network execution

This runbook turns the physical-device evidence matrix into a repeatable acceptance exercise. It
does not permit browser emulation to stand in for real hardware or a local Compose stack to stand
in for the reviewed single-VM staging candidate.

## Freeze the candidate

1. Record the full Git commit, immutable server/web image digests, deployment configuration
   checksum, final application/media origins, and UTC cutoff.
2. Freeze the supported hardware, OS, browser, and network matrix before testing. Record exact
   versions; “current” and “previous” are only recruitment labels, not evidence.
3. Name a test owner and an independent reviewer. Create stable run IDs and a private evidence
   index that contains no room code, cookie, participant alias, or response content.
4. Create one reviewed Round and one reviewed Presentation containing a scorable block, reveal,
   intervention, and linked recheck. Include a content slide with a moved/resized title, multiple
   text boxes, and an image. Record enabled flex, Question Health, and Decision Replay flags when
   they are in the candidate. Keep the content and settings identical across devices.
5. If Canvas boards are enabled, freeze one team canvas and one guided workshop as additional
   scenarios. Use original synthetic content, a representative scanned image, a frame/group,
   rotated shapes, an anchored connector, and a saved version. Name two separately licensed team
   users with distinct organization-owned workspaces, a board viewer, and an accountless workshop
   guest. Record the exact scene size and collaborating-user count; the existing limits are not a
   measured device-capacity promise. Keep the same scenes and role assignments across devices.

## Execute each device row

For each real device/network combination:

1. Scan the final-hostname QR code, verify HTTPS and the expected destination, and join with a
   synthetic alias.
2. Open the current question/block, submit once, and wait for the authoritative `Saved`
   acknowledgement. Record acknowledgement and client-receipt timing without recording the answer.
3. Remove connectivity after submit and before the next block, restore it, and verify sequence and
   revision recovery. Repeat once with connectivity removed before acknowledgement; the client
   must not claim success until the server acknowledges it.
4. Complete reveal, intervention, and linked recheck. Verify keyboard/touch operation and screen
   reader status where that device is also in the accessibility scope.
5. Finish the session. Reconcile joined, currently connected, disconnected, accepted-response, and
   ready-report counts. Confirm retries did not create duplicate accepted answers.
6. Repeat the steps for the other artifact type. Record captive-portal, firewall, proxy, VPN,
   WebSocket, QR-permission, and fallback observations.
7. Compare the customized content slide in authoring preview, facilitator, and participant views.
   Check touch/keyboard and inspector placement controls on supported authoring devices, image
   clearance, legible overflow, and narrow top-to-bottom/left-to-right reading order. Reopen the
   saved slide and confirm its geometry persists.
8. For enabled replay/flex candidates, verify host-closed flex responses and the ready report's
   captured decision timeline without inventing earlier history. Delete a synthetic finished or
   expired session, then archive/delete its unreferenced source through the owner UI. Check
   confirmation focus/status and stale browser/back-navigation behavior; old credentials must fail.

## Canvas scenarios when enabled

These additional rows do not replace the Round/Presentation checks or the thirty-device lobby.
Record supported authoring devices and guest-only devices before execution; do not reclassify an
unsuccessful authoring device after testing. Real touch hardware and physical display observations
are required for their rows. Emulated touch, automated axe, and animation-callback timing remain
supporting evidence only.

1. Open an explicitly shared team canvas from the other licensed user's separate workspace. Verify
   that a board invitation grants its assigned board role without granting origin-workspace
   membership. Confirm the origin label and actual editing/viewing permissions. The viewer must
   remain read-only. Revoke the board share and verify that open scene, saved-version and image
   access clear or are denied, including navigation back to the old page.
2. On supported authoring devices, select through both the surface and Object outline. Create and
   edit a note, text and shape, use connector ports, and change rotated geometry with the numeric
   inspector. Select multiple same-parent objects, group/frame them, move/resize, lock/unlock and
   undo/redo. Check the keyboard/numeric alternatives to dragging, focus visibility, and every
   dialog at narrow portrait/landscape widths and supported zoom. Include multilingual input and
   composition without prematurely submitting text.
3. On real touch devices, draw a complete stroke, pan and pinch with two fingers, and resume
   single-object selection. Verify that closing the inspector stays effective when touching the
   selected object. Record accidental page scrolling, occlusion, precision and responsiveness;
   do not infer physical input quality from a browser-emulation pass.
4. Keep an unsaved text proposal while another editor changes or deletes its target. Confirm that
   recovery retains the proposal, offers copy/discard, and never silently overwrites or recreates
   the remote object. Exercise navigation cancellation, disconnect/reconnect and retry; an
   acknowledgement must agree with the authoritative scene after reloading both devices.
5. Upload a representative original image through the real scanner/storage path and inspect it on
   both devices. Save a named version, remove the current image object, and verify permitted
   historical viewing without exposing it through an unrelated board or guest history route.
   Preview an explicitly linked version from an authorized Round/Presentation and verify removal
   or revoked target access. Check SVG and local PNG downloads, readable alternative text and
   memory/reload behavior. Record dimensions and byte counts, never signed URLs or image content.
6. Exercise anchored comment/reply resolution, the server-clock timer and opt-in presenter follow.
   Keyboard or touch pan/zoom and Escape must leave follow without trapping input. Confirm that a
   viewer cannot post comments or control the timer. The timer must not change the workshop phase.
7. Join the guided workshop through its final-hostname QR/link without a creator account. Submit
   an idea, review the author's own pending content and vote within policy. Only permitted team
   roles may move approved guest cards. A team-only ordinary object/image must remain absent until
   a facilitator explicitly publishes it; publication and removal must update the guest view.
   Guests receive no team comments, saved-version history or team identities. When guest follow is
   enabled, only the explicitly published frame may be followed, with an obvious exit control.
8. Record cold-open, peer-update, guest-publication, reconnect and navigation observations on the
   frozen device/network profile. State the timing method and whether display timing is directly
   observed or only inferred. Retain failures and saturation signals. A short successful session
   does not establish long-soak acceptance, higher object/editor limits or the 500 ms peer target.

Complete the Canvas rows in the device evidence record and the Canvas assistive-technology rows
in the accessibility record. Leave acceptance pending until the required physical scenarios have
been executed and the named owner and independent reviewer accept them.

## Thirty-device lobby

Use at least the frozen matrix's representative device/network mix. Join all thirty devices to one
reviewed room, keep them connected for ten minutes, submit from every selected responder, exercise
at least five disconnect/reconnects, and finish the session. Acceptance requires:

- 30/30 successful joins with host aggregate counts matching the observed roster;
- every device receiving the current block without private projection leakage;
- every submitted response receiving one authoritative acknowledgement;
- zero lost or duplicate accepted answers after reconnect; and
- a ready report whose accepted-answer counts reconcile exactly.

Record timestamps, counts, device mix, issue references, and redacted artifact hashes. Do not
commit raw aliases, answers, cookies, room codes, private URLs, or screenshots containing customer
content.

## Review and cleanup

Resolve every severity-1/2, data-loss, leakage, reconciliation, and material accessibility defect,
then rerun its affected row and the thirty-device lobby when shared behavior changed. Revoke test
credentials, delete synthetic data according to retention policy, and have both the test owner and
independent reviewer accept the completed record before updating the readiness ledger.
