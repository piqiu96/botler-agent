import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, type Dirent } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG } from "../config.ts";

/** A first-level project dir that is its own git repo (the multi-repo layout). */
function isIndependentRepo(root: string, d: Dirent): boolean {
	return d.isDirectory() && !d.name.startsWith(".") && existsSync(join(root, d.name, ".git"));
}

/**
 * Single-repo fallback: DATA_ROOT itself is the git repo and no first-level subdir is.
 * Commit at the root, scoped to the projects selected for this task.
 */
function commitRootIfChanged(msg: string, root: string, entries: Dirent[], projects?: readonly string[]): void {
	if (projects && projects.length === 0) return;
	const dirs = new Set(
		entries.filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name),
	);
	// Only ever pass real first-level dir names, so a crafted project name cannot escape DATA_ROOT.
	const paths = projects ? projects.filter((p) => dirs.has(p)) : ["."];
	if (paths.length === 0) return;
	try {
		execFileSync("git", ["add", "-A", "--", ...paths], { cwd: root, stdio: "ignore" });
		const status = execFileSync("git", ["status", "--porcelain", "--", ...paths], { cwd: root }).toString();
		if (status.trim()) {
			execFileSync("git", ["commit", "-m", msg], { cwd: root, stdio: "ignore" });
			console.log(`[git] committed root: ${msg}`);
			if (CONFIG.gitPush) {
				try {
					execFileSync("git", ["push"], { cwd: root, stdio: "ignore" });
					console.log(`[git] pushed root`);
				} catch (e) {
					console.error(`[git] push failed for root：${e instanceof Error ? e.message : e}`);
				}
			}
		}
	} catch (e) {
		const msgText = e instanceof Error ? e.message : String(e);
		console.error(`[git] commit failed for root: ${msgText}`);
	}
}

/**
 * Commit changed data subprojects. Each first-level subdir under DATA_ROOT, if it is its own git repo
 * and has non-empty `git status --porcelain`, gets add + commit. The glue layer does the commit; the agent never touches bash.
 * When DATA_ROOT itself is a git repo while none of its first-level subdirs is (single-repo layout), the
 * root repo is committed instead, scoped to the selected projects.
 * When GIT_PUSH=1, additionally push (failure is only a warning, not a blocker).
 */
export function commitIfChanged(msg: string, projects?: readonly string[]): void {
	if (!CONFIG.dataRoot) return;
	const root = resolve(CONFIG.dataRoot);
	if (!existsSync(root)) return;

	let entries: Dirent[];
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return;
	}

	if (existsSync(join(root, ".git")) && !entries.some((d) => isIndependentRepo(root, d))) {
		commitRootIfChanged(msg, root, entries, projects);
		return;
	}

	for (const d of entries) {
		if (!d.isDirectory() || d.name.startsWith(".")) continue;
		if (projects && !projects.includes(d.name)) continue;
		const dir = join(root, d.name);
		if (!existsSync(join(dir, ".git"))) continue;
		try {
			execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
			const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir }).toString();
			if (status.trim()) {
				execFileSync("git", ["commit", "-m", msg], { cwd: dir, stdio: "ignore" });
				console.log(`[git] committed ${d.name}: ${msg}`);
				if (CONFIG.gitPush) {
					try {
						execFileSync("git", ["push"], { cwd: dir, stdio: "ignore" });
						console.log(`[git] pushed ${d.name}`);
					} catch (e) {
						console.error(`[git] push failed for ${d.name}：${e instanceof Error ? e.message : e}`);
					}
				}
			}
		} catch (e) {
			const msgText = e instanceof Error ? e.message : String(e);
			console.error(`[git] commit failed for ${d.name}: ${msgText}`);
		}
	}
}
