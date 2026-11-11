"""Shared portable PDF configuration; CLI wins, followed by the current/legacy env names."""
from __future__ import annotations
import argparse
import os
from pathlib import Path
from typing import Mapping

def resolve_pdf_path(cli: str | None = None, environ: Mapping[str, str] | None = None) -> str:
    values = os.environ if environ is None else environ
    value = cli or values.get('SOURCE_PDF_PATH', '').strip() or values.get('English_PDF_PATH', '').strip()
    if not value:
        raise ValueError('Provide --pdf or SOURCE_PDF_PATH (English_PDF_PATH is a compatibility alias)')
    path = Path(value).expanduser()
    if not path.is_file():
        raise ValueError(f'Source PDF is not a file: {path}')
    return str(path)

def add_pdf_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument('--pdf', help='Source PDF path; defaults to SOURCE_PDF_PATH, then English_PDF_PATH')

def pdf_from_args(args: argparse.Namespace, parser: argparse.ArgumentParser) -> str:
    try:
        return resolve_pdf_path(args.pdf)
    except ValueError as error:
        parser.error(str(error))
        raise AssertionError('unreachable')

def configured_pdf() -> str:
    parser = argparse.ArgumentParser()
    add_pdf_argument(parser)
    return pdf_from_args(parser.parse_args(), parser)

def extraction_options() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    add_pdf_argument(parser)
    parser.add_argument('--allow-partial', action='store_true', help='Explicitly permit incomplete snapshots with a manifest')
    args = parser.parse_args()
    args.pdf = pdf_from_args(args, parser)
    return args
