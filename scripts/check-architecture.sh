#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! "$PYTHON_BIN" --version >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi
if ! "$PYTHON_BIN" --version >/dev/null 2>&1; then
  echo "Python 3 is required to run architecture checks." >&2
  exit 1
fi

"$PYTHON_BIN" - <<'PY'
from __future__ import annotations

from pathlib import Path
from collections import Counter
import csv
import json
import os
import re
import sys

extra_python_path = os.environ.get('ARCHITECTURE_PYTHONPATH')
if extra_python_path:
    sys.path.insert(0, extra_python_path)

root = Path.cwd()
ignored_directories = {
    '.git',
    '.next',
    '.turbo',
    'coverage',
    'dist',
    'generated',
    'node_modules',
    'reports',
}

def is_repository_source(path: Path) -> bool:
    relative = path.relative_to(root)
    return relative.as_posix() != '.env' and not any(
        part in ignored_directories for part in relative.parts
    )

required = [
    'README.md', 'CODEX_START_HERE.md', 'AGENTS.md', 'ARCHITECTURE_BOOK.md',
    'VALIDATION_REPORT.md', 'DELIVERY_MANIFEST.md',
    'openapi/openapi.yaml', 'packages/database/prisma/schema.prisma',
    'packages/database/prisma/migrations/0000_extensions/migration.sql',
    'packages/database/prisma/sql/post_schema_constraints.sql',
    'tasks/BACKLOG.csv', 'docs/homepage-concept.png', 'docker-compose.yml'
]
for rel in required:
    if not (root / rel).is_file():
        raise SystemExit(f'MISSING required file: {rel}')

# JSON syntax and optional JSON Schema meta-validation.
json_paths = sorted(path for path in root.rglob('*.json') if is_repository_source(path))
json_docs: dict[Path, object] = {}
for path in json_paths:
    json_docs[path] = json.loads(path.read_text(encoding='utf-8-sig'))
try:
    from jsonschema.validators import validator_for
except ImportError:
    validator_for = None
if validator_for:
    for path, doc in json_docs.items():
        if path.parent == root / 'schemas' and isinstance(doc, dict) and '$schema' in doc:
            validator_for(doc).check_schema(doc)

# YAML: parse all files and reject duplicate mapping keys when PyYAML is available.
yaml_docs: dict[Path, object] = {}
try:
    import yaml
except ImportError:
    yaml = None
if yaml:
    class UniqueKeyLoader(yaml.SafeLoader):
        pass

    def construct_unique_mapping(loader, node, deep=False):
        mapping = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=deep)
            if key in mapping:
                mark = key_node.start_mark
                raise ValueError(f'duplicate YAML key {key!r} at line {mark.line + 1}')
            mapping[key] = loader.construct_object(value_node, deep=deep)
        return mapping

    UniqueKeyLoader.add_constructor(
        yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
        construct_unique_mapping,
    )
    yaml_paths = [
        path
        for path in list(root.rglob('*.yaml')) + list(root.rglob('*.yml'))
        if is_repository_source(path)
    ]
    for path in sorted(yaml_paths):
        yaml_docs[path] = yaml.load(path.read_text(encoding='utf-8'), Loader=UniqueKeyLoader)

# OpenAPI structural checks. Full checks run when YAML parsing is available.
openapi_path = root / 'openapi/openapi.yaml'
openapi_text = openapi_path.read_text(encoding='utf-8')
if not re.search(r'^openapi:\s*["\']?3\.1', openapi_text, re.M):
    raise SystemExit('OpenAPI must be 3.1.x')
if len(re.findall(r'^  /', openapi_text, re.M)) < 20:
    raise SystemExit('OpenAPI path set looks incomplete')
openapi = yaml_docs.get(openapi_path)
openapi_path_count = len(re.findall(r'^  /', openapi_text, re.M))
openapi_schema_count = 0
inside_schema_components = False
for line in openapi_text.splitlines():
    if line == '  schemas:':
        inside_schema_components = True
        continue
    if inside_schema_components and line.startswith('  ') and not line.startswith('    '):
        break
    if inside_schema_components and re.fullmatch(r'    [A-Za-z][A-Za-z0-9]+:', line):
        openapi_schema_count += 1
if isinstance(openapi, dict):
    if openapi.get('openapi', '').split('.')[:2] != ['3', '1']:
        raise SystemExit('Parsed OpenAPI version must be 3.1.x')
    paths = openapi.get('paths')
    components = openapi.get('components', {})
    if not isinstance(paths, dict) or len(paths) < 20:
        raise SystemExit('OpenAPI paths missing or incomplete')
    schemas = components.get('schemas', {})
    if not isinstance(schemas, dict) or len(schemas) < 20:
        raise SystemExit('OpenAPI schemas missing or incomplete')
    openapi_path_count = len(paths)
    openapi_schema_count = len(schemas)

    refs: list[tuple[str, str]] = []
    operation_ids: list[str] = []

    def walk(value, location='$'):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == '$ref' and isinstance(child, str):
                    refs.append((location, child))
                if key == 'operationId' and isinstance(child, str):
                    operation_ids.append(child)
                walk(child, f'{location}/{key}')
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, f'{location}/{index}')

    walk(openapi)
    duplicate_ops = [name for name, count in Counter(operation_ids).items() if count > 1]
    if duplicate_ops:
        raise SystemExit(f'Duplicate OpenAPI operationId values: {duplicate_ops}')

    for location, ref in refs:
        if not ref.startswith('#/'):
            continue
        current = openapi
        try:
            for token in ref[2:].split('/'):
                token = token.replace('~1', '/').replace('~0', '~')
                current = current[token]
        except (KeyError, TypeError):
            raise SystemExit(f'Broken OpenAPI ref at {location}: {ref}')

    http_methods = {'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'}
    for route, path_item in paths.items():
        if not isinstance(path_item, dict):
            raise SystemExit(f'OpenAPI path item is not an object: {route}')
        placeholders = set(re.findall(r'\{([^}]+)\}', route))
        inherited = path_item.get('parameters', [])
        for method, operation in path_item.items():
            if method not in http_methods:
                continue
            if not isinstance(operation, dict):
                raise SystemExit(f'OpenAPI operation is not an object: {method.upper()} {route}')
            params = list(inherited) + list(operation.get('parameters', []))
            resolved = []
            for param in params:
                if isinstance(param, dict) and '$ref' in param:
                    current = openapi
                    for token in param['$ref'][2:].split('/'):
                        current = current[token.replace('~1', '/').replace('~0', '~')]
                    param = current
                resolved.append(param)
            path_params = {
                p.get('name'): p for p in resolved
                if isinstance(p, dict) and p.get('in') == 'path'
            }
            missing = placeholders - set(path_params)
            if missing:
                raise SystemExit(f'Missing path parameters for {method.upper()} {route}: {sorted(missing)}')
            for name, param in path_params.items():
                if param.get('required') is not True:
                    raise SystemExit(f'Path parameter must be required: {method.upper()} {route} {name}')

# Backlog shape, dependency existence and cycle detection.
backlog_path = root / 'tasks/BACKLOG.csv'
with backlog_path.open(encoding='utf-8-sig', newline='') as fh:
    reader = csv.DictReader(fh)
    rows = list(reader)
    fields = reader.fieldnames or []
required_columns = {'id', 'gate', 'epic', 'priority', 'title', 'dependencies', 'acceptance', 'references', 'status'}
missing_columns = required_columns - set(fields)
if missing_columns:
    raise SystemExit(f'Backlog missing columns: {sorted(missing_columns)}')
ids = [row['id'].strip() for row in rows]
if not rows or len(ids) != len(set(ids)):
    raise SystemExit('Backlog is empty or contains duplicate IDs')
known = set(ids)
graph: dict[str, list[str]] = {}
for row in rows:
    task_id = row['id'].strip()
    deps = [d.strip() for d in row['dependencies'].split(';') if d.strip()]
    graph[task_id] = deps
    for dep in deps:
        if dep not in known:
            raise SystemExit(f'Unknown dependency {dep} in {task_id}')
        if dep == task_id:
            raise SystemExit(f'Self dependency in {task_id}')

visiting: set[str] = set()
visited: set[str] = set()

def visit(task_id: str, trail: list[str]) -> None:
    if task_id in visiting:
        cycle_start = trail.index(task_id) if task_id in trail else 0
        raise SystemExit(f'Backlog dependency cycle: {" -> ".join(trail[cycle_start:] + [task_id])}')
    if task_id in visited:
        return
    visiting.add(task_id)
    for dep in graph[task_id]:
        visit(dep, trail + [task_id])
    visiting.remove(task_id)
    visited.add(task_id)

for task_id in ids:
    visit(task_id, [])

# Relative Markdown links.
link_re = re.compile(r'\[[^\]]*\]\(([^)]+)\)')
for path in (candidate for candidate in root.rglob('*.md') if is_repository_source(candidate)):
    text = path.read_text(encoding='utf-8')
    for target in link_re.findall(text):
        target = target.strip().split('#', 1)[0]
        if not target or '://' in target or target.startswith(('mailto:', 'tel:', 'data:')):
            continue
        target = target.split('?', 1)[0]
        if not (path.parent / target).resolve().exists():
            raise SystemExit(f'Broken link in {path.relative_to(root)}: {target}')

# Prisma structural checks: balanced blocks, unique declarations and unique fields.
schema_path = root / 'packages/database/prisma/schema.prisma'
schema = schema_path.read_text(encoding='utf-8')
if schema.count('{') != schema.count('}'):
    raise SystemExit('Prisma schema brace mismatch')
models = re.findall(r'^model\s+(\w+)\s*\{', schema, re.M)
enums = re.findall(r'^enum\s+(\w+)\s*\{', schema, re.M)
if len(models) != len(set(models)) or len(models) < 20:
    raise SystemExit('Prisma model set is duplicate or unexpectedly small')
if len(enums) != len(set(enums)):
    raise SystemExit('Duplicate Prisma enum names')

block_re = re.compile(r'^(model|enum)\s+(\w+)\s*\{\s*$(.*?)^\}', re.M | re.S)
for kind, name, body in block_re.findall(schema):
    names = []
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(('//', '@@')):
            continue
        token = line.split()[0]
        if token.startswith('@'):
            continue
        names.append(token)
    duplicates = [token for token, count in Counter(names).items() if count > 1]
    if duplicates:
        raise SystemExit(f'Duplicate {kind} members in {name}: {duplicates}')

bootstrap_sql = (root / 'packages/database/prisma/migrations/0000_extensions/migration.sql').read_text(encoding='utf-8')
if re.search(r'\b(?:ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|INSERT\s+INTO)\b', bootstrap_sql, re.I):
    raise SystemExit('0000_extensions must not reference application tables')

# Do not package secrets, generated dependency trees or unsafe symlinks. A local
# .env is expected after bootstrap, but it must remain ignored and outside scans.
if (root / '.env').exists():
    gitignore_entries = {
        line.strip()
        for line in (root / '.gitignore').read_text(encoding='utf-8').splitlines()
        if line.strip() and not line.lstrip().startswith('#')
    }
    if '.env' not in gitignore_entries and '/.env' not in gitignore_entries:
        raise SystemExit('Local .env exists but is not explicitly ignored')
for path in root.rglob('*'):
    if not is_repository_source(path):
        continue
    if path.is_symlink():
        raise SystemExit(f'Symlink not allowed in handoff package: {path.relative_to(root)}')
    if not path.is_file() or path.stat().st_size > 3_000_000:
        continue
    try:
        data = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        continue
    private_marker = '-----BEGIN ' + 'PRIVATE KEY-----'
    if private_marker in data or re.search(r'AKIA[0-9A-Z]{16}', data):
        raise SystemExit(f'Potential credential in {path.relative_to(root)}')

print(
    'Architecture checks passed: '
    f'{len(rows)} backlog tasks, {len(models)} Prisma models, '
    f'{openapi_path_count} OpenAPI paths, {openapi_schema_count} OpenAPI schemas, '
    f'{len(json_paths)} JSON files.'
)
if yaml is None:
    print('NOTE: PyYAML unavailable; full YAML/OpenAPI semantic checks were skipped.', file=sys.stderr)
if validator_for is None:
    print('NOTE: jsonschema unavailable; JSON Schema meta-validation was skipped.', file=sys.stderr)
PY
