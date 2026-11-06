import { describe, expect, it } from "vitest";
import { createTwinRoom } from "../src/t2-room.js";
import {
  deriveApprovedPackage,
  parseImportedEmail,
  serializeApprovedPackage,
} from "../src/t2-room.js";
import { packageHash } from "../src/meeting/connector.js";

function makeRoom() {
  const room = createTwinRoom({ testMode: true, transport: async () => {} });
  return room;
}

function streamAllTranscript(room: ReturnType<typeof createTwinRoom>): string[] {
  let guard = 0;
  while (room.streamNextLine().appended && guard < 100) guard += 1;
  return [...room.view().transcript];
}

/** Canonical identical draft text for the selected meeting's current body. */
function identicalTextFor(room: ReturnType<typeof createTwinRoom>): string {
  const script = streamAllTranscript(room);
  const v = room.view();
  const pkg = deriveApprovedPackage({
    title: v.selectedMeetingTitle,
    script,
    body: v.draft.body,
  });
  return serializeApprovedPackage(pkg);
}

describe("t2 email compare", () => {
  it("T8-1 an identical imported draft produces no comparison flags", () => {
    const room = makeRoom();
    expect(room.approve().approved).toBe(true);
    const text = identicalTextFor(room);
    const cmp = room.compareImported(text);
    expect(cmp).not.toBeNull();
    expect(cmp!.identical).toBe(true);
    expect(cmp!.flags).toEqual([]);
    expect(cmp!.recipients.equal).toBe(true);
    expect(cmp!.subject.equal).toBe(true);
    expect(cmp!.body.equal).toBe(true);
    expect(cmp!.attachments.equal).toBe(true);
  });

  it("T8-2 each differing field (recipients, subject, body, attachments) is flagged", () => {
    const room = makeRoom();
    expect(room.approve().approved).toBe(true);
    const base = identicalTextFor(room);
    const parsed = parseImportedEmail(base);
    expect(parsed.to.length).toBeGreaterThan(0);
    expect(parsed.attachments.length).toBeGreaterThan(0);

    const recVariant = base.replace(parsed.to[0]!, "intruder@example.test");
    expect(recVariant).not.toBe(base);
    const recCmp = room.compareImported(recVariant);
    expect(recCmp).not.toBeNull();
    expect([...recCmp!.flags]).toEqual(["recipients"]);

    const subVariant = base.replace(/^Subject: .*$/m, "Subject: A completely different subject");
    expect(subVariant).not.toBe(base);
    const subCmp = room.compareImported(subVariant);
    expect(subCmp).not.toBeNull();
    expect([...subCmp!.flags]).toEqual(["subject"]);

    const bodyVariant = `${base}\nOne extra synthetic body line.`;
    const bodyCmp = room.compareImported(bodyVariant);
    expect(bodyCmp).not.toBeNull();
    expect([...bodyCmp!.flags]).toEqual(["body"]);
    expect(bodyCmp!.body.added).toContain("One extra synthetic body line.");

    const attVictim = parsed.attachments[0]!;
    const attVariant = base.replace(attVictim, "unrelated-notes.txt");
    expect(attVariant).not.toBe(base);
    const attCmp = room.compareImported(attVariant);
    expect(attCmp).not.toBeNull();
    expect([...attCmp!.flags]).toEqual(["attachments"]);
  });

  it("T8-3 comparison never alters the approved package or its sha256", async () => {
    const room = makeRoom();
    expect(room.approve().approved).toBe(true);
    const before = room.view();
    const beforeBody = before.draft.body;
    const beforeHash = before.draft.sha256;
    expect(beforeHash).toBe(packageHash(beforeBody));
    const beforeCopy = room.copyText();
    expect(beforeCopy).toBe(beforeBody);

    const identical = identicalTextFor(room);
    const same = room.compareImported(identical);
    expect(same).not.toBeNull();
    expect(same!.identical).toBe(true);

    const different = identical
      .replace(/^Subject: .*$/m, "Subject: Changed subject")
      .replace(/@example\.test/, "@example.test")
      .concat("\nAnother synthetic line.");
    const diff = room.compareImported(different);
    expect(diff).not.toBeNull();
    expect(diff!.identical).toBe(false);
    expect(diff!.flags.length).toBeGreaterThan(0);

    const after = room.view();
    expect(after.draft.body).toBe(beforeBody);
    expect(after.draft.sha256).toBe(beforeHash);
    expect(after.draft.sha256).toBe(packageHash(after.draft.body));
    expect(after.draft.approved).toBe(true);
    expect(after.exportInventory).toEqual({ copy: true, mailto: true, file: true });
    expect(room.copyText()).toBe(beforeCopy);
    expect(room.copyText()).toBe(beforeBody);
  });

  it("T8-4 comparison requires a current approved package", () => {
    const room = makeRoom();
    const probe = identicalTextFor(room);
    expect(room.compareImported(probe)).toBeNull();
    expect(room.compareImported("To: a@example.test\n\nHello")).toBeNull();

    expect(room.approve().approved).toBe(true);
    const text = identicalTextFor(room);
    expect(room.compareImported(text)).not.toBeNull();

    room.editDraft(`${room.view().draft.body}\nEdited after approval.`);
    expect(room.view().draft.approved).toBe(false);
    expect(room.compareImported(text)).toBeNull();
  });
});
