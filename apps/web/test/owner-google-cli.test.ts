import { describe, it, expect } from "vitest";
import { validateOwnerGoogleClient } from "../src/ownerGoogleMeetCli.js";
const CB = "http://localhost:4173/api/google/oauth/callback";
const valid = (): unknown => ({
  web: { client_id: "synthetic-client", client_secret: "synthetic-secret", redirect_uris: [CB] },
});

describe("validateOwnerGoogleClient", () => {
  it("accepts valid standard and freezes result", () => {
    const r = validateOwnerGoogleClient(valid());
    expect(r.clientId).toBe("synthetic-client");
    expect(r.redirectUri).toBe(CB);
    expect(Object.isFrozen(r)).toBe(true);
    const withExtra = { web: { client_id: "synthetic-client", client_secret: "synthetic-secret", redirect_uris: [CB], project_id: "x", auth_uri: "https://accounts.google.com/o/oauth2/auth" } };
    expect(validateOwnerGoogleClient(withExtra).clientId).toBe("synthetic-client");
  });
  it("rejects malformed root/missing/blank/control/bad redirect", () => {
    expect(() => validateOwnerGoogleClient(null)).toThrow();
    expect(() => validateOwnerGoogleClient({})).toThrow();
    expect(() => validateOwnerGoogleClient({ web: null })).toThrow();
    expect(() => validateOwnerGoogleClient({ web: { client_secret: "synthetic-secret", redirect_uris: [CB] } })).toThrow();
    expect(() => validateOwnerGoogleClient({ web: { client_id: "", client_secret: "synthetic-secret", redirect_uris: [CB] } })).toThrow();
    expect(() => validateOwnerGoogleClient({ web: { client_id: "a"+String.fromCharCode(0)+"b", client_secret: "synthetic-secret", redirect_uris: [CB] } })).toThrow();
    expect(() => validateOwnerGoogleClient({ web: { client_id: "a"+String.fromCharCode(10)+"b", client_secret: "synthetic-secret", redirect_uris: [CB] } })).toThrow();
    expect(() => validateOwnerGoogleClient({ web: { client_id: "a"+String.fromCharCode(9)+"b", client_secret: "synthetic-secret", redirect_uris: [CB] } })).toThrow();
    expect(() => validateOwnerGoogleClient({ web: { client_id: "a"+String.fromCharCode(127)+"b", client_secret: "synthetic-secret", redirect_uris: [CB] } })).toThrow();
    expect(() => validateOwnerGoogleClient({ web: { client_id: "a"+String.fromCharCode(13,10)+"b", client_secret: "synthetic-secret", redirect_uris: [CB] } })).toThrow();
    expect(() => validateOwnerGoogleClient({ web: { client_id: "synthetic-client", client_secret: "synthetic-secret", redirect_uris: ["https://localhost:4173/api/google/oauth/callback"] } })).toThrow();
    expect(() => validateOwnerGoogleClient({ web: { client_id: "synthetic-client", client_secret: "synthetic-secret", redirect_uris: ["http://example.com/cb"] } })).toThrow();
    expect(() => validateOwnerGoogleClient({ web: { client_id: "synthetic-client", client_secret: "synthetic-secret", redirect_uris: ["http://localhost:9999/api/google/oauth/callback"] } })).toThrow();
    expect(() => validateOwnerGoogleClient({ web: { client_id: "synthetic-client", client_secret: "synthetic-secret", redirect_uris: [CB + "?x=1"] } })).toThrow();
  });
  it("does not execute getters", () => {
    let rootFired = false;
    const rootTrap: Record<string, unknown> = {};
    Object.defineProperty(rootTrap, "web", { get() { rootFired = true; return { client_id: "synthetic-client", client_secret: "synthetic-secret", redirect_uris: [CB] }; }, enumerable: true, configurable: true });
    expect(() => validateOwnerGoogleClient(rootTrap)).toThrow();
    expect(rootFired).toBe(false);
    let fieldFired = false;
    const webTrap: Record<string, unknown> = {};
    Object.defineProperty(webTrap, "client_id", { get() { fieldFired = true; return "synthetic-client"; }, enumerable: true, configurable: true });
    (webTrap as Record<string, unknown>)["client_secret"] = "synthetic-secret";
    (webTrap as Record<string, unknown>)["redirect_uris"] = [CB];
    expect(() => validateOwnerGoogleClient({ web: webTrap })).toThrow();
    expect(fieldFired).toBe(false);
    let arrFired = false;
    const arr: string[] = [];
    Object.defineProperty(arr, "0", { get() { arrFired = true; return CB; }, enumerable: true, configurable: true });
    expect(() => validateOwnerGoogleClient({ web: { client_id: "synthetic-client", client_secret: "synthetic-secret", redirect_uris: arr } })).toThrow();
    expect(arrFired).toBe(false);
  });
});
