#!/bin/bash
# tests/regenerate-fixtures.sh
#
# Regenerates the resume-preview-validation PDF fixtures from their
# plain-text sources in tests/txt-source/, via LibreOffice headless
# conversion.
#
# WHY LIBREOFFICE: the repo's pinned pdf-parse@1.1.1 bundles an old pdf.js
# build that cannot reliably read PDFs produced by pdfkit/pdf-lib or
# hand-rolled minimal PDFs. LibreOffice-exported PDFs are confirmed
# compatible and are also a closer match to what real users actually
# upload (resumes exported from Word/Google Docs/LibreOffice).
#
# corrupted.pdf is NOT regenerated here — it's deliberately static invalid
# bytes, committed as-is, used to test graceful failure on unparseable input.
#
# Requires: libreoffice (soffice) installed locally / in CI.

set -e
cd "$(dirname "$0")"

for f in valid-resume thin-valid-resume user-guide academic-paper brochure empty; do
  soffice --headless --convert-to pdf --outdir fixtures "txt-source/$f.txt"
done

echo "Fixtures regenerated in tests/fixtures/"
