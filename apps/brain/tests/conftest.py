"""
Pytest configuration and environment fixtures for apps/brain.
Ensures tests can collect and run cleanly in any environment (including clean CI checkout)
without requiring a pre-existing .env file.
"""

import os

# Set test environment flags before any brain module is imported
os.environ.setdefault("ARGUS_TEST_MODE", "1")
os.environ.setdefault("ARGUS_SECRET", "test_mock_secret_for_pytest_environment_32chars!")
os.environ.setdefault("LLM_PROVIDER", "mock")
