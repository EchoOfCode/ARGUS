"""
Live Web Search Integration for ARGUS.
Fetches real-time web results via DuckDuckGo / ddgs.
"""

import logging
from typing import Any, Dict, List

try:
    from ddgs import DDGS
except ImportError:
    try:
        from duckduckgo_search import DDGS  # type: ignore
    except ImportError:
        DDGS = None  # type: ignore

logger = logging.getLogger("argus.search")


def search_web(query: str, max_results: int = 5) -> List[Dict[str, Any]]:
    """
    Search the web for a query and return top results.

    Returns:
        List of dicts with keys: 'title', 'href', 'body'
    """
    logger.info("Executing web search for query: %s", query)
    try:
        results = []
        with DDGS() as ddgs:
            raw_results = list(ddgs.text(query, max_results=max_results))
            for r in raw_results:
                results.append({
                    "title": r.get("title", ""),
                    "href": r.get("href", ""),
                    "body": r.get("body", ""),
                })
        return results
    except Exception as e:
        logger.error("Web search failed for query '%s': %s", query, e)
        return []
