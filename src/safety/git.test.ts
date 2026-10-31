import { before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let git: typeof import("./git.ts");
let CONFIG: typeof import("../config.ts").CONFIG;

let root = "";
let rootRepo = "";

function log(project: string): string {
	try {
		return execFileSync("git", ["log", "--oneline"], { cwd: path.join(root, project) }).toString().trim();
	} catch {
		return "";
	}
}

function rootLog(): string {
	try {
		return execFileSync("git", ["log", "--oneline"], { cwd: rootRepo }).toString().trim();
	} catch {
		return "";
	}
}

/** Temporarily point the loaded CONFIG at another DATA_ROOT (git.ts reads it per call). */
function withDataRoot<T>(dir: string, fn: () => T): T {
	const prev = CONFIG.dataRoot;
	CONFIG.dataRoot = dir;
	try {
		return fn();
	} finally {
		CONFIG.dataRoot = prev;
	}
}

function initRepo(dir: string): void {
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
}

before(async () => {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "botler-git-")));
	for (const name of ["cook", "vocab"]) {
		const dir = path.join(root, name);
		fs.mkdirSync(dir);
		initRepo(dir);
	}

	// Single-repo layout: DATA_ROOT itself is the git repo, subdirs are plain directories.
	rootRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "botler-git-root-")));
	initRepo(rootRepo);
	fs.mkdirSync(path.join(rootRepo, "cook"));

	process.env.DATA_ROOT = root;
	process.env.GIT_PUSH = "0";
	git = await import("./git.ts");
	CONFIG = (await import("../config.ts")).CONFIG;
});

test("commitIfChanged scoped to a selected repo only commits that repo", () => {
	for (const name of ["cook", "vocab"]) {
		fs.writeFileSync(path.join(root, name, "data.json"), '{"v":1}');
	}

	git.commitIfChanged("test: scoped commit", ["cook"]);

	assert.match(log("cook"), /test: scoped commit/);
	assert.equal(log("vocab"), "");
});

test("commitIfChanged with no projects commits every changed repo", () => {
	fs.writeFileSync(path.join(root, "vocab", "second.json"), '{"v":2}');

	git.commitIfChanged("test: all commit");

	assert.match(log("vocab"), /test: all commit/);
});

test("commitIfChanged with an empty set commits nothing", () => {
	fs.writeFileSync(path.join(root, "cook", "third.json"), '{"v":3}');

	const beforeCook = log("cook");
	git.commitIfChanged("test: empty", []);
	assert.equal(log("cook"), beforeCook);
});

test("root-repo mode: scoped commit only includes the selected project", () => {
	fs.writeFileSync(path.join(rootRepo, "cook", "data.json"), '{"v":1}');
	fs.mkdirSync(path.join(rootRepo, "vocab"));
	fs.writeFileSync(path.join(rootRepo, "vocab", "data.json"), '{"v":2}');

	withDataRoot(rootRepo, () => git.commitIfChanged("test: root scoped", ["cook"]));

	assert.match(rootLog(), /test: root scoped/);
	const status = execFileSync("git", ["status", "--porcelain"], { cwd: rootRepo }).toString();
	assert.doesNotMatch(status, /cook\//);
	assert.match(status, /\?\? vocab\//);
});

test("root-repo mode: with no projects commits every change in the root repo", () => {
	withDataRoot(rootRepo, () => git.commitIfChanged("test: root all"));

	assert.match(rootLog(), /test: root all/);
	const status = execFileSync("git", ["status", "--porcelain"], { cwd: rootRepo }).toString();
	assert.equal(status.trim(), "");
});

test("root-repo mode: no changes commits nothing", () => {
	const before = rootLog();
	withDataRoot(rootRepo, () => git.commitIfChanged("test: root noop", ["cook"]));
	assert.equal(rootLog(), before);
});

test("root-repo mode: an empty project set commits nothing", () => {
	fs.writeFileSync(path.join(rootRepo, "cook", "second.json"), '{"v":3}');

	const before = rootLog();
	withDataRoot(rootRepo, () => git.commitIfChanged("test: root empty", []));
	assert.equal(rootLog(), before);
});

test("root-repo mode: unknown project names are ignored", () => {
	const before = rootLog();
	withDataRoot(rootRepo, () => git.commitIfChanged("test: root unknown", ["../etc"]));
	assert.equal(rootLog(), before);
});
