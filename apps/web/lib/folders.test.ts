import { describe, expect, it } from "vitest";
import {
  folderArtifactType,
  folderPathLabel,
  folderSiblingPosition,
  getFolderMoveOptions,
  getFolderOptions,
  type FolderRecord,
} from "./folders";

const folders: FolderRecord[] = [
  { id: "child", name: "Shared", parentId: "root", position: 0, artifactType: "round" },
  { id: "second", name: "Later", parentId: null, position: 1, artifactType: "round" },
  { id: "root", name: "First", parentId: null, position: 0, artifactType: "round" },
  { id: "grandchild", name: "Deep", parentId: "child", position: 0, artifactType: "round" },
  { id: "other-child", name: "Shared", parentId: "second", position: 0, artifactType: "round" },
];

describe("folder trees", () => {
  it("maps every Library type to its isolated API type", () => {
    expect(
      ["rounds", "presentations", "surveys"].map((type) =>
        folderArtifactType(type as "rounds" | "presentations" | "surveys"),
      ),
    ).toEqual(["round", "presentation", "survey"]);
  });

  it("orders siblings while retaining hierarchy and distinguishing repeated names", () => {
    expect(getFolderOptions(folders)).toEqual([
      { id: "root", name: "First", label: "First", depth: 0 },
      { id: "child", name: "Shared", label: "First / Shared", depth: 1 },
      { id: "grandchild", name: "Deep", label: "First / Shared / Deep", depth: 2 },
      { id: "second", name: "Later", label: "Later", depth: 0 },
      { id: "other-child", name: "Shared", label: "Later / Shared", depth: 1 },
    ]);
    expect(folderPathLabel(folders, "grandchild")).toBe("First / Shared / Deep");
    expect(folderPathLabel(folders, "missing")).toBeNull();
  });

  it("never offers a folder or any descendant as its own parent", () => {
    expect(getFolderMoveOptions(folders, "root").map((folder) => folder.id)).toEqual([
      "second",
      "other-child",
    ]);
    expect(getFolderMoveOptions(folders, "child").map((folder) => folder.id)).toEqual([
      "root",
      "second",
      "other-child",
    ]);
  });

  it("reorders only siblings and disables moves past either boundary", () => {
    expect(folderSiblingPosition(folders, "root", "up")).toBeNull();
    expect(folderSiblingPosition(folders, "root", "down")).toBe(1);
    expect(folderSiblingPosition(folders, "second", "up")).toBe(0);
    expect(folderSiblingPosition(folders, "second", "down")).toBeNull();
    expect(folderSiblingPosition(folders, "child", "down")).toBeNull();
  });

  it("handles an incomplete or cyclic cached tree without omitting folders or looping", () => {
    const invalid = [
      { ...folders[0]!, parentId: "missing" },
      { ...folders[2]!, parentId: "grandchild" },
      { ...folders[3]!, parentId: "root" },
    ];
    expect(new Set(getFolderOptions(invalid).map((folder) => folder.id)).size).toBe(3);
    expect(folderPathLabel(invalid, "root")).toBe("Deep / First");
  });
});
