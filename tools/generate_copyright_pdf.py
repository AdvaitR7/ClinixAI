#!/usr/bin/env python3
"""Build a security-gated, reproducible source deposit. Requires reportlab, pypdf, pdfplumber.

Run: python tools/generate_copyright_pdf.py
Install dependencies in an isolated environment with pip install reportlab pypdf pdfplumber.
Requires /usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf and
copyright-submission/fonts/NotoEmoji.ttf (Google Fonts ofl/notoemoji/NotoEmoji[wght].ttf).
Keep the font's accompanying OFL.txt license. No network requests are made by this script.
Source order is ascending repository-relative POSIX path; current working files are used.
"""
from pathlib import Path
import datetime
import hashlib
import itertools
import json
import re
import subprocess
import sys
from functools import lru_cache

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'copyright-submission'
SKIP = {'node_modules', '.next', '.git', 'dist', 'build', 'coverage', '__pycache__', 'meta', 'fixtures', 'test-results', 'playwright-report'}
# Reviewed synthetic gate fixtures (user confirmed 2026-10-26) and invalid-auth test.
# Hashes bind exceptions to exact lines; changed content requires a new review.
REVIEWED_SYNTHETIC = {
    '138225bdb78ee2fdb627192968325293e8158e96f79ec2373eace4ca589bdea7',  # apps/web/e2e/auth-lifecycle.spec.ts:13
    '921036761753da9dd4971b5431defa2936cb9da52faa7738163a8facecacd164',  # apps/web/e2e/checkin-workflows.spec.ts:79
    '98872a588a7f998e5e80c22c0e1fa4e78f0d991973ff3b2c90c8c037539f29fc',  # apps/web/e2e/checkin-workflows.spec.ts:80
    '3f2a85020c219ced422406aff355a9ef973db9ee7bdaf72dcf51614c84381ef9',  # apps/web/e2e/clinical-workflows.spec.ts:12
    'a12444d694797a46789e78d7174c32c0367db5b51de8ddc8217782e3d7a9b33c',  # apps/web/e2e/patient-records.spec.ts:29
    '98872a588a7f998e5e80c22c0e1fa4e78f0d991973ff3b2c90c8c037539f29fc',  # apps/web/e2e/patient-records.spec.ts:30
    'ac4bead7193f65af2ec835acda804c1ef21324e29c4cb531bcf8837ebd1c0dbd',  # apps/web/src/lib/auth.test.tsx:49
    '44f7fc26aaf5a106e81477d0d6b789c2d7ac22f6cd46f99a38a396e092743f49',
    '2ffe26059bcd7428d7246a7a3e492e6feba9cbecd98a4e63e605b2815348fc41',
    '281d71b188e0deeb3b9691016e88b719905728d86acdcd34a49ea03193921fd5',
    '3e2adb9965ab2f4e0f9b428168a843067dc0fb7ebcd2f2e853c8effb93e73483',
    '4b588b9ed6c1545a33672b07853677d58b7ffdfd4f7e01688552c94c243626ac',
    'a31a39b8449ab02a2769dfa3bed1939dcc623a5ccbb11121971a72955e25f50d',
    '9b02acdb207e91a9f3a50cfcd18674099eaa6d71b3f34862f9b881743502cd15',
    'e169e053e096bec14b0e7e968f3dd05e8c92d479ec31a7fbea77241ae1887f93',
    'fa3dd88bfa2ba7ee9fc9fa92f155395533500418a76e92579a707283f8cf7e48',
    'c1e1b34e5fc3da8540cc5b52856e0815bc4bb8ffbb12290b25f0dc5e235c4521',
    'b7c71a43b2c150e1168ddda1fb95a65207d04527d22c78d744f351bec4eb6b4f',
}
EXT = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs', '.css', '.sql'}


def git(*args):
    """Read repository metadata without changing the index or working tree."""
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def collect():
    """Inventory application roots, excluding dependencies and generated database migrations."""
    included, excluded = [], []
    for base in ('apps', 'services', 'packages', 'infra'):
        for p in (ROOT / base).rglob('*'):
            if not p.is_file() or any(part in SKIP for part in p.relative_to(ROOT).parts):
                continue
            rel = p.relative_to(ROOT).as_posix()
            if p.suffix not in EXT and rel != 'services/api/src/safety/rule_sets/emergency.json':
                continue
            reason = None
            if p.is_symlink() or p.name.startswith('.env') or p.name.endswith('.min.js'):
                reason = 'symlink, environment or minified file'
            elif p.name == 'next-env.d.ts':
                reason = 'Next.js generated declaration'
            elif '/drizzle/' in rel and not p.read_text().startswith('-- Custom SQL migration'):
                reason = 'Drizzle-generated migration (schema.ts is included)'
            elif re.search(r'@generated|auto-generated|automatically generated', p.read_text(), re.I):
                reason = 'generated-code marker; review before changing scope'
            if reason:
                excluded.append((rel, reason))
            else:
                included.append(p)
    return sorted(included, key=lambda p: p.relative_to(ROOT).as_posix()), sorted(excluded)


def scan(files):
    """Fail closed on credential and personal-data indicators; never output matched values."""
    findings = []
    for p in files:
        lines = p.read_text(encoding='utf-8').splitlines()
        for n, line in enumerate(lines, 1):
            rules = []
            if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bsk-[A-Za-z0-9_-]{20,}|\beyJ[\w-]{15,}\.[\w-]+\.|\bAIza[\w-]{35}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[baprs]-[A-Za-z0-9-]{15,}|\bsb_secret_[\w-]{15,}', line):
                rules.append('private key or token signature')
            for match in re.finditer(r'''(?<![\w/-])(?:password|secret|api[_-]?key|access[_-]?token|authorization|client[_-]?secret|refresh[_-]?token)["']?\s*(?::|=(?!=|>))\s*['"`]([^'"`]+)['"`]''', line, re.I):
                if match[1] != 'Bearer ${token}' and not re.fullmatch(r'(?:synthetic-password|(?:refreshed|next)-test-token)', match[1]):
                    rules.append('credential literal requiring review')
            if re.search(r'\w+://[^\s:/]+:[^\s@]+@', line):
                rules.append('connection string with password')
            for address in re.findall(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', line):
                if not address.endswith(('@example.test', '@example.com')):
                    rules.append('email requiring privacy review')
            if re.search(r'''(?:phone|mobile|aadhaar|aadhar|full_name|patient_name|date_of_birth|dob)\s*:\s*['"][^'"]+['"]''', line, re.I):
                # Only explicitly synthetic test fixtures are accepted; arbitrary names are blocked.
                if not (('.test.' in p.name or '.spec.' in p.name) and re.search(r'Synthetic|99990000(?:11|22)', line)):
                    rules.append('personal-data literal requiring review')
            if hashlib.sha256(line.encode()).hexdigest() not in REVIEWED_SYNTHETIC:
                findings.extend(f'{p.relative_to(ROOT)}:{n}: {rule}' for rule in sorted(set(rules)))
    return findings


def generate():
    """Scan, paginate all source, extract required pages, and verify text and geometry."""
    OUT.mkdir(exist_ok=True)
    final = OUT / 'CliniX_AI_Copyright_Source_Code.pdf'
    # Keep an earlier deposit clearly separate while a fresh snapshot is checked.
    if final.exists():
        final.replace(OUT / 'previous-deposit.pdf')
    files, excluded = collect()
    snapshots = {p: p.read_bytes() for p in files}
    findings = scan(files)
    manifest = OUT / 'CliniX_AI_Copyright_Manifest.md'
    if findings:
        manifest.write_text('# CliniX AI — Computer Software\n\nGeneration BLOCKED by security review. No source listing or deposit generated.\n\n' + '\n'.join('- ' + x for x in findings) + '\n\nMove real credentials into environment configuration and rotate exposed credentials. Remove confidential records from application source through an authorized correction; do not redact deposit pages. Review potential false positives before regeneration.\n')
        print('\n'.join(findings))
        return 2
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase import ttfonts
    from reportlab.pdfbase.ttfonts import TTFont
    from pypdf import PdfReader, PdfWriter
    import pdfplumber
    original_cmap = ttfonts.makeToUnicodeCMap

    def unicode_cmap(font_name, subset):
        """Encode supplementary Unicode characters as PDF UTF-16 surrogate pairs."""
        cmap = original_cmap(font_name, subset)
        for codepoint in subset:
            if codepoint > 0xFFFF:
                cmap = cmap.replace(f'<{codepoint:04X}>', '<' + chr(codepoint).encode('utf-16-be').hex().upper() + '>')
        return cmap

    # ReportLab 5.1 emits non-BMP codepoints directly instead of UTF-16 in CMaps.
    ttfonts.makeToUnicodeCMap = unicode_cmap
    font_path = Path('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')
    pdfmetrics.registerFont(TTFont('SourceMono', str(font_path)))
    font = pdfmetrics.getFont('SourceMono')
    emoji_font = OUT / 'fonts' / 'NotoEmoji.ttf'
    if not emoji_font.exists():
        raise RuntimeError('Install NotoEmoji[wght].ttf from google/fonts into copyright-submission/fonts/NotoEmoji.ttf; see script documentation.')
    pdfmetrics.registerFont(TTFont('SourceSymbols', str(emoji_font)))
    symbols = pdfmetrics.getFont('SourceSymbols')

    @lru_cache(maxsize=None)
    def face(c):
        """Preserve Unicode symbols using an embedded fallback instead of replacement boxes."""
        if ord(c) in font.face.charToGlyph:
            return 'SourceMono'
        if ord(c) in symbols.face.charToGlyph:
            return 'SourceSymbols'
        raise RuntimeError(f'Unsupported code point U+{ord(c):04X}; no substitution allowed')

    size, leading, margin = 8, 10.5, 36

    @lru_cache(maxsize=None)
    def advance(c):
        """Measure each glyph once using the same embedded face used to draw it."""
        return pdfmetrics.stringWidth(c, face(c), size)
    width, height = A4
    pages, rows = [], []
    inventory = []
    for p in files:
        text = snapshots[p].decode('utf-8')
        if len(rows) == 70:
            pages.append(rows)
            rows = []
        start = len(pages) + 1
        lines = ['SOURCE FILE: ' + p.relative_to(ROOT).as_posix(), *text.splitlines(), '']
        for line in lines:
            line = line.expandtabs(4)
            chunks = ['']
            used_width = 0
            for c in line:
                if used_width + advance(c) > width - 2 * margin:
                    chunks.append('')
                    used_width = 0
                chunks[-1] += c
                used_width += advance(c)
            for chunk in chunks:
                if len(rows) == 70:
                    pages.append(rows)
                    rows = []
                rows.append(chunk)
        inventory.append({'path': p.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(snapshots[p]).hexdigest(), 'lines': len(text.splitlines()), 'start_page': start, 'end_page': len(pages) + 1})
    if rows:
        pages.append(rows)
    commit = git('rev-parse', 'HEAD')
    complete = OUT / 'complete-source-listing.pdf'
    pdf = canvas.Canvas(str(complete), pagesize=A4, pageCompression=1, invariant=1)
    pdf.setTitle('CliniX AI - Complete Source Listing')
    for i, rows in enumerate(pages, 1):
        pdf.setFont('SourceMono', 7)
        pdf.drawString(margin, height - 24, 'CliniX AI | Source code | working-tree snapshot')
        pdf.drawString(margin, 22, f'Commit {commit[:12]} | Original page {i} of {len(pages)}')
        pdf.setFont('SourceMono', size)
        for j, row in enumerate(rows):
            text_object = pdf.beginText(margin, height - 48 - j * leading)
            for font_name, chars in itertools.groupby(row, key=face):
                run = ''.join(chars)
                text_object.setFont(font_name, size)
                text_object.textOut(run)
            pdf.drawText(text_object)
        pdf.showPage()
    pdf.save()
    selected = list(range(len(pages))) if len(pages) <= 20 else list(range(10)) + list(range(len(pages) - 10, len(pages)))
    source = PdfReader(complete)
    # Compare every rendered row to the planned listing, not just extracted pages.
    assert len(source.pages) == len(pages)
    for index, expected_rows in enumerate(pages):
        extracted = source.pages[index].extract_text().splitlines()
        expected = [row for row in expected_rows if row]
        if extracted[2:] != expected:
            pairs = itertools.zip_longest(extracted[2:], expected, fillvalue='')
            for row_index, (actual, planned) in enumerate(pairs):
                if actual != planned:
                    delta = next((k for k, (a, b) in enumerate(itertools.zip_longest(actual, planned)) if a != b), 0)
                    raise RuntimeError(f'Listing mismatch page {index + 1}, row {row_index + 1}, column {delta + 1}; actual/planned lengths {len(actual)}/{len(planned)}; codepoints {[hex(ord(c)) for c in actual[delta:delta+3]]}/{[hex(ord(c)) for c in planned[delta:delta+3]]}')
    writer = PdfWriter()
    for i in selected:
        writer.add_page(source.pages[i])
    writer.add_metadata({'/Title': 'CliniX AI - Copyright Source Code', '/Subject': f'Commit {commit}; original pages ' + ','.join(str(i+1) for i in selected)})
    temporary = OUT / 'validated-deposit.tmp.pdf'
    writer.write(temporary)
    result = PdfReader(temporary)
    assert len(result.pages) == len(selected)
    for j, i in enumerate(selected):
        assert result.pages[j].extract_text() == source.pages[i].extract_text()
        assert result.pages[j].extract_text().strip()
    with pdfplumber.open(temporary) as check:
        for page in check.pages:
            assert all(0 <= c['x0'] <= c['x1'] <= width + .1 and 0 <= c['top'] <= c['bottom'] <= height for c in page.chars)
    assert temporary.stat().st_size < 10_000_000
    assert all(p.read_bytes() == b for p, b in snapshots.items()), 'Source changed during generation'
    temporary.rename(final)
    (OUT / 'source-inventory.json').write_text(json.dumps(inventory, indent=2) + '\n')
    snapshot_hash = hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest()
    validation = {
        'complete_pages': len(pages),
        'selected_original_pages': [i + 1 for i in selected],
        'final_pages': len(result.pages),
        'final_bytes': final.stat().st_size,
        'final_sha256': hashlib.sha256(final.read_bytes()).hexdigest(),
        'inventory_sha256': snapshot_hash,
        'all_complete_listing_rows_verified': True,
        'selected_pages_match_complete_listing': True,
        'final_character_bounds_within_A4': True,
        'source_bytes_unchanged': True,
        'security_findings_unresolved': len(findings),
        'reviewed_synthetic_line_hashes': sorted(REVIEWED_SYNTHETIC),
    }
    (OUT / 'validation.json').write_text(json.dumps(validation, indent=2) + '\n')
    status = git('status', '--porcelain')
    manifest.write_text(f'''# CliniX AI Copyright Source Deposit

- Title of work: CliniX AI
- Work category: Computer Software
- Git commit: {commit}
- Generated: {datetime.datetime.now(datetime.timezone.utc).isoformat()}
- Snapshot: current working tree, including modified and untracked application source; not a clean commit export.
- Frontend: apps/web (Next.js/React)
- Backend: services/api (Fastify); services/worker
- Shared source: packages; database source: services/api/src/schema.ts, infra, custom SQL migrations
- Total source files: {len(files)}
- Total source lines (including blank/comment lines): {sum(x['lines'] for x in inventory)}
- Complete listing pages: {len(pages)}
- Original pages included: {', '.join(str(i+1) for i in selected)}
- Final page count: {len(selected)}
- Final size: {final.stat().st_size} bytes
- Final PDF SHA-256: {validation['final_sha256']}
- Source inventory SHA-256: {snapshot_hash}
- Security scan: PASS for implemented credential/PII patterns; reviewed synthetic test credentials and example.test/example.com identities are not live credentials. No redaction applied.
- Validation: reopened with pypdf; all extracted page text equals complete-listing originals; selectable text; all final character bounds within A4; under 10,000,000 bytes; source bytes unchanged during run.

## Scope and integrity

All source extensions {sorted(EXT)} in apps, services, packages, infra, plus the application emergency-rule JSON. Includes original tests, configuration code and worker logic. Stable ascending relative POSIX path order; no per-file page breaks. File headers are listing annotations. Code is unchanged except visual wrapping, four-column tab expansion and line-ending display; byte hashes preserve exact snapshot identity. Font: embedded DejaVu Sans Mono with monochrome Noto Emoji for three unsupported symbols, 8 pt, 10.5 pt leading, A4, 36 pt margins. No cover page. A local CMap compatibility correction preserves selectable supplementary Unicode characters with ReportLab 5.1.

Excluded dependencies, builds, generated declarations/migrations/snapshots, fixtures, documents, secrets/environment files, caches, assets, lockfiles, and non-source data. The deposit-generation tool itself is outside the registered application scope. Generated migrations are represented by the original schema source; custom SQL is included. No third-party source markers were identified in selected files; authorship and ownership cannot be proven by automated inspection.

Automated pattern scanning cannot certify absence of every possible secret or identify every real person. User confirmed gate-phase5 and gate-tmp fixture provenance as entirely synthetic on 2026-10-26; reviewed exceptions are bound to exact line hashes. Original test data reviewed as synthetic; no actual patient records identified. Portal acceptance and ownership are not certified. Existing working changes are recorded below and in per-file SHA-256 inventory. Complete listing is local review material, not the upload PDF.

Legal source: https://copyright.gov.in/Copyright_Rules_2013/chapter_XIII.html (Rule 70(5)); https://www.copyright.gov.in/Documents/Notification/Copyright-Rules_Amendment_2021.pdf .

## Reproduction

Run `/tmp/clinix-copyright-venv/bin/python tools/generate_copyright_pdf.py` in this environment. Elsewhere create an isolated Python environment, install reportlab, pypdf and pdfplumber, and retain DejaVu Sans Mono at its system path plus `copyright-submission/fonts/NotoEmoji.ttf` and its OFL license. The Noto font is from https://github.com/google/fonts/tree/main/ofl/notoemoji . The script has no network calls. A previous deposit is renamed to `previous-deposit.pdf` before a fresh scan; only the specifically named final PDF is for upload. Per-file hashes and page spans are in `source-inventory.json`; machine-readable checks and reviewed synthetic line hashes are in `validation.json`.

## Specifically excluded source candidates

''' + '\n'.join(f'- {p}: {why}' for p, why in excluded) + '\n\n## Working-tree status at generation\n\n```text\n' + status + '\n```\n')
    print(json.dumps({'files': len(files), 'lines': sum(x['lines'] for x in inventory), 'complete_pages': len(pages), 'deposit_pages': len(selected), 'bytes': final.stat().st_size}))
    return 0


if __name__ == '__main__':
    sys.exit(generate())
