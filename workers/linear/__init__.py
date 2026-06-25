"""
Linear API integration for STAS.

Provides the ``LinearClient`` GraphQL client with rate limiting, caching,
and pagination support.
"""

from workers.linear.client import LinearClient, LinearIssue, LinearProject, LinearAPIError

__all__ = [
    "LinearClient",
    "LinearIssue",
    "LinearProject",
    "LinearAPIError",
]
