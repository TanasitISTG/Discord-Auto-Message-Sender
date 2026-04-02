import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const repoRoot = process.cwd();
const sourceRoots = [path.join(repoRoot, 'src'), path.join(repoRoot, 'app', 'src')];
const sourceExtensions = new Set(['.ts', '.tsx']);

interface DependencyRecord {
    importer: string;
    specifier: string;
    target: string;
}

interface Violation {
    rule: string;
    importer: string;
    specifier: string;
    target: string;
}

function toRepoPath(filePath: string) {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function isSourceFile(filePath: string) {
    return sourceExtensions.has(path.extname(filePath)) && !filePath.endsWith('.d.ts');
}

function walk(directory: string, files: string[] = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, files);
            continue;
        }
        if (isSourceFile(fullPath)) {
            files.push(fullPath);
        }
    }
    return files;
}

function resolveInternalSpecifier(importer: string, specifier: string) {
    let basePath: string | null = null;
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
        basePath = path.resolve(path.dirname(importer), specifier);
    } else if (specifier.startsWith('@/')) {
        basePath = path.join(repoRoot, 'app', 'src', specifier.slice(2));
    } else if (specifier.startsWith('src/')) {
        basePath = path.join(repoRoot, specifier);
    } else if (specifier.startsWith('app/src/')) {
        basePath = path.join(repoRoot, specifier);
    }

    if (!basePath) {
        return null;
    }

    const candidates = [
        basePath,
        ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.json'].map((extension) => `${basePath}${extension}`),
        ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((fileName) => path.join(basePath, fileName)),
    ];
    const resolved = candidates.find((candidate) => fs.existsSync(candidate));
    return toRepoPath(resolved ?? basePath);
}

function collectDependencies(filePath: string) {
    const source = fs.readFileSync(filePath, 'utf8');
    const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
    const dependencies: DependencyRecord[] = [];

    function record(specifier: string) {
        const target = resolveInternalSpecifier(filePath, specifier);
        if (!target) {
            return;
        }
        dependencies.push({
            importer: toRepoPath(filePath),
            specifier,
            target,
        });
    }

    function visit(node: ts.Node): void {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            record(node.moduleSpecifier.text);
        }

        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length === 1 &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            record(node.arguments[0].text);
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return dependencies;
}

function isViolation(dependency: DependencyRecord): Violation | null {
    const { importer, specifier, target } = dependency;

    if (
        importer.startsWith('src/domain/') &&
        (target.startsWith('src/application/') ||
            target.startsWith('src/infrastructure/') ||
            target.startsWith('src/desktop/') ||
            target.startsWith('app/src/'))
    ) {
        return {
            rule: 'domain-no-upward-deps',
            importer,
            specifier,
            target,
        };
    }

    if (importer.startsWith('src/infrastructure/') && target.startsWith('app/src/')) {
        return {
            rule: 'infrastructure-no-app-imports',
            importer,
            specifier,
            target,
        };
    }

    if (importer.startsWith('app/src/') && target.startsWith('src/')) {
        const allowedImporter = 'app/src/lib/desktop.ts';
        const allowedTarget = 'src/desktop/contracts.ts';
        if (!(importer === allowedImporter && target === allowedTarget)) {
            return {
                rule: 'app-no-direct-src-imports',
                importer,
                specifier,
                target,
            };
        }
    }

    return null;
}

const dependencies = sourceRoots
    .flatMap((directory) => walk(directory))
    .flatMap((filePath) => collectDependencies(filePath));
const violations = dependencies
    .map((dependency) => isViolation(dependency))
    .filter((violation): violation is Violation => violation !== null);

if (violations.length > 0) {
    console.error('Boundary violations found:');
    for (const violation of violations) {
        console.error(`- [${violation.rule}] ${violation.importer} -> ${violation.specifier} (${violation.target})`);
    }
    process.exit(1);
}

console.log(`Boundary check passed for ${dependencies.length} internal imports.`);
