"""
Universal IMAP Email Reader for ARGUS.
Supports Gmail (with App Password), Outlook, Yahoo, iCloud, and custom IMAP servers.
"""

import email
from email.header import decode_header
import html
import imaplib
import logging
import os
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger("argus.email")


def _clean_header(header_value: Optional[str]) -> str:
    """Decode and clean MIME-encoded headers."""
    if not header_value:
        return ""
    decoded_parts = decode_header(header_value)
    result = []
    for part, encoding in decoded_parts:
        if isinstance(part, bytes):
            try:
                result.append(part.decode(encoding or "utf-8", errors="replace"))
            except Exception:
                result.append(part.decode("utf-8", errors="ignore"))
        else:
            result.append(str(part))
    return "".join(result).strip()


def _strip_html(raw_html: str) -> str:
    """Strip HTML tags and unescape entities to obtain readable plain text."""
    # Remove script and style tags
    clean = re.sub(r"<(script|style).*?>.*?</\1>", "", raw_html, flags=re.DOTALL | re.IGNORECASE)
    # Replace breaks and paragraphs with newlines
    clean = re.sub(r"<(br|p|div|tr|h[1-6]).*?>", "\n", clean, flags=re.IGNORECASE)
    # Remove remaining HTML tags
    clean = re.sub(r"<[^>]+>", " ", clean)
    # Unescape HTML entities
    clean = html.unescape(clean)
    # Collapse multiple whitespaces/newlines
    clean = re.sub(r"[ \t]+", " ", clean)
    clean = re.sub(r"\n\s*\n+", "\n\n", clean)
    return clean.strip()


def _extract_body_and_snippet(msg: email.message.Message) -> tuple[str, str]:
    """Extract plain text body and clean snippet from an email message."""
    body_text = ""

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))

            if "attachment" in content_disposition:
                continue

            if content_type == "text/plain":
                try:
                    payload = part.get_payload(decode=True)
                    charset = part.get_content_charset() or "utf-8"
                    body_text = payload.decode(charset, errors="replace")
                    break
                except Exception:
                    pass
            elif content_type == "text/html" and not body_text:
                try:
                    payload = part.get_payload(decode=True)
                    charset = part.get_content_charset() or "utf-8"
                    raw_html = payload.decode(charset, errors="replace")
                    body_text = _strip_html(raw_html)
                except Exception:
                    pass
    else:
        try:
            payload = msg.get_payload(decode=True)
            charset = msg.get_content_charset() or "utf-8"
            raw = payload.decode(charset, errors="replace") if payload else ""
            if msg.get_content_type() == "text/html":
                body_text = _strip_html(raw)
            else:
                body_text = raw
        except Exception:
            body_text = ""

    # Generate short snippet
    clean_body = re.sub(r"\s+", " ", body_text).strip()
    snippet = clean_body[:200] + ("..." if len(clean_body) > 200 else "")
    return body_text, snippet


class EmailReader:
    """Handles IMAP connections to fetch, search, and parse emails."""

    def __init__(self):
        self.host = os.getenv("EMAIL_HOST", "imap.gmail.com")
        self.port = int(os.getenv("EMAIL_PORT", "993"))
        self.user = os.getenv("EMAIL_USER", "")
        self.password = os.getenv("EMAIL_PASS", "")

    def is_configured(self) -> bool:
        """Check if email credentials are set."""
        return bool(self.user and self.password)

    def _connect(self) -> imaplib.IMAP4_SSL:
        """Create and authenticate IMAP SSL connection."""
        if not self.is_configured():
            raise ValueError(
                "Email credentials not configured! Please set EMAIL_USER and EMAIL_PASS in your backend .env file."
            )
        try:
            mail = imaplib.IMAP4_SSL(self.host, self.port)
            mail.login(self.user, self.password)
            return mail
        except Exception as e:
            logger.error("IMAP connection failed: %s", e)
            raise ConnectionError(f"Failed to connect to email server ({self.host}): {e}")

    def fetch_unread(self, limit: int = 5) -> List[Dict[str, Any]]:
        """Fetch latest unread emails."""
        mail = self._connect()
        try:
            mail.select("INBOX", readonly=True)
            status, response = mail.search(None, "UNSEEN")
            if status != "OK" or not response[0]:
                return []

            email_ids = response[0].split()
            # Fetch the most recent ones first
            email_ids = email_ids[-limit:][::-1]

            results = []
            for num in email_ids:
                status, data = mail.fetch(num, "(RFC822)")
                if status != "OK" or not data or not data[0]:
                    continue

                raw_email = data[0][1]
                msg = email.message_from_bytes(raw_email)
                subject = _clean_header(msg.get("Subject", "(No Subject)"))
                sender = _clean_header(msg.get("From", "(Unknown Sender)"))
                date_str = _clean_header(msg.get("Date", ""))
                body, snippet = _extract_body_and_snippet(msg)

                results.append({
                    "id": num.decode("utf-8", errors="ignore"),
                    "subject": subject,
                    "sender": sender,
                    "date": date_str,
                    "snippet": snippet,
                    "body": body[:3000],  # Truncate body for AI processing
                })

            return results
        finally:
            try:
                mail.close()
                mail.logout()
            except Exception:
                pass

    def get_email_by_id(self, email_id: str) -> Optional[Dict[str, Any]]:
        """Fetch a specific email by its IMAP ID."""
        mail = self._connect()
        try:
            mail.select("INBOX", readonly=True)
            status, data = mail.fetch(email_id.encode("utf-8"), "(RFC822)")
            if status != "OK" or not data or not data[0]:
                return None

            raw_email = data[0][1]
            msg = email.message_from_bytes(raw_email)
            subject = _clean_header(msg.get("Subject", "(No Subject)"))
            sender = _clean_header(msg.get("From", "(Unknown Sender)"))
            date_str = _clean_header(msg.get("Date", ""))
            body, snippet = _extract_body_and_snippet(msg)

            return {
                "id": email_id,
                "subject": subject,
                "sender": sender,
                "date": date_str,
                "snippet": snippet,
                "body": body[:5000],
            }
        finally:
            try:
                mail.close()
                mail.logout()
            except Exception:
                pass

    def search_emails(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Search emails by query (subject or sender or text)."""
        mail = self._connect()
        try:
            mail.select("INBOX", readonly=True)
            # Try searching by subject first, then general TEXT
            status, response = mail.search(None, f'(OR SUBJECT "{query}" FROM "{query}")')
            if status != "OK" or not response[0]:
                # Fallback to general TEXT search
                status, response = mail.search(None, f'(TEXT "{query}")')

            if status != "OK" or not response[0]:
                return []

            email_ids = response[0].split()
            email_ids = email_ids[-limit:][::-1]

            results = []
            for num in email_ids:
                status, data = mail.fetch(num, "(RFC822)")
                if status != "OK" or not data or not data[0]:
                    continue

                raw_email = data[0][1]
                msg = email.message_from_bytes(raw_email)
                subject = _clean_header(msg.get("Subject", "(No Subject)"))
                sender = _clean_header(msg.get("From", "(Unknown Sender)"))
                date_str = _clean_header(msg.get("Date", ""))
                body, snippet = _extract_body_and_snippet(msg)

                results.append({
                    "id": num.decode("utf-8", errors="ignore"),
                    "subject": subject,
                    "sender": sender,
                    "date": date_str,
                    "snippet": snippet,
                    "body": body[:3000],
                })

            return results
        finally:
            try:
                mail.close()
                mail.logout()
            except Exception:
                pass


# Global singleton reader
email_reader = EmailReader()
