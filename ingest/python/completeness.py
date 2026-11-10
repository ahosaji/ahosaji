"""Machine-readable extraction completeness without altering extracted text."""
from __future__ import annotations
import json
import sys
from datetime import datetime, timezone

def book_manifest(book: str, chapters: dict, expected_count: int, failures: list[dict] | None = None) -> dict:
    expected = list(range(1, expected_count + 1))
    succeeded = sorted(int(key) for key, chapter in chapters.items() if chapter.get('verses'))
    missing = [number for number in expected if number not in succeeded]
    return {'kind': 'chapters', 'book': book, 'expected': expected, 'succeeded': succeeded,
            'missing': missing, 'failed': failures or [], 'complete': not missing and not failures,
            'finishedAt': datetime.now(timezone.utc).isoformat()}

def completeness_exit_code(manifest: dict, allow_partial: bool = False) -> int:
    return 0 if manifest['complete'] or allow_partial else 1

def emit_manifest(manifest: dict) -> None:
    print('COMPLETENESS_MANIFEST ' + json.dumps(manifest, ensure_ascii=False), file=sys.stderr)

def write_book_snapshot(path, book: str, chapters: dict, expected_count: int, *, allow_partial: bool = False, failures: list[dict] | None = None) -> int:
    """Never replace an existing snapshot with failed output by default; writes are atomic."""
    import os
    import tempfile
    from pathlib import Path
    path = Path(path)
    nonempty = {str(key): chapter for key, chapter in chapters.items() if chapter.get('verses')}
    manifest = book_manifest(book, nonempty, expected_count, failures)
    emit_manifest(manifest)
    code = completeness_exit_code(manifest, allow_partial)
    if code or not nonempty:
        return code
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, prefix=path.name + '.', suffix='.tmp', delete=False) as handle:
            temporary = handle.name
            json.dump({'usfm': book, 'source': 'deutero', 'chapters': nonempty, '_completeness': manifest}, handle, ensure_ascii=False, indent=2)
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary): os.unlink(temporary)
    return code

def open_pdf_or_report(opener, path: str, books: dict[str, int], *, allow_partial: bool = False, output_json: bool = False):
    """Every bulk entrypoint reports PDF-open failures before chapter extraction begins."""
    try:
        return opener(path)
    except Exception as error:
        manifests = [book_manifest(book, {}, count, [{'chapter': None, 'error': str(error)}]) for book, count in books.items()]
        for manifest in manifests:
            emit_manifest(manifest)
        if output_json:
            # Stdout-based extractors each process one book; retain their REST-sidecar shape.
            manifest = manifests[0]
            json.dump({'usfm': manifest['book'], 'source': 'deutero', 'chapters': {}, '_completeness': manifest}, sys.stdout)
        raise SystemExit(max(completeness_exit_code(manifest, allow_partial) for manifest in manifests))
