import fs from 'node:fs';
import path from 'node:path';

type Target = 'ts' | 'rust';

type SchemaFile = {
    types?: TypeDefinition[];
    commands?: CommandDefinition[];
    sidecarCommandExclusions?: string[];
};

type TypeDefinition = AliasDefinition | InterfaceDefinition | StringEnumDefinition | TaggedUnionDefinition;

type AliasDefinition = {
    kind: 'alias';
    name: string;
    type?: string;
    tsType?: string;
    rustType?: string;
    targets?: Target[];
};

type InterfaceDefinition = {
    kind: 'interface';
    name: string;
    fields: FieldDefinition[];
    targets?: Target[];
};

type StringEnumDefinition = {
    kind: 'string-enum';
    name: string;
    values: string[];
    targets?: Target[];
};

type TaggedUnionDefinition = {
    kind: 'tagged-union';
    name: string;
    tag: string;
    variants: TaggedUnionVariant[];
    targets?: Target[];
};

type TaggedUnionVariant = {
    tagValue: string;
    rustName?: string;
    fields?: FieldDefinition[];
};

type FieldDefinition = {
    name: string;
    type?: string;
    optional?: boolean;
    tsType?: string;
    rustType?: string;
};

type CommandDefinition = {
    name: string;
    request: string;
    response: string;
};

type TypeNode =
    | { kind: 'primitive'; name: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'unknown' }
    | { kind: 'reference'; name: string }
    | { kind: 'array'; item: TypeNode }
    | { kind: 'record'; value: TypeNode }
    | { kind: 'union'; members: TypeNode[] };

const rootDir = path.resolve(__dirname, '..');
const schemaDir = path.join(rootDir, 'contracts', 'desktop');
const tsOutputPath = path.join(rootDir, 'src', 'desktop', 'contracts.ts');
const rustOutputPath = path.join(rootDir, 'src-tauri', 'src', 'contracts.rs');

function loadSchemaFiles(): SchemaFile[] {
    const files = fs
        .readdirSync(schemaDir)
        .filter((entry) => entry.endsWith('.schema.json'))
        .sort();
    return files.map((fileName) => {
        const filePath = path.join(schemaDir, fileName);
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SchemaFile;
    });
}

function shouldRender(targets: Target[] | undefined, target: Target): boolean {
    return !targets || targets.includes(target);
}

function splitTopLevel(value: string, delimiter: string): string[] {
    const parts: string[] = [];
    let depthAngle = 0;
    let depthParen = 0;
    let current = '';

    for (const character of value) {
        if (character === '<') {
            depthAngle += 1;
        } else if (character === '>') {
            depthAngle -= 1;
        } else if (character === '(') {
            depthParen += 1;
        } else if (character === ')') {
            depthParen -= 1;
        }

        if (character === delimiter && depthAngle === 0 && depthParen === 0) {
            parts.push(current.trim());
            current = '';
            continue;
        }

        current += character;
    }

    if (current.trim().length > 0) {
        parts.push(current.trim());
    }

    return parts;
}

function unwrapParens(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        return trimmed.slice(1, -1).trim();
    }

    return trimmed;
}

function parseType(spec: string): TypeNode {
    const normalized = unwrapParens(spec);
    const unionParts = splitTopLevel(normalized, '|');
    if (unionParts.length > 1) {
        return {
            kind: 'union',
            members: unionParts.map((part) => parseType(part)),
        };
    }

    const recordMatch = normalized.match(/^Record<string,\s*(.+)>$/);
    if (recordMatch) {
        return {
            kind: 'record',
            value: parseType(recordMatch[1]),
        };
    }

    if (normalized.endsWith('[]')) {
        return {
            kind: 'array',
            item: parseType(normalized.slice(0, -2)),
        };
    }

    switch (normalized) {
        case 'string':
        case 'number':
        case 'integer':
        case 'boolean':
        case 'null':
        case 'unknown':
            return { kind: 'primitive', name: normalized };
        default:
            return { kind: 'reference', name: normalized };
    }
}

function renderTsType(node: TypeNode): string {
    switch (node.kind) {
        case 'primitive':
            if (node.name === 'integer') {
                return 'number';
            }
            return node.name;
        case 'reference':
            return node.name;
        case 'array':
            return `${renderTsType(node.item)}[]`;
        case 'record':
            return `Record<string, ${renderTsType(node.value)}>`;
        case 'union':
            return node.members.map((member) => renderTsType(member)).join(' | ');
    }
}

function renderRustType(node: TypeNode): string {
    switch (node.kind) {
        case 'primitive': {
            const primitiveName = String(node.name);
            switch (node.name) {
                case 'string':
                    return 'String';
                case 'number':
                    return 'f64';
                case 'integer':
                    return 'u32';
                case 'boolean':
                    return 'bool';
                case 'null':
                    return '()';
                case 'unknown':
                    return 'Value';
            }
            throw new Error(`Unsupported Rust primitive type '${primitiveName}'.`);
        }
        case 'reference':
            return node.name;
        case 'array':
            return `Vec<${renderRustType(node.item)}>`;
        case 'record':
            return `HashMap<String, ${renderRustType(node.value)}>`;
        case 'union': {
            const nonNullMembers = node.members.filter(
                (member) => !(member.kind === 'primitive' && member.name === 'null'),
            );
            if (nonNullMembers.length === 1 && nonNullMembers.length !== node.members.length) {
                return `Option<${renderRustType(nonNullMembers[0])}>`;
            }

            throw new Error(
                `Unsupported Rust union type '${renderTsType(node)}'. Use rustType overrides in the schema.`,
            );
        }
    }
}

function toPascalCase(value: string): string {
    return value
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function toSnakeCase(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[-\s]+/g, '_')
        .toLowerCase();
}

function renderTsInterface(definition: InterfaceDefinition): string {
    if (definition.fields.length === 0) {
        return `export interface ${definition.name} {}`;
    }

    const lines = definition.fields.map((field) => {
        const type = field.tsType ?? renderTsType(parseType(field.type ?? 'unknown'));
        return `    ${field.name}${field.optional ? '?' : ''}: ${type};`;
    });

    return [`export interface ${definition.name} {`, ...lines, '}'].join('\n');
}

function renderTsStringEnum(definition: StringEnumDefinition): string {
    return `export type ${definition.name} = ${definition.values.map((value) => `'${value}'`).join(' | ')};`;
}

function renderTsAlias(definition: AliasDefinition): string {
    const type = definition.tsType ?? renderTsType(parseType(definition.type ?? 'unknown'));
    return `export type ${definition.name} = ${type};`;
}

function renderTsTaggedUnion(definition: TaggedUnionDefinition): string {
    const variants = definition.variants.map((variant) => {
        const fields = variant.fields ?? [];
        const parts = [`${definition.tag}: '${variant.tagValue}'`];
        for (const field of fields) {
            const type = field.tsType ?? renderTsType(parseType(field.type ?? 'unknown'));
            parts.push(`${field.name}${field.optional ? '?' : ''}: ${type}`);
        }
        return `    | { ${parts.join('; ')} }`;
    });

    return [`export type ${definition.name} =`, ...variants, ';'].join('\n');
}

function renderTsOutput(schemaFiles: SchemaFile[]): string {
    const blocks: string[] = [];
    const commands = schemaFiles.flatMap((file) => file.commands ?? []);
    const sidecarCommandExclusions = schemaFiles.flatMap((file) => file.sidecarCommandExclusions ?? []);

    for (const schemaFile of schemaFiles) {
        for (const definition of schemaFile.types ?? []) {
            if (!shouldRender(definition.targets, 'ts')) {
                continue;
            }

            switch (definition.kind) {
                case 'interface':
                    blocks.push(renderTsInterface(definition));
                    break;
                case 'string-enum':
                    blocks.push(renderTsStringEnum(definition));
                    break;
                case 'alias':
                    blocks.push(renderTsAlias(definition));
                    break;
                case 'tagged-union':
                    blocks.push(renderTsTaggedUnion(definition));
                    break;
            }
        }
    }

    const commandMapLines = ['export interface DesktopCommandMap {'];
    for (const command of commands) {
        commandMapLines.push(`    ${command.name}: {`);
        commandMapLines.push(`        request: ${command.request};`);
        commandMapLines.push(`        response: ${command.response};`);
        commandMapLines.push('    };');
    }
    commandMapLines.push('}');
    blocks.push(commandMapLines.join('\n'));
    blocks.push('export type DesktopCommandName = keyof DesktopCommandMap;');
    if (sidecarCommandExclusions.length > 0) {
        blocks.push(
            [
                'export type SidecarCommandName = Exclude<',
                '    DesktopCommandName,',
                ...sidecarCommandExclusions.map(
                    (name, index, values) => `    | '${name}'${index === values.length - 1 ? '' : ''}`,
                ),
                '>;',
            ].join('\n'),
        );
    } else {
        blocks.push('export type SidecarCommandName = DesktopCommandName;');
    }
    blocks.push(
        [
            'export interface DesktopRpcRequest<K extends DesktopCommandName = DesktopCommandName> {',
            '    id: string;',
            '    command: K;',
            "    payload: DesktopCommandMap[K]['request'];",
            '}',
        ].join('\n'),
    );
    blocks.push(
        [
            'export type DesktopRpcSuccessResponse<K extends DesktopCommandName = DesktopCommandName> = {',
            "    type: 'response';",
            '    id: string;',
            '    ok: true;',
            "    result: DesktopCommandMap[K]['response'];",
            '};',
        ].join('\n'),
    );
    blocks.push(
        [
            'export interface DesktopRpcErrorResponse {',
            "    type: 'response';",
            '    id: string;',
            '    ok: false;',
            '    error: string;',
            '}',
        ].join('\n'),
    );
    blocks.push(
        [
            'export type DesktopRpcResponse<K extends DesktopCommandName = DesktopCommandName> =',
            '    | DesktopRpcSuccessResponse<K>',
            '    | DesktopRpcErrorResponse;',
        ].join('\n'),
    );
    blocks.push(
        ['export interface DesktopEventMessage {', "    type: 'event';", '    event: DesktopEvent;', '}'].join('\n'),
    );
    blocks.push('export type DesktopSidecarMessage = DesktopRpcResponse | DesktopEventMessage;');

    return (
        ['// Generated by scripts/generate-desktop-contracts.ts. Do not edit directly.', '', ...blocks].join('\n\n') +
        '\n'
    );
}

function renderRustField(field: FieldDefinition): string[] {
    const rustFieldName = toSnakeCase(field.name);
    const type = field.rustType ?? renderRustType(parseType(field.type ?? 'unknown'));
    const isOptional = field.optional || parseType(field.type ?? 'unknown').kind === 'union';
    const renderedType = field.rustType ? type : isOptional && !type.startsWith('Option<') ? `Option<${type}>` : type;

    return [`    pub ${rustFieldName}: ${renderedType},`];
}

function renderRustVariantField(field: FieldDefinition): string[] {
    const rustFieldName = toSnakeCase(field.name);
    const type = field.rustType ?? renderRustType(parseType(field.type ?? 'unknown'));
    const isOptional = field.optional || parseType(field.type ?? 'unknown').kind === 'union';
    const renderedType = field.rustType ? type : isOptional && !type.startsWith('Option<') ? `Option<${type}>` : type;

    return [`        ${rustFieldName}: ${renderedType},`];
}

function renderRustVariantFieldInline(field: FieldDefinition): string {
    const rustFieldName = toSnakeCase(field.name);
    const type = field.rustType ?? renderRustType(parseType(field.type ?? 'unknown'));
    const isOptional = field.optional || parseType(field.type ?? 'unknown').kind === 'union';
    const renderedType = field.rustType ? type : isOptional && !type.startsWith('Option<') ? `Option<${type}>` : type;

    return `${rustFieldName}: ${renderedType}`;
}

function renderRustInterface(definition: InterfaceDefinition): string {
    const lines = definition.fields.flatMap((field) => renderRustField(field));
    return [
        '#[derive(Clone, Debug, Serialize, Deserialize)]',
        '#[serde(rename_all = "camelCase")]',
        `pub struct ${definition.name} {`,
        ...lines,
        '}',
    ].join('\n');
}

function renderRustStringEnum(definition: StringEnumDefinition): string {
    const variants = definition.values.map((value) => {
        const rustName = toPascalCase(value);
        return `    #[serde(rename = "${value}")]\n    ${rustName},`;
    });
    return [
        '#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]',
        `pub enum ${definition.name} {`,
        ...variants,
        '}',
    ].join('\n');
}

function renderRustAlias(definition: AliasDefinition): string {
    const type = definition.rustType ?? renderRustType(parseType(definition.type ?? 'unknown'));
    return `pub type ${definition.name} = ${type};`;
}

function renderRustTaggedUnion(definition: TaggedUnionDefinition): string {
    const variants = definition.variants.map((variant) => {
        const rustName = variant.rustName ?? toPascalCase(variant.tagValue);
        const fields = variant.fields ?? [];
        if (fields.length === 0) {
            return `    #[serde(rename = "${variant.tagValue}")]\n    ${rustName},`;
        }
        if (fields.length === 1) {
            return [
                `    #[serde(rename = "${variant.tagValue}")]`,
                `    ${rustName} { ${renderRustVariantFieldInline(fields[0])} },`,
            ].join('\n');
        }

        const renderedFields = fields.flatMap((field) => renderRustVariantField(field));
        return [`    #[serde(rename = "${variant.tagValue}")]`, `    ${rustName} {`, ...renderedFields, '    },'].join(
            '\n',
        );
    });

    return [
        '#[derive(Clone, Debug, Serialize, Deserialize)]',
        `#[serde(tag = "${definition.tag}")]`,
        `pub enum ${definition.name} {`,
        ...variants,
        '}',
    ].join('\n');
}

function renderRustOutput(schemaFiles: SchemaFile[]): string {
    const blocks: string[] = [];

    for (const schemaFile of schemaFiles) {
        for (const definition of schemaFile.types ?? []) {
            if (!shouldRender(definition.targets, 'rust')) {
                continue;
            }

            switch (definition.kind) {
                case 'interface':
                    blocks.push(renderRustInterface(definition));
                    break;
                case 'string-enum':
                    blocks.push(renderRustStringEnum(definition));
                    break;
                case 'alias':
                    blocks.push(renderRustAlias(definition));
                    break;
                case 'tagged-union':
                    blocks.push(renderRustTaggedUnion(definition));
                    break;
            }
        }
    }

    return (
        [
            [
                '// Generated by scripts/generate-desktop-contracts.ts. Do not edit directly.',
                '#![allow(dead_code)]',
                '',
                'use serde::{Deserialize, Serialize};',
                'use serde_json::Value;',
                'use std::collections::HashMap;',
            ].join('\n'),
            ...blocks,
        ].join('\n\n') + '\n'
    );
}

export function generateDesktopContracts() {
    const schemaFiles = loadSchemaFiles();
    return {
        ts: renderTsOutput(schemaFiles),
        rust: renderRustOutput(schemaFiles),
    };
}

function writeIfChanged(filePath: string, contents: string) {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === contents) {
        return;
    }

    fs.writeFileSync(filePath, contents, 'utf8');
}

function main() {
    const args = new Set(process.argv.slice(2));
    const { ts, rust } = generateDesktopContracts();

    if (args.has('--check')) {
        const tsMatches = fs.existsSync(tsOutputPath) && fs.readFileSync(tsOutputPath, 'utf8') === ts;
        const rustMatches = fs.existsSync(rustOutputPath) && fs.readFileSync(rustOutputPath, 'utf8') === rust;
        if (!tsMatches || !rustMatches) {
            console.error('Desktop contract outputs are out of date. Run `bun run contracts:generate`.');
            process.exit(1);
        }
        return;
    }

    writeIfChanged(tsOutputPath, ts);
    writeIfChanged(rustOutputPath, rust);

    if (!args.has('--write')) {
        process.stdout.write(ts);
    }
}

if (require.main === module) {
    main();
}
