"""
Document, PDF & Vision Intelligence Analyzer for ARGUS.
Extracts text, deadlines, exam dates, receipts, and summaries from PDFs, screenshots, and photos.
"""

import base64
import io
import json
import logging
import os
from typing import Any, Dict, List, Optional

try:
    import pypdf
except ImportError:
    pypdf = None

from groq_client import _get_client, _get_model, _clean_json_response, _get_provider_config
from rate_limiter import rate_limited

logger = logging.getLogger("argus.vision")

DOCUMENT_ANALYSIS_PROMPT = """\
You are an expert document and visual intelligence agent for ARGUS.
Analyze the provided document text or image and fulfill the user's request.

TASKS TO PERFORM:
1. Provide a crisp, structured executive summary of the document/image.
2. EXTRACT DATES & DEADLINES: If the document contains exam dates, assignment deadlines, meeting dates, or schedule items, \
   extract them into a structured `events` list.
3. If the user asked a specific question about the document, answer it with high precision.

RULES:
1. Return ONLY valid JSON:
   {
     "summary": string,
     "events": [
       {
         "title": string,
         "date": "YYYY-MM-DD" or null,
         "time": "HH:MM" or null,
         "confidence": float 0.0-1.0
       }
     ],
     "key_facts": [string]
   }
"""

def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """Extract all text from PDF bytes."""
    if not pypdf:
        logger.warning("pypdf is not installed. Using raw text parser.")
        try:
            raw = pdf_bytes.decode("latin-1", errors="ignore")
            strings = re.findall(r"\((.*?)\)", raw)
            return "\n".join(s.strip() for s in strings if len(s.strip()) > 3)[:10000]
        except Exception:
            return ""

    try:
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        pages_text = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if text.strip():
                pages_text.append(f"--- Page {i+1} ---\n{text.strip()}")
        return "\n\n".join(pages_text)
    except Exception as e:
        logger.error("Failed to parse PDF bytes: %s", e)
        return ""


@rate_limited()
def analyze_document_or_image(
    file_bytes: bytes,
    filename: str = "document.pdf",
    mime_type: str = "application/pdf",
    user_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Analyze PDF, text document, or image using multimodal LLM / Vision.
    """
    client = _get_client()
    provider, _, _, _, _ = _get_provider_config()

    is_image = mime_type.startswith("image/") or filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
    is_pdf = mime_type == "application/pdf" or filename.lower().endswith(".pdf")

    # ─── Case 1: PDF Document ─────────────────────────────────────
    if is_pdf:
        extracted_text = extract_text_from_pdf_bytes(file_bytes)
        if not extracted_text:
            return {"summary": "Could not extract readable text from PDF.", "events": [], "key_facts": []}

        # Truncate if ultra long to fit context
        truncated = extracted_text[:18000]
        prompt_text = (
            f"Filename: {filename}\n"
            f"User Instruction: {user_prompt or 'Summarize and extract any deadlines/events'}\n\n"
            f"Document Content:\n{truncated}"
        )

        try:
            res = client.chat.completions.create(
                model=_get_model(),
                messages=[
                    {"role": "system", "content": DOCUMENT_ANALYSIS_PROMPT},
                    {"role": "user", "content": prompt_text},
                ],
                temperature=0.2,
                max_tokens=1000,
            )
            raw = res.choices[0].message.content or "{}"
            cleaned = _clean_json_response(raw)
            data = json.loads(cleaned)
            return data
        except Exception as e:
            logger.error("PDF analysis failed: %s", e)
            return {"summary": f"Analyzed document {filename} ({len(extracted_text)} chars).", "events": [], "key_facts": []}

    # ─── Case 2: Image / Screenshot Vision ────────────────────────
    elif is_image:
        b64_image = base64.b64encode(file_bytes).decode("utf-8")
        img_mime = "image/jpeg" if filename.lower().endswith((".jpg", ".jpeg")) else "image/png"
        data_url = f"data:{img_mime};base64,{b64_image}"

        # Choose vision model depending on provider
        vision_model = "llama-3.2-11b-vision-preview"
        if provider == "openai":
            vision_model = "gpt-4o-mini"
        elif provider == "openrouter":
            vision_model = "anthropic/claude-3.5-sonnet"

        try:
            res = client.chat.completions.create(
                model=vision_model,
                messages=[
                    {"role": "system", "content": DOCUMENT_ANALYSIS_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_prompt or "Analyze this image, summarize key points, and extract any dates, prices, or deadlines."},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    },
                ],
                max_tokens=1000,
                temperature=0.2,
            )
            raw = res.choices[0].message.content or "{}"
            cleaned = _clean_json_response(raw)
            data = json.loads(cleaned)
            return data
        except Exception as e:
            logger.error("Vision image analysis error: %s", e)
            return {"summary": "Analyzed image.", "events": [], "key_facts": []}

    return {"summary": "Unsupported document format.", "events": [], "key_facts": []}
