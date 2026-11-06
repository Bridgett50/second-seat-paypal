import { describe, expect, it } from "vitest";
import { WEB_BIND_HOST, createWebServer, validatePostBody } from "../src/server.js";

function post(path: string, body: string, contentType: string): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const server = createWebServer();
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      fetch(`http://localhost:${port}${path}`, {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      })
        .then(async (res) => {
          const json = (await res.json()) as unknown;
          server.close();
          resolve({ status: res.status, json });
        })
        .catch((err: unknown) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe("bind address", () => {
  it("defaults to loopback and does not listen on every interface", () => {
    expect(WEB_BIND_HOST).toBe("127.0.0.1");
  });
});

describe("validatePostBody", () => {
  it("rejects multipart and image content types", () => {
    for (const ct of ["multipart/form-data; boundary=x", "image/png", "Image/PNG"]) {
      expect(validatePostBody("/x", ct, "", null)).toMatch(/text-only/);
    }
  });

  it("rejects image and frame-sidecar body fields", () => {
    for (const field of ["image", "images", "frame", "frames", "sidecar", "frameSidecar", "screenshot", "png", "IMAGE"]) {
      expect(validatePostBody("/x", "application/json", "{}", { [field]: "abc" })).toMatch(/text-only/);
    }
  });

  it("rejects base64 image data in raw or parsed bodies", () => {
    expect(validatePostBody("/x", "application/json", '{"note":"data:image/png;base64,xx"}', null)).toMatch(
      /text-only/,
    );
    expect(validatePostBody("/x", "application/json", "{}", { note: "see data:image/png;base64,xx" })).toMatch(
      /text-only/,
    );
  });

  it("rejects unknown fields on every POST route", () => {
    expect(validatePostBody("/anything", "application/json", "{}", { transcript: "hi" })).toMatch(/unknown field/);
    expect(validatePostBody("/anything", "application/json", "{}", {})).toBeNull();
  });
});

describe("web server POST guard", () => {
  it("returns HTTP 400 with a JSON error for image inputs", async () => {
    const res = await post("/anything", JSON.stringify({ frameSidecar: "f" }), "application/json");
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: expect.stringContaining("text-only") as unknown });
  });

  it("returns HTTP 400 with a JSON error for multipart uploads", async () => {
    const res = await post("/anything", "--x", "multipart/form-data; boundary=x");
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: expect.any(String) as unknown });
  });

  it("returns HTTP 400 with a JSON error for unknown fields", async () => {
    const res = await post("/anything", JSON.stringify({ hello: "world" }), "application/json");
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: expect.stringContaining("unknown field") as unknown });
  });
});
