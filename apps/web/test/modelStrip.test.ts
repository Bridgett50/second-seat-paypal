import { describe, expect, it } from "vitest";
import { modelChips } from "../src/modelStrip.js";
import { loadDemo } from "../src/loadFixtures.js";

describe("modelChips", () => {
  it("maps the sam-region stage from the run log", () => {
    const { runLog } = loadDemo();
    const chips = modelChips(runLog);
    expect(chips.map((c) => c.stage)).toEqual([
      "glimmer-redact",
      "spark-brief",
      "spark-shield",
      "sam-region",
      "image-slide",
    ]);
    const logged = runLog.find((l) => l.stage === "sam-region");
    expect(chips.find((c) => c.stage === "sam-region")).toEqual(
      logged === undefined
        ? { stage: "sam-region", model: null, status: "not run" }
        : { stage: "sam-region", model: logged.model, status: "run" },
    );
  });

  it("reports the model for stages present in the run log", () => {
    const { runLog } = loadDemo();
    const chips = modelChips(runLog);
    expect(
      chips.find((c) => c.stage === "glimmer-redact"),
    ).toMatchObject({ status: "run", model: "meta-models/Muse-Glimmer-30B" });
  });
});
