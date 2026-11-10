import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGES = new Set(['tokens', 'motion', 'gates', 'seo-kit', 'ui', 'analytics', 'i18n-core', 'config']);
const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides', 'resolutions'];
const RELEASE = /^https:\/\/github\.com\/yesid-dev\/yesid\.design\/releases\/download\/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\/yesid-([a-z0-9._-]+)-\1\.tgz$/;
const REHEARSAL = 'The PR may rehearse on a release candidate but can merge only after switching to the stable release.';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const design = name => name?.startsWith('@yesid/') && PACKAGES.has(name.slice(7));

// A complete version operand cannot consume a package-name prefix such as v8.
const OPERAND = /^v?(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?|(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2})(?=$|\s|\|\||[/>])/;
const PACKAGE = /^(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*(?=$|[@/>\s])/;

// Parse the range left to right. An ancestry boundary is legal only after a
// complete range term, never within a comparator operand or after an empty union.
function qualifierBoundary(text) {
  let index = 0;
  let complete = false;
  while (true) {
    const space = /^\s*/.exec(text.slice(index))[0].length;
    index += space;
    if (index === text.length) return complete ? { index: -1 } : { ambiguous: true };
    if (complete) {
      if (text.startsWith('||', index)) {
        index += 2;
        complete = false;
        continue;
      }
      const separator = text[index];
      if (separator === '/' || separator === '>') {
        const tail = text.slice(index + 1).trimStart();
        const operand = tail.startsWith('=') ? tail.slice(1).trimStart() : tail;
        if (separator === '/' || !OPERAND.test(operand)) {
          return PACKAGE.test(tail.replace(/^(?:\*\*\/)+/, '')) ? { index } : { ambiguous: true };
        }
      }
      if (!space) return { ambiguous: true };
    }
    const comparator = /^(?:>=|<=|>|<|=|~|\^)?\s*/.exec(text.slice(index))[0];
    index += comparator.length;
    const operand = OPERAND.exec(text.slice(index));
    if (!operand) return { ambiguous: true };
    index += operand[0].length;
    const hyphen = /^\s+-\s+/.exec(text.slice(index));
    if (hyphen) {
      if (comparator.trim()) return { ambiguous: true };
      index += hyphen[0].length;
      const upper = OPERAND.exec(text.slice(index));
      if (!upper) return { ambiguous: true };
      index += upper[0].length;
    }
    complete = true;
  }
}

// Read a package before its qualifier. Comparators and spaces belong to the
// qualifier; complete operand classification distinguishes pnpm ancestry.
function target(key) {
  // An ambiguous terminal retains the last design identity and still requires its stable URL.
  const names = [...key.matchAll(/@yesid\/[a-z0-9._-]+/g)].map(match => match[0]).filter(design);
  let rest = key;
  let name;
  let selector = false;
  while (rest) {
    if (rest.startsWith('**/')) {
      selector = true;
      rest = rest.slice(3);
      continue;
    }
    const match = /^(?:@[^/\s>@]+\/)?[a-zA-Z0-9._*-]+/.exec(rest);
    if (!match) return { name: names.at(-1), selector: true, ambiguous: names.length > 0 };
    name = match[0];
    rest = rest.slice(name.length).trimStart();
    if (rest.startsWith('@')) {
      rest = rest.slice(1);
      const boundary = qualifierBoundary(rest);
      if (boundary.ambiguous) return { name: names.at(-1), selector: true, ambiguous: names.length > 0 };
      rest = boundary.index < 0 ? '' : rest.slice(boundary.index);
    }
    if (!rest) return { name, selector };
    if (rest[0] !== '/' && rest[0] !== '>') {
      return { name: names.at(-1), selector: true, ambiguous: names.length > 0 };
    }
    selector = true;
    rest = rest.slice(1).trimStart();
    if (!rest) return { name: names.at(-1), selector: true, ambiguous: names.length > 0 };
  }
  return { name, selector };
}

function containsDownload(value) {
  if (typeof value === 'string') return value.includes('yesid.design/releases/download/');
  if (Array.isArray(value)) return value.some(containsDownload);
  return object(value) && Object.values(value).some(containsDownload);
}

/** Pure checker: repository-relative paths mapped to JSON text; returns diagnostics. */
export function checkManifests(manifests) {
  const failures = [];
  const versions = new Map();
  const fail = message => failures.push(message + '. ' + REHEARSAL);
  function entries(values, field, file, containers, inherited) {
    if (!object(values)) throw new Error(field + ': expected a dependency object');
    for (const [key, value] of Object.entries(values)) {
      const identity = key === '.' && containers ? inherited : target(key);
      const name = identity?.name;
      if (key === '.' && containers && !inherited) throw new Error(field + ': dot override has no parent selector');
      const location = file + ': ' + field + ', key ' + JSON.stringify(key) + ', value ' + JSON.stringify(value);
      if (object(value) && containers) {
        if (design(name) && !Object.keys(value).length) fail(location + ': empty design override');
        entries(value, field + '[' + JSON.stringify(key) + ']', file, true, identity);
        continue;
      }
      const alias = typeof value === 'string' && /^npm:(@[^/]+\/[^@]+)(?:@|$)/.exec(value);
      if (!design(name) && !design(alias?.[1]) && !containsDownload(value)) continue;
      const match = typeof value === 'string' ? RELEASE.exec(value) : null;
      const selector = identity?.selector;
      const expected = design(name) || containers || field === 'resolutions' || selector ? name : match && '@yesid/' + match[2];
      if (!match || match[0] !== value || !PACKAGES.has(match[2]) || expected !== '@yesid/' + match[2] || design(alias?.[1])) {
        const reason = design(alias?.[1]) ? 'npm aliases to design packages are forbidden'
          : typeof value !== 'string' ? 'non-string design value'
          : !match || match[0] !== value ? 'non-exact stable URL'
          : !PACKAGES.has(match[2]) ? 'unknown design package'
          : 'package identity mismatch';
        fail(location + ': ' + reason + '; expected an exact stable release tarball URL matching the terminal package');
      } else {
        if (!versions.has(match[1])) versions.set(match[1], []);
        versions.get(match[1]).push(location);
      }
    }
  }
  for (const [file, text] of Object.entries(manifests)) {
    try {
      const manifest = JSON.parse(text);
      if (!object(manifest)) throw new Error('expected a manifest object');
      for (const field of FIELDS) {
        if (Object.hasOwn(manifest, field)) entries(manifest[field], field, file, field === 'overrides');
      }
      if (Object.hasOwn(manifest, 'pnpm')) {
        if (!object(manifest.pnpm)) throw new Error('pnpm: expected an object');
        if (Object.hasOwn(manifest.pnpm, 'overrides')) entries(manifest.pnpm.overrides, 'pnpm.overrides', file, true);
      }
    } catch (error) {
      fail(file + ': cannot parse or check manifest: ' + error.message);
    }
  }
  if (versions.size > 1) fail('Design releases must use one stable version in lockstep:\n' + [...versions.values()].flat().join('\n'));
  return failures;
}

function canonical(path) {
  const real = realpathSync.native(path);
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Audit tracked manifests only. Reject tracked links and submodules rather than skip them. */
export function checkRepository(root = process.cwd()) {
  try {
    root = resolve(root);
    if (canonical(git(root, ['rev-parse', '--show-toplevel']).trim()) !== canonical(root)) throw new Error('repoRoot must be the Git repository root');
    const records = git(root, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean);
    const manifests = {};
    for (const record of records) {
      const match = /^(\d+) [a-f0-9]+ (\d)\t([\s\S]+)$/.exec(record);
      if (!match || match[2] !== '0') throw new Error('invalid or unmerged git index entry');
      const [, mode, , file] = match;
      if (mode === '120000') throw new Error(file + ': tracked symlink rejected');
      if (mode === '160000') throw new Error(file + ': submodule manifests cannot be audited');
      if (file.split('/').at(-1) !== 'package.json') continue;
      const path = resolve(root, file);
      if (!path.startsWith(root + sep)) throw new Error(file + ': path escapes repository');
      let cursor = root;
      for (const part of file.split('/')) {
        cursor = join(cursor, part);
        if (lstatSync(cursor).isSymbolicLink()) throw new Error(file + ': symlink rejected');
      }
      manifests[file] = readFileSync(path, 'utf8');
    }
    return checkManifests(manifests);
  } catch (error) {
    return ['Cannot discover or read tracked manifests: ' + error.message + '. ' + REHEARSAL];
  }
}

function safePath(root, file) {
  const path = resolve(root, file);
  if (!path.startsWith(root + sep)) throw new Error('case path escapes temporary repository');
  return path;
}

function discoveryCase(test) {
  const root = mkdtempSync(join(tmpdir(), 'design-guard-'));
  try {
    git(root, ['init', '--quiet']);
    for (const [file, text] of Object.entries(test.manifests)) {
      const path = safePath(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
    for (const file of test.tree.directories ?? []) mkdirSync(safePath(root, file), { recursive: true });
    git(root, ['add', '--all']);
    for (const link of test.tree.links ?? []) {
      const path = safePath(root, link.path);
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(safePath(root, link.target), path, 'junction');
      // Model a tracked link explicitly: Git does not stage Windows junctions as symlinks.
      const hash = git(root, ['hash-object', '-w', '--stdin']).trim();
      git(root, ['update-index', '--add', '--cacheinfo', '120000,' + hash + ',' + link.path]);
    }
    for (const link of test.tree.componentLinks ?? []) {
      const path = safePath(root, link.path);
      rmSync(path, { recursive: true, force: true });
      symlinkSync(safePath(root, link.target), path, 'junction');
    }
    for (const file of test.tree.gitlinks ?? []) {
      git(root, ['update-index', '--add', '--cacheinfo', '160000,' + '1'.repeat(40) + ',' + file]);
    }
    if (test.tree.worktree) {
      git(root, ['-c', 'user.name=Guard Test', '-c', 'user.email=guard@example.test', 'commit', '--quiet', '--no-gpg-sign', '-m', 'fixture']);
      const worktree = safePath(root, 'linked-worktree');
      git(root, ['worktree', 'add', '--quiet', '--detach', worktree]);
      return checkRepository(worktree);
    }
    for (const file of test.tree.remove ?? []) unlinkSync(safePath(root, file));
    for (const file of test.tree.untracked ?? []) writeFileSync(safePath(root, file), '{');
    if (test.tree.noGit) rmSync(join(root, '.git'), { recursive: true, force: true });
    let checkRoot = test.tree.missingRoot ? join(root, 'missing') : root;
    if (test.tree.subdirectory) checkRoot = safePath(root, test.tree.subdirectory);
    if (test.tree.uppercaseRoot) checkRoot = checkRoot.toUpperCase();
    return checkRepository(checkRoot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function selfTest(casesPath = fileURLToPath(new URL('./design-prerelease-guard.cases.json', import.meta.url))) {
  const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
  if (!Array.isArray(cases) || !cases.length) throw new Error('expected a nonempty case table');
  const mismatches = [];
  let skipped = 0;
  for (const test of cases) {
    if (test.platform && test.platform !== process.platform) {
      skipped++;
      process.stdout.write('SKIP ' + test.name + ': applies only to ' + test.platform + '\n');
      continue;
    }
    const errors = test.tree ? discoveryCase(test) : checkManifests(test.manifests);
    if ((errors.length === 0) !== test.pass || !(test.messages ?? []).every(fragment => errors.join('\n').includes(fragment))) {
      mismatches.push(test.name + ': expected ' + (test.pass ? 'pass' : 'fail') + '; received ' + JSON.stringify(errors));
    }
  }
  if (mismatches.length) throw new Error(mismatches.join('\n'));
  return cases.length - skipped;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === '--self-test') process.stdout.write('Passed ' + selfTest(process.argv[3]) + ' shared cases\n');
    else {
      const errors = checkRepository(process.argv[2]);
      process.stdout.write(errors.length ? errors.join('\n') + '\n' : 'Design dependencies use one exact stable release\n');
      process.exitCode = errors.length ? 1 : 0;
    }
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
