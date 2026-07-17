#!/bin/bash
# tests/regenerate-fixtures.sh
#
# Regenerates the 4 realistic PDF fixtures from their plain-text sources in
# tests/txt-source/ via LibreOffice headless conversion.
#
# WHY LIBREOFFICE, NOT pdfkit/pdf-lib: the repo's pinned pdf-parse@1.1.1
# bundles a pdf.js build from ~2017 that cannot read PDFs produced by
# pdfkit or hand-rolled minimal PDFs (confirmed during test-suite setup —
# even a bare "Hello World" pdfkit doc fails with "bad XRef entry", despite
# qpdf confirming the file is spec-valid). LibreOffice-exported PDFs work
# correctly and are also a much closer match to what real users actually
# upload (resumes exported from Word/Google Docs/LibreOffice), so this is
# the right fixture-generation method on both counts, not just a workaround.
#
# corrupted.pdf is NOT regenerated here — it's deliberately static invalid
# bytes, committed as-is.
#
# Requires: libreoffice (soffice) installed locally / in CI.

set -e
cd "$(dirname "$0")"

soffice --headless --convert-to pdf --outdir fixtures txt-source/strong-vp-resume.txt
soffice --headless --convert-to pdf --outdir fixtures txt-source/average-manager-resume.txt
soffice --headless --convert-to pdf --outdir fixtures txt-source/junior-engineer.txt
soffice --headless --convert-to pdf --outdir fixtures txt-source/empty.txt

echo "Fixtures regenerated in tests/fixtures/"
