import { expect, test } from "vitest";
import { describeReviewAction } from "./review-tools";

test("names the tool and the path it touches", () => {
  expect(
    describeReviewAction("readFile", {
      path: "src/cart.js",
      startLine: 1,
      endLine: 9,
    }),
  ).toBe("Reading src/cart.js");
  expect(
    describeReviewAction("searchText", { query: "total", pathPrefix: "src/" }),
  ).toBe("Searching src/");
  expect(describeReviewAction("listFiles", { prefix: "" })).toBe(
    "Listing the repository",
  );
});

test("keeps repository text to one short line", () => {
  const action = describeReviewAction("readFile", {
    path: `src/evil\nName\t${"x".repeat(300)}`,
  });
  expect(action).not.toMatch(/\p{Cc}/u);
  expect(action.length).toBeLessThanOrEqual(120);
  expect(action.endsWith("…")).toBe(true);
});

test("falls back for malformed arguments", () => {
  expect(describeReviewAction("readFile", "not an object")).toBe(
    "Reading a file",
  );
  expect(describeReviewAction("mystery", {})).toBe("Running mystery");
});
