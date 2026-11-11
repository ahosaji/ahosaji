"""Exercise every actual bulk main with the same corrupt-PDF failure boundary."""
import contextlib
import importlib
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))

class EveryBulkExtractorFailureTests(unittest.TestCase):
    def test_corrupt_existing_pdf_emits_failed_manifest_and_nonzero_for_every_bulk_main(self):
        extractors = [
            ('scrape_deutero_book', ['--usfm', 'TOB', '--max-chapters', '2'], {'TOB': 2}),
            ('extract_deutero_book_v2', ['--usfm', 'TOB', '--max-chapters', '2'], {'TOB': 2}),
            ('extract_deutero_baruch', [], {'BAR': 6}),
            ('extract_deutero_esther_additions', [], {'ESG': 6}),
            ('extract_deutero_specials', [], {'PS2': 1, 'DAG': 2}),
        ]
        with tempfile.NamedTemporaryFile(suffix='.pdf') as pdf:
            pdf.write(b'corrupt existing PDF'); pdf.flush()
            for name, extra, expected in extractors:
                with self.subTest(extractor=name):
                    fake = types.SimpleNamespace(Document=object, LINK_GOTO=1, LINK_URI=2, open=lambda path: object())
                    with patch.dict(sys.modules, {'pymupdf': fake}):
                        module = importlib.import_module(name)
                        stdout = io.StringIO(); stderr = io.StringIO()
                        with patch.object(sys, 'argv', [name, '--pdf', pdf.name, *extra]), patch.object(module.pymupdf, 'open', side_effect=RuntimeError('corrupt existing PDF')), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                            with self.assertRaises(SystemExit) as exited: module.main()
                        self.assertNotEqual(exited.exception.code, 0)
                        manifests = [json.loads(line.removeprefix('COMPLETENESS_MANIFEST ')) for line in stderr.getvalue().splitlines() if line.startswith('COMPLETENESS_MANIFEST ')]
                        self.assertEqual({m['book'] for m in manifests}, set(expected))
                        for manifest in manifests:
                            self.assertFalse(manifest['complete'])
                            self.assertEqual(manifest['missing'], list(range(1, expected[manifest['book']] + 1)))
                            self.assertEqual(manifest['failed'], [{'chapter': None, 'error': 'corrupt existing PDF'}])

if __name__ == '__main__': unittest.main()
