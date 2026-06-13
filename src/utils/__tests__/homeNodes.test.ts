import { describe, expect, it } from "vitest";
import type { HomeNodeSummary } from "@/services/wsStore";
import {
  getHomeGroupOptions,
  sortHomeNodeSummaries,
} from "@/utils/homeNodes";

function node(partial: Partial<HomeNodeSummary> & Pick<HomeNodeSummary, "uuid">): HomeNodeSummary {
  return {
    group: "",
    hidden: false,
    region: "",
    online: true,
    trafficDown: 0,
    trafficUp: 0,
    netDown: 0,
    netUp: 0,
    weight: 0,
    ...partial,
  };
}

describe("home node helpers", () => {
  it("builds group tabs from non-empty backend groups and keeps first-seen order", () => {
    expect(
      getHomeGroupOptions([
        node({ uuid: "a", group: "US 美国" }),
        node({ uuid: "b", group: "HK 香港" }),
        node({ uuid: "c", group: "US 美国" }),
        node({ uuid: "d", group: "" }),
      ]),
    ).toEqual(["US 美国", "HK 香港"]);
  });

  it("moves offline nodes behind online nodes without crossing the filtered set", () => {
    const sorted = sortHomeNodeSummaries(
      [
        node({ uuid: "offline-low", online: false, weight: 1 }),
        node({ uuid: "online-high", online: true, weight: 8 }),
        node({ uuid: "online-low", online: true, weight: 2 }),
        node({ uuid: "unknown", online: null, weight: 0 }),
      ],
      true,
    );

    expect(sorted.map((item) => item.uuid)).toEqual([
      "unknown",
      "online-low",
      "online-high",
      "offline-low",
    ]);
  });

  it("preserves backend order when offline sorting is disabled", () => {
    const nodes = [
      node({ uuid: "offline", online: false, weight: 1 }),
      node({ uuid: "online", online: true, weight: 2 }),
    ];

    expect(sortHomeNodeSummaries(nodes, false)).toBe(nodes);
  });
});
