import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from source_pdf import resolve_pdf_path
from completeness import book_manifest, completeness_exit_code

class ConfigurationTests(unittest.TestCase):
    def test_precedence_and_legacy_alias(self):
        with tempfile.TemporaryDirectory() as directory:
            one = Path(directory) / 'one.pdf'; one.touch()
            two = Path(directory) / 'two.pdf'; two.touch()
            env = {'SOURCE_PDF_PATH': str(one), 'English_PDF_PATH': str(two)}
            self.assertEqual(resolve_pdf_path(None, env), str(one))
            self.assertEqual(resolve_pdf_path(str(two), env), str(two))
            self.assertEqual(resolve_pdf_path(None, {'English_PDF_PATH': str(two)}), str(two))
    def test_missing_and_nonexistent_paths_fail_clearly(self):
        with self.assertRaisesRegex(ValueError, 'SOURCE_PDF_PATH'): resolve_pdf_path(None, {})
        with self.assertRaisesRegex(ValueError, 'not a file'): resolve_pdf_path('/does-not-exist.pdf', {})
    def test_completeness_keeps_failed_chapter_information(self):
        manifest = book_manifest('TOB', {'1': {'verses': [1]}}, 3, [{'chapter': 2, 'error': 'extraction failed'}])
        self.assertFalse(manifest['complete'])
        self.assertEqual(manifest['missing'], [2, 3])
        self.assertEqual(manifest['failed'][0]['error'], 'extraction failed')
        self.assertEqual(completeness_exit_code(manifest), 1)
        self.assertEqual(completeness_exit_code(manifest, True), 0)


class BulkExtractorTests(unittest.TestCase):
    def test_real_bulk_main_reports_chapter_failures_and_default_nonzero(self):
        import contextlib
        import importlib
        import io
        import json
        import types
        from unittest.mock import patch
        fake_pdf = types.SimpleNamespace(Document=object, LINK_GOTO=1, LINK_URI=2, open=lambda path: object())
        with patch.dict(sys.modules, {'pymupdf': fake_pdf}):
            module = importlib.import_module('scrape_deutero_book')
            with tempfile.NamedTemporaryFile(suffix='.pdf') as pdf:
                for allow in [False, True]:
                    argv = ['scrape', '--pdf', pdf.name, '--usfm', 'TOB', '--max-chapters', '3'] + (['--allow-partial'] if allow else [])
                    stdout = io.StringIO(); stderr = io.StringIO()
                    with patch.object(sys, 'argv', argv), patch.object(module, 'chapter_starts_for_book', return_value=[1,2,3]), patch.object(module, 'extract_chapter', side_effect=[{'verses': [1]}, RuntimeError('page damaged'), {'verses': []}]), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                        with self.assertRaises(SystemExit) as exited: module.main()
                    self.assertEqual(exited.exception.code, 0 if allow else 1)
                    manifest = json.loads(stdout.getvalue())['_completeness']
                    self.assertEqual(manifest['missing'], [2,3])
                    self.assertEqual(manifest['failed'][0], {'chapter': 2, 'error': 'page damaged'})
                    self.assertIn('COMPLETENESS_MANIFEST', stderr.getvalue())

class SnapshotPublicationTests(unittest.TestCase):
    def test_incomplete_extraction_preserves_existing_snapshot_until_partial_is_explicit(self):
        import contextlib
        import io
        import json
        from completeness import write_book_snapshot
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'TOB.json'; path.write_text('existing snapshot')
            with contextlib.redirect_stderr(io.StringIO()):
                code = write_book_snapshot(path, 'TOB', {'1': {'verses': [1]}}, 2)
                self.assertEqual(code, 1); self.assertEqual(path.read_text(), 'existing snapshot')
                self.assertEqual(write_book_snapshot(path, 'TOB', {'1': {'verses': [1]}}, 2, allow_partial=True), 0)
            self.assertEqual(json.loads(path.read_text())['_completeness']['missing'], [2])


class PdfFailureManifestTests(unittest.TestCase):
    def test_bulk_pdf_open_failure_still_emits_a_structured_manifest(self):
        import contextlib
        import importlib
        import io
        import json
        from unittest.mock import patch
        import types
        with patch.dict(sys.modules, {'pymupdf': types.SimpleNamespace(Document=object, LINK_GOTO=1, LINK_URI=2, open=lambda path: object())}):
            module = importlib.import_module('scrape_deutero_book')
        with tempfile.NamedTemporaryFile(suffix='.pdf') as pdf:
            stdout = io.StringIO(); stderr = io.StringIO()
            with patch.object(sys, 'argv', ['scrape', '--pdf', pdf.name, '--usfm', 'TOB', '--max-chapters', '2']), patch.object(module.pymupdf, 'open', side_effect=RuntimeError('invalid PDF')), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                with self.assertRaises(SystemExit) as exited: module.main()
            self.assertEqual(exited.exception.code, 1)
            self.assertEqual(json.loads(stdout.getvalue())['_completeness']['failed'][0]['error'], 'invalid PDF')

if __name__ == '__main__': unittest.main()
