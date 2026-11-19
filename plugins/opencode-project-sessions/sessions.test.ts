import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, flatten, type ProjectData, type SessionRowData } from "./sessions.ts";

function session(
  id: string,
  projectID: string,
  directory: string,
  options: { title?: string; created?: number; updated?: number; idle?: number } = {},
): SessionRowData {
  return {
    id,
    parentID: undefined,
    projectID,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: options.created ?? options.updated ?? 1,
      updated: options.updated ?? 1,
      idle: options.idle,
    },
    title: options.title,
    location: { directory },
  } as SessionRowData;
}

function project(
  id: string,
  canonical: string,
  name?: string,
  active = 0,
): ProjectData {
  return {
    id,
    canonical,
    name,
    time: { created: 0, updated: 0, active },
    sandboxes: [],
  } as ProjectData;
}

test("groups sessions by project and sorts newest first", () => {
  const snapshot = buildSnapshot(
    [
      session("s1", "p1", "/work/alpha", { title: "one", updated: 100 }),
      session("s2", "p2", "/work/beta", { title: "two", updated: 300 }),
      session("s3", "p1", "/work/alpha", { title: "three", updated: 200 }),
    ],
    [project("p1", "/work/alpha", "alpha"), project("p2", "/work/beta", "beta")],
    { complete: true },
  );

  assert.equal(snapshot.projectCount, 2);
  assert.equal(snapshot.sessionCount, 3);
  // beta's newest (300) beats alpha's newest (200).
  assert.deepEqual(
    snapshot.groups.map((group) => group.name),
    ["beta", "alpha"],
  );
  assert.deepEqual(
    snapshot.groups[1]?.rows.map((row) => row.title),
    ["three", "one"],
  );
});

test("keeps root-project sessions apart by directory", () => {
  // Sessions outside a repository all share the "/" project; grouping them
  // together would merge unrelated scratch directories.
  const snapshot = buildSnapshot(
    [
      session("s1", "root", "/tmp/a", { title: "a1" }),
      session("s2", "root", "/tmp/b", { title: "b1" }),
    ],
    [project("root", "/", "Root")],
    { complete: true },
  );

  assert.equal(snapshot.projectCount, 2);
  assert.deepEqual(
    snapshot.groups.map((group) => group.name).sort(),
    ["a", "b"],
  );
});

test("disambiguates same-named projects with the parent directory", () => {
  const snapshot = buildSnapshot(
    [
      session("s1", "p1", "/one/app", { title: "x" }),
      session("s2", "p2", "/two/app", { title: "y" }),
    ],
    [project("p1", "/one/app", "app"), project("p2", "/two/app", "app")],
    { complete: true },
  );

  const hints = snapshot.groups.map((group) => group.hint).sort();
  assert.deepEqual(hints, ["/one", "/two"]);
});

test("does not add a parent hint when names are unique", () => {
  const snapshot = buildSnapshot(
    [session("s1", "p1", "/one/alpha", { title: "x" })],
    [project("p1", "/one/alpha", "alpha")],
    { complete: true },
  );
  assert.equal(snapshot.groups[0]?.hint, undefined);
});

test("prefers idle over updated for activity, so restarts do not reshuffle", () => {
  // A restart bumps `updated` without any agent work while `idle` stays put,
  // so a stale session must not jump ahead of one that actually ran.
  const snapshot = buildSnapshot(
    [
      session("stale", "p1", "/work/alpha", {
        title: "stale",
        created: 100,
        updated: 900,
        idle: 100,
      }),
      session("live", "p1", "/work/alpha", {
        title: "live",
        created: 400,
        updated: 500,
        idle: 500,
      }),
    ],
    [project("p1", "/work/alpha", "alpha")],
    { complete: true },
  );

  assert.deepEqual(
    snapshot.groups[0]?.rows.map((row) => row.title),
    ["live", "stale"],
  );
});

test("marks running sessions from the status map", () => {
  const snapshot = buildSnapshot(
    [session("s1", "p1", "/work/alpha", { title: "x" })],
    [project("p1", "/work/alpha", "alpha")],
    { complete: true, status: { s1: true } },
  );
  assert.equal(snapshot.groups[0]?.rows[0]?.running, true);
});

test("searches titles, project names and directories", () => {
  const data = [
    session("s1", "p1", "/work/alpha", { title: "Fix parser" }),
    session("s2", "p2", "/work/beta", { title: "Deploy" }),
  ];
  const projects = [
    project("p1", "/work/alpha", "alpha"),
    project("p2", "/work/beta", "beta"),
  ];

  const byTitle = buildSnapshot(data, projects, { complete: true, query: "parser" });
  assert.equal(byTitle.sessionCount, 1);

  const byProject = buildSnapshot(data, projects, { complete: true, query: "beta" });
  assert.equal(byProject.sessionCount, 1);

  const byDirectory = buildSnapshot(data, projects, { complete: true, query: "/work/alpha" });
  assert.equal(byDirectory.sessionCount, 1);

  const nothing = buildSnapshot(data, projects, { complete: true, query: "zzz" });
  assert.equal(nothing.sessionCount, 0);
  assert.equal(nothing.groups.length, 0);
});

test("falls back to Untitled and tolerates missing projects", () => {
  const snapshot = buildSnapshot([
    session("s1", "missing", "/orphan/dir", {}),
  ], [], { complete: true });

  assert.equal(snapshot.groups[0]?.rows[0]?.title, "Untitled");
  assert.equal(snapshot.groups[0]?.name, "dir");
});

test("propagates the incomplete flag so the UI can say partial", () => {
  const snapshot = buildSnapshot([], [], {
    complete: false,
    error: "boom",
  });
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.error, "boom");
});
test("flattens sessions into searchable rows newest first", () => {
  const projects: ProjectData[] = [
    { id: "p1", name: "alpha", canonical: "/work/alpha" },
    { id: "p2", name: "beta", canonical: "/work/beta" },
  ] as ProjectData[];
  const snapshot = buildSnapshot(
    [
      session("old", "p1", "/work/alpha", { title: "Older", updated: 10 }),
      session("new", "p2", "/work/beta", { title: "Newer", updated: 99 }),
    ],
    projects,
    { complete: true },
  );

  const rows = flatten(snapshot);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.id), ["new", "old"]);
  // The project and directory must ride along so the picker can label rows.
  assert.equal(rows[0]?.project, "beta");
  assert.equal(rows[0]?.directory, "/work/beta");
});

test("attaches manual status by session id, never by title", () => {
  const projects: ProjectData[] = [
    { id: "p1", name: "alpha", canonical: "/work/alpha" },
  ] as ProjectData[];
  const snapshot = buildSnapshot(
    [
      session("s1", "p1", "/work/alpha", { title: "Same name", updated: 20 }),
      session("s2", "p1", "/work/alpha", { title: "Same name", updated: 10 }),
    ],
    projects,
    { complete: true, manual: { s1: "urgent", s2: "completed" } },
  );

  const rows = snapshot.groups[0]?.rows ?? [];
  // Identical titles must still hold independent statuses.
  assert.deepEqual(rows.map((row) => [row.id, row.status]), [
    ["s1", "urgent"],
    ["s2", "completed"],
  ]);
});

test("filters to a single status when one is requested", () => {
  const projects: ProjectData[] = [
    { id: "p1", name: "alpha", canonical: "/work/alpha" },
  ] as ProjectData[];
  const data = [
    session("a", "p1", "/work/alpha", { updated: 30 }),
    session("b", "p1", "/work/alpha", { updated: 20 }),
    session("c", "p1", "/work/alpha", { updated: 10 }),
  ];
  const manual = { a: "urgent", b: "completed" } as const;

  const urgent = buildSnapshot(data, projects, { complete: true, manual, only: "urgent" });
  assert.deepEqual(urgent.groups.flatMap((g) => g.rows.map((r) => r.id)), ["a"]);

  // "not-started" must not match sessions with no status at all: absent is not
  // the same as explicitly not started.
  const notStarted = buildSnapshot(data, projects, { complete: true, manual, only: "not-started" });
  assert.equal(notStarted.sessionCount, 0);

  const all = buildSnapshot(data, projects, { complete: true, manual, only: null });
  assert.equal(all.sessionCount, 3);
});
