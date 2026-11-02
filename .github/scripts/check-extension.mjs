// Checks the extension before it can reach a release (run by .github/workflows/check.yml, or
// locally with `node .github/scripts/check-extension.mjs`):
// - every script parses
// - the manifest is valid JSON, and every file it names exists
// - every file the background script imports, every local script and stylesheet the
//   extension's pages load, and every file a stylesheet points to (url()), exists
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const EXT = join(import.meta.dirname, '..', '..', 'extension');
const problems = [];

function walk(dir) {
	return readdirSync(dir).flatMap(name => {
		const path = join(dir, name);
		if (name.startsWith('_')) return []; // Chrome's own folders (_metadata)
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}
const files = walk(EXT);

// every script parses
for (const file of files.filter(f => f.endsWith('.js'))) {
	try {
		execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
	} catch (e) {
		problems.push(`${relative(EXT, file)} doesn't parse:\n${e.stderr.toString().trim()}`);
	}
}

// the manifest
let manifest;
try {
	manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
} catch (e) {
	problems.push(`manifest.json isn't valid JSON: ${e.message}`);
}

function mustExist(path, from) {
	if (!existsSync(join(EXT, path))) problems.push(`${from} names ${path}, which doesn't exist`);
}

if (manifest) {
	for (const entry of manifest.content_scripts || []) {
		for (const path of [...(entry.js || []), ...(entry.css || [])]) mustExist(path, 'manifest.json (content_scripts)');
	}
	if (manifest.background?.service_worker) mustExist(manifest.background.service_worker, 'manifest.json (background)');
	if (manifest.action?.default_popup) mustExist(manifest.action.default_popup, 'manifest.json (action)');
	if (manifest.options_ui?.page) mustExist(manifest.options_ui.page, 'manifest.json (options_ui)');
	for (const path of Object.values({ ...manifest.icons, ...manifest.action?.default_icon })) mustExist(path, 'manifest.json (icons)');

	// what the background script imports
	if (manifest.background?.service_worker) {
		const source = readFileSync(join(EXT, manifest.background.service_worker), 'utf8');
		for (const call of source.matchAll(/importScripts\(([^)]*)\)/g)) {
			for (const [, path] of call[1].matchAll(/['"]([^'"]+)['"]/g)) mustExist(path.replace(/^\.\//, ''), manifest.background.service_worker);
		}
	}
}

// what the extension's pages load from the extension
for (const page of files.filter(f => f.endsWith('.html'))) {
	const html = readFileSync(page, 'utf8');
	for (const [, path] of html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)) {
		if (!/^[a-z]+:|^\/\//i.test(path)) mustExist(path, relative(EXT, page));
	}
}

// what the extension's stylesheets load (fonts, images), relative to each stylesheet
for (const sheet of files.filter(f => f.endsWith('.css'))) {
	const css = readFileSync(sheet, 'utf8');
	for (const [, , path] of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
		if (/^[a-z]+:|^\/\/|^#/i.test(path)) continue; // data:, https:, an SVG's own #id
		const target = relative(EXT, join(sheet, '..', path.split(/[?#]/)[0]));
		if (!existsSync(join(EXT, target))) problems.push(`${relative(EXT, sheet)} names ${path}, which doesn't exist`);
	}
}

if (problems.length) {
	console.error(problems.map(p => `✗ ${p}`).join('\n'));
	process.exit(1);
}
console.log(`✓ ${files.filter(f => f.endsWith('.js')).length} scripts parse, and every file the manifest, pages and stylesheets name exists`);
