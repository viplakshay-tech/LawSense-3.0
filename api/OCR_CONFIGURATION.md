# Local OCR configuration

The document pipeline selects the local Tesseract provider by default when a
page needs OCR. This setting selects a provider; it does not mean Tesseract is
installed or that OCR ran. Digital PDF text is handled first and does not start
Tesseract. Provider and executable availability are checked when OCR is needed.
If either is missing, the document stays marked `ocr_required` with a page error
that names the unavailable dependency. A failed OCR run remains `failed` and
does not contribute recognized text. The document UI reports returned
processing status and does not infer OCR completion from ordinary text
extraction.

Install the Python requirements from this directory with
`python -m pip install -r requirements.txt`. Scanned PDF rendering uses the `pypdfium2` wheel, and
image decoding uses Pillow. Install the Tesseract OCR application separately
and include its language data. On Windows, add the Tesseract executable to
`PATH`, or set `LAW_SENSE_TESSERACT_CMD` to its full path, for example
`C:\Program Files\Tesseract-OCR\tesseract.exe`.

Configuration environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LAW_SENSE_OCR_PROVIDER` | `tesseract` | Set to `none` to disable OCR, or `tesseract` to use the local engine. |
| `LAW_SENSE_TESSERACT_CMD` | Search `PATH` | Explicit path to the Tesseract executable. |
| `LAW_SENSE_OCR_LANGUAGE` | `eng` | Tesseract language code or combination, such as `eng+hin`; matching trained data must be installed. |
| `LAW_SENSE_OCR_RENDER_DPI` | `240` | Resolution for rendering PDF pages; accepted range is 72–600 DPI. |
| `LAW_SENSE_OCR_PSM` | `3` | Tesseract page segmentation mode, from 0 to 13. |
| `LAW_SENSE_OCR_TIMEOUT_SECONDS` | `60` | Per-page OCR timeout. |

The provider returns the words and word confidence values emitted by Tesseract
TSV output. The page confidence is the mean of valid word scores, normalized to
0–1. If Tesseract reports no valid word confidence, the pipeline preserves it
as unknown (`null`).
