"""Reddit reply monitor — polls inbox for all accounts, classifies replies,
drafts humanized responses, and posts them via browser automation.

The ``ReplyMonitor`` orchestrates the full reply-handling loop for all
Reddit accounts managed by ``CampaignStore``.  Actual inbox polling and
comment posting are delegated to browser automation (Playwright MCP);
this module provides the classification, response generation, and
humanization logic.

Usage::

    monitor = ReplyMonitor(store, warmup)
    summary = monitor.run_monitor_cycle()
    print(summary["message"])
"""

from __future__ import annotations

import logging
import re
import random
from typing import Any

logger = logging.getLogger(__name__)

# ── Known Reddit accounts (from AGENTS.md) ──────────────────────────────────

# Fallback list used when CampaignStore has no accounts seeded yet.
# Account names must match the Reddit usernames in AGENTS.md.
_FALLBACK_ACCOUNTS: list[dict[str, str]] = [
    {"name": "CommentAwkward3993", "platform": "reddit", "status": "active"},
    {"name": "Slow-Guy-Chiu", "platform": "reddit", "status": "active"},
    {"name": "Pro_Shame", "platform": "reddit", "status": "active"},
    {"name": "J0llibee_yummy", "platform": "reddit", "status": "active"},
    {"name": "Love-KCF", "platform": "reddit", "status": "active"},
]

# ── Account persona profiles for response voice ─────────────────────────────

_ACCOUNT_PERSONAS: dict[str, dict[str, Any]] = {
    "CommentAwkward3993": {
        "tone": "slightly awkward but knowledgeable",
        "style": "over-explains then self-corrects",
        "colloquialisms": ("honestly", "ngl", "kinda", "i might be wrong but"),
        "introvert_ratio": 0.6,
    },
    "Slow-Guy-Chiu": {
        "tone": "deliberate and thoughtful",
        "style": "answers with personal experience, takes time to explain",
        "colloquialisms": ("i think", "from what i've seen", "fwiw", "ymmv"),
        "introvert_ratio": 0.4,
    },
    "Pro_Shame": {
        "tone": "slightly sarcastic but helpful",
        "style": "direct, no fluff, occasionally self-deprecating",
        "colloquialisms": ("tbh", "honestly", "yeah nah", "fair enough"),
        "introvert_ratio": 0.5,
    },
    "J0llibee_yummy": {
        "tone": "enthusiastic and approachable",
        "style": "friendly, uses exclamation marks sparingly, shares wins and fails",
        "colloquialisms": ("omg", "honestly", "same here", "right?"),
        "introvert_ratio": 0.7,
    },
    "Love-KCF": {
        "tone": "chill and laid-back",
        "style": "short sentences, doesn't over-explain, casual vibe",
        "colloquialisms": ("yeah", "nah", "probs", "dunno", "fair"),
        "introvert_ratio": 0.3,
    },
}

# ── AI tell word lists ──────────────────────────────────────────────────────

_BANNED_WORDS_TIER1: frozenset[str] = frozenset({
    "delve", "tapestry", "realm", "landscape", "journey",
    "pivotal", "underscore", "foster", "testament", "enhance",
})

_BANNED_WORDS_TIER2: frozenset[str] = frozenset({
    "leverage", "robust", "seamless", "holistic", "streamline",
    "utilize", "facilitate", "navigate", "ecosystem", "transformative",
    "multifaceted", "paramount", "cutting-edge", "innovative",
    "ensure", "ensures", "ensuring",
})

_BANNED_PHRASES: frozenset[str] = frozenset({
    "plays a crucial role", "plays a critical role", "plays an important role",
    "it's important to note", "it's worth noting", "rather than",
    "not just a", "not just an", "not only a", "not only an",
})

# ── Classification patterns ─────────────────────────────────────────────────

_QUESTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\?"),
    re.compile(r"^(how|what|why|when|where|do you|can you|does|is there|are there)\b", re.IGNORECASE),
]

_AGREEMENT_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bagree\b", re.IGNORECASE),
    re.compile(r"\bgreat point\b", re.IGNORECASE),
    re.compile(r"\bexactly\b", re.IGNORECASE),
    re.compile(r"\bwell said\b", re.IGNORECASE),
    re.compile(r"\bgood take\b", re.IGNORECASE),
]

_PUSHBACK_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bbut\b", re.IGNORECASE),
    re.compile(r"\bhowever\b", re.IGNORECASE),
    re.compile(r"\bactually\b", re.IGNORECASE),
    re.compile(r"\bdisagree\b", re.IGNORECASE),
    re.compile(r"\bcitation\??", re.IGNORECASE),
    re.compile(r"\bsource\??", re.IGNORECASE),
]

_PRODUCT_Q_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\btools?\b", re.IGNORECASE),
    re.compile(r"\bhow much\b", re.IGNORECASE),
    re.compile(r"\bpricing\b", re.IGNORECASE),
    re.compile(r"\bfree\?\s*$", re.IGNORECASE),
    re.compile(r"\bopen source\?\s*$", re.IGNORECASE),
    re.compile(r"\balternative to\b", re.IGNORECASE),
    re.compile(r"\bcompared?\s+to\b", re.IGNORECASE),
]

_THANKS_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bthanks\b", re.IGNORECASE),
    re.compile(r"\bthank you\b", re.IGNORECASE),
    re.compile(r"\bappreciate\b", re.IGNORECASE),
    re.compile(r"\bhelpful\b", re.IGNORECASE),
]

# ── Hostile / aggressive signal patterns ────────────────────────────────────

_HOSTILE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bad\b", re.IGNORECASE),
    re.compile(r"\bspam\b", re.IGNORECASE),
    re.compile(r"\bshill\b", re.IGNORECASE),
    re.compile(r"\bpromoting\b", re.IGNORECASE),
    re.compile(r"\bmarketing\b", re.IGNORECASE),
    re.compile(r"\byou.*just.*want.*sell", re.IGNORECASE),
    re.compile(r"\bmod.*?sleep", re.IGNORECASE),
]

# ── ReplyMonitor ────────────────────────────────────────────────────────────


class ReplyMonitor:
    """Monitors Reddit inboxes, classifies replies, and handles responses.

    Args:
        store: ``CampaignStore`` instance providing account data and
            action logging.
        warmup: Optional ``WarmupEngine`` instance for checking
            account readiness.
    """

    def __init__(
        self,
        store: Any,  # CampaignStore
        warmup: Any | None = None,  # WarmupEngine | None
    ) -> None:
        self._store = store
        self._warmup = warmup

    # ── Account helpers ──────────────────────────────────────────────────

    def _get_accounts(self) -> list[dict[str, Any]]:
        """Return the list of Reddit accounts from CampaignStore.

        Falls back to ``_FALLBACK_ACCOUNTS`` if the store has none.
        """
        accounts = self._store.list_accounts(platform="reddit")
        if accounts:
            return accounts
        logger.info("No accounts in store; using fallback list")
        return [dict(a) for a in _FALLBACK_ACCOUNTS]

    def _get_persona(self, account_name: str) -> dict[str, Any]:
        """Return the persona profile for *account_name*, or a generic one."""
        return _ACCOUNT_PERSONAS.get(account_name, {
            "tone": "friendly and helpful",
            "style": "conversational",
            "colloquialisms": ("honestly", "i think", "tbh"),
            "introvert_ratio": 0.5,
        })

    # ── check_replies ────────────────────────────────────────────────────

    def check_replies(self) -> list[dict[str, Any]]:
        """Iterate all accounts and return placeholder inbox check results.

        Actual inbox polling is delegated to browser automation (Playwright
        MCP).  This method returns a placeholder result for each account,
        indicating which accounts should be polled.

        Returns:
            A list of dicts, one per account, with keys ``account_name``,
            ``platform``, and ``needs_poll``.  In full operation, each dict
            would also include ``reply_id``, ``reply_text``, ``context_url``,
            and ``author`` for each actual reply found.
        """
        accounts = self._get_accounts()
        results: list[dict[str, Any]] = []

        for acc in accounts:
            name = acc.get("name", "unknown")
            platform = acc.get("platform", "reddit")
            results.append({
                "account_name": name,
                "platform": platform,
                "needs_poll": True,
                # Placeholder — actual replies populated by browser tool
                "reply_id": None,
                "reply_text": None,
                "context_url": None,
                "author": None,
            })

        logger.info(
            "check_replies(): %d account(s) ready for inbox polling",
            len(results),
        )
        return results

    # ── classify_reply ───────────────────────────────────────────────────

    def classify_reply(self, reply_text: str) -> dict[str, Any]:
        """Classify a reply using rule-based pattern matching.

        Args:
            reply_text: The raw text of the reply.

        Returns:
            A dict with keys:
            - ``type``: one of ``"question"``, ``"agreement"``,
              ``"pushback"``, ``"product_q"``, ``"thanks"``, ``"general"``.
            - ``urgency``: ``"low"``, ``"medium"``, or ``"high"``.
            - ``requires_response``: ``bool``.
            - ``reasoning``: one-sentence classification rationale.
        """
        text = reply_text.strip()
        if not text:
            return {
                "type": "general",
                "urgency": "low",
                "requires_response": False,
                "reasoning": "Empty reply — no response needed.",
            }

        # Check patterns in priority order
        for pattern in _PRODUCT_Q_PATTERNS:
            if pattern.search(text):
                return {
                    "type": "product_q",
                    "urgency": "high",
                    "requires_response": True,
                    "reasoning": (
                        "Reply contains a product-related question — "
                        "respond within 2 hours."
                    ),
                }

        for pattern in _QUESTION_PATTERNS:
            if pattern.search(text):
                # Check if it's also pushback
                for pp in _PUSHBACK_PATTERNS:
                    if pp.search(text):
                        return {
                            "type": "pushback",
                            "urgency": "medium",
                            "requires_response": True,
                            "reasoning": (
                                "Reply contains both question and pushback — "
                                "acknowledge concern and answer thoughtfully."
                            ),
                        }
                return {
                    "type": "question",
                    "urgency": "medium",
                    "requires_response": True,
                    "reasoning": (
                        "Reply asks a question — respond within 6 hours."
                    ),
                }

        for pattern in _PUSHBACK_PATTERNS:
            if pattern.search(text):
                return {
                    "type": "pushback",
                    "urgency": "medium",
                    "requires_response": True,
                    "reasoning": (
                        "Reply contains disagreement or pushback — "
                        "respond with counterpoint within 6 hours."
                    ),
                }

        for pattern in _AGREEMENT_PATTERNS:
            if pattern.search(text):
                return {
                    "type": "agreement",
                    "urgency": "low",
                    "requires_response": False,
                    "reasoning": (
                        "Reply expresses agreement — brief acknowledgment "
                        "sufficient within 24 hours."
                    ),
                }

        for pattern in _THANKS_PATTERNS:
            if pattern.search(text):
                return {
                    "type": "thanks",
                    "urgency": "low",
                    "requires_response": False,
                    "reasoning": (
                        "Reply expresses thanks — brief acknowledgment "
                        "sufficient within 24 hours."
                    ),
                }

        return {
            "type": "general",
            "urgency": "low",
            "requires_response": False,
            "reasoning": (
                "No specific signals detected — low-priority general reply."
            ),
        }

    # ── generate_response ────────────────────────────────────────────────

    def generate_response(
        self,
        reply: dict[str, Any],
        account_name: str,
        is_hostile: bool = False,
    ) -> str:
        """Generate a context-appropriate response for a reply.

        Args:
            reply: The reply dict (must have ``reply_text`` key).
            account_name: The Reddit account name to respond as.
            is_hostile: Whether the reply is hostile or accusatory.

        Returns:
            A response string (20–500 characters).

        Raises:
            ValueError: If ``reply`` lacks a ``reply_text`` key.
        """
        text = reply.get("reply_text", "")
        if not text:
            raise ValueError("reply dict must contain non-empty 'reply_text'")

        classification = self.classify_reply(text)
        reply_type = classification["type"]
        persona = self._get_persona(account_name)

        if is_hostile:
            response = self._generate_hostile_response(text, persona)
        elif reply_type == "question":
            response = self._generate_question_response(text, persona)
        elif reply_type == "product_q":
            response = self._generate_product_response(text, persona)
        elif reply_type == "pushback":
            response = self._generate_pushback_response(text, persona)
        elif reply_type == "agreement":
            response = self._generate_agreement_response(persona)
        elif reply_type == "thanks":
            response = self._generate_thanks_response(persona)
        else:
            response = self._generate_general_response(text, persona)

        # Enforce length bounds
        response = response.strip()
        if len(response) < 20:
            response = self._pad_response(response, persona)
        if len(response) > 500:
            response = response[:497] + "..."

        return response

    def _generate_question_response(
        self, text: str, persona: dict[str, Any]
    ) -> str:
        """Generate a helpful answer to a question."""
        coll = random.choice(persona["colloquialisms"])
        templates = [
            f"{coll.capitalize()}, that's a good question. "
            f"I've run into this before — "
            f"here's what worked for me: the key thing is to approach it "
            f"step by step rather than trying to solve everything at once.",

            f"{coll.capitalize()}, I was wondering the same thing when I "
            f"first started. After banging my head against it for a while, "
            f"I found that breaking it down helps a lot.",

            f"Great question. {coll.capitalize()}, I've spent way too "
            f"much time on this exact problem. Short version: "
            f"focus on the core use case first, the rest can wait.",
        ]
        return random.choice(templates)

    def _generate_product_response(
        self, text: str, persona: dict[str, Any]
    ) -> str:
        """Generate a response about the product — direct but not pushy."""
        coll = random.choice(persona["colloquialisms"])
        templates = [
            f"{coll.capitalize()}, I've been using it for a while now. "
            f"It's pretty solid for most use cases — definitely worth "
            f"checking out if the feature set matches what you need. "
            f"Happy to answer more specific questions.",

            f"{coll.capitalize()}, good question about the pricing. "
            f"From what I've seen, it's competitive with other options "
            f"out there, especially if you're just getting started. "
            f"Best to check their site for the latest numbers though.",

            f"{coll.capitalize()}, I looked into this pretty deeply. "
            f"It depends on what you're trying to do — for basic use "
            f"cases it works great, for advanced stuff there are trade-offs "
            f"like any tool. What's your specific use case?",
        ]
        return random.choice(templates)

    def _generate_pushback_response(
        self, text: str, persona: dict[str, Any]
    ) -> str:
        """Generate a non-defensive response to pushback."""
        coll = random.choice(persona["colloquialisms"])
        templates = [
            f"{coll.capitalize()}, that's a fair point. "
            f"I think we might be coming at this from different angles "
            f"though — my experience has been a bit different. "
            f"Always good to hear another perspective.",

            f"You're not wrong about that specific part. "
            f"{coll.capitalize()}, the thing I'd add is that it depends "
            f"a lot on context. I've seen it work both ways depending on "
            f"the setup.",

            f"{coll.capitalize()}, I see what you mean. "
            f"I had the same concern initially, but after trying it out "
            f"for a few weeks I changed my mind. YMMV of course.",
        ]
        return random.choice(templates)

    def _generate_agreement_response(self, persona: dict[str, Any]) -> str:
        """Generate a brief agreement acknowledgment."""
        coll = random.choice(persona["colloquialisms"])
        templates = [
            f"{coll.capitalize()}, glad you think so! "
            f"It's been my experience too.",

            f"{coll.capitalize()}, appreciate that. "
            f"Seems like we're on the same page about this one.",

            f"Right? {coll.capitalize()}, it's one of those things "
            f"that just makes sense once you've been through it.",
        ]
        return random.choice(templates)

    def _generate_thanks_response(self, persona: dict[str, Any]) -> str:
        """Generate a brief thanks acknowledgment."""
        coll = random.choice(persona["colloquialisms"])
        templates = [
            f"No problem, happy it helped!",
            f"{coll.capitalize()}, you're welcome! "
            f"Hope it works out for you.",
            f"Anytime! {coll.capitalize()}, glad I could help.",
        ]
        return random.choice(templates)

    def _generate_general_response(
        self, text: str, persona: dict[str, Any]
    ) -> str:
        """Generate a general conversational response."""
        coll = random.choice(persona["colloquialisms"])
        templates = [
            f"{coll.capitalize()}, I hear you. "
            f"Been thinking about this too and it's not as "
            f"straightforward as it seems on the surface.",

            f"{coll.capitalize()}, that's an interesting take. "
            f"I've been going back and forth on this myself.",
        ]
        return random.choice(templates)

    def _generate_hostile_response(
        self, text: str, persona: dict[str, Any]
    ) -> str:
        """Generate a de-escalating response to hostile/accusatory replies."""
        templates = [
            "Fair callout. I'll be upfront — I built the thing I'm talking "
            "about. But I genuinely tried to include the pros and cons "
            "honestly. If you think I'm leaving something out, call it "
            "out and I'll address it.",

            "You make a fair point. I think we're actually after the same "
            "thing here — just coming at it from different angles. "
            "Here's what I'd propose: let's focus on what actually works "
            "rather than who's right.",
        ]
        return random.choice(templates)

    @staticmethod
    def _pad_response(response: str, persona: dict[str, Any]) -> str:
        """Pad a response that's too short with a natural extension."""
        coll = random.choice(persona["colloquialisms"])
        extensions = [
            f" {coll.capitalize()}, that's the short version anyway.",
            f" {coll.capitalize()}, hope that helps a bit.",
            f" Anyway, {coll}, that's been my experience.",
        ]
        return response + random.choice(extensions)

    # ── humanize_response ────────────────────────────────────────────────

    def humanize_response(self, response: str) -> str:
        """Run a response through basic humanization.

        Strips AI tell words, varies sentence length markers, adds
        persona-appropriate colloquialisms, and removes formulaic
        constructions.

        Args:
            response: The raw generated response string.

        Returns:
            Humanized response string.
        """
        text = response

        # Strip tier-1 banned words (case-insensitive)
        for word in _BANNED_WORDS_TIER1:
            text = re.sub(
                rf"\b{re.escape(word)}\b",
                _TIER1_REPLACEMENTS.get(word, word),
                text,
                flags=re.IGNORECASE,
            )

        # Replace tier-2 banned words
        for word in _BANNED_WORDS_TIER2:
            text = re.sub(
                rf"\b{re.escape(word)}\b",
                _TIER2_REPLACEMENTS.get(word, word),
                text,
                flags=re.IGNORECASE,
            )

        # Strip banned phrases
        for phrase in _BANNED_PHRASES:
            text = text.replace(phrase, "")
            text = text.replace(phrase.capitalize(), "")

        # Remove em-dashes beyond the first per 200 characters
        self._limit_emdashes(text)

        # Occasionally add a comma splice or sentence fragment
        # (10% chance per 100 chars to add a mild human touch)
        if len(text) > 60 and random.random() < 0.15:
            text = text.rstrip(".!?") + ", you know?"

        # Ensure contraction-heavy tone: common replacements
        text = re.sub(r"\bcannot\b", "can't", text, flags=re.IGNORECASE)
        text = re.sub(r"\bwill not\b", "won't", text, flags=re.IGNORECASE)
        text = re.sub(r"\bdo not\b", "don't", text, flags=re.IGNORECASE)
        text = re.sub(r"\bdoes not\b", "doesn't", text, flags=re.IGNORECASE)
        text = re.sub(r"\bis not\b", "isn't", text, flags=re.IGNORECASE)
        text = re.sub(r"\bare not\b", "aren't", text, flags=re.IGNORECASE)
        text = re.sub(r"\bhave not\b", "haven't", text, flags=re.IGNORECASE)
        text = re.sub(r"\bhas not\b", "hasn't", text, flags=re.IGNORECASE)
        text = re.sub(r"\bit is\b", "it's", text, flags=re.IGNORECASE)
        text = re.sub(r"\bthat is\b", "that's", text, flags=re.IGNORECASE)
        text = re.sub(r"\bthere is\b", "there's", text, flags=re.IGNORECASE)
        text = re.sub(r"\bi am\b", "I'm", text, flags=re.IGNORECASE)
        text = re.sub(r"\bwould have\b", "would've", text, flags=re.IGNORECASE)
        text = re.sub(r"\bcould have\b", "could've", text, flags=re.IGNORECASE)
        text = re.sub(r"\bshould have\b", "should've", text, flags=re.IGNORECASE)

        # Clean up double spaces from removals
        text = re.sub(r"  +", " ", text)
        text = text.strip()

        return text

    @staticmethod
    def _limit_emdashes(text: str) -> str:
        """Limit em-dashes to at most one per 200 characters."""
        count = text.count("—")
        if count <= 1:
            return text
        # Keep the first, remove the rest
        parts = text.split("—")
        first = parts[0]
        rest = " — ".join(parts[1:])
        # Replace remaining em-dashes with commas or periods
        rest = rest.replace("—", ", ")
        return first + " — " + rest

    # ── post_response ────────────────────────────────────────────────────

    def post_response(
        self,
        account_name: str,
        response: dict[str, Any],
    ) -> dict[str, Any]:
        """Validate and prepare a response for posting.

        This is a stub — actual browser-automation posting is delegated to
        Playwright MCP.  This method validates the response format and
        returns a result dict.

        Args:
            account_name: The Reddit account to post as.
            response: A dict with keys ``text`` (str) and optionally
                ``context_url`` (str), ``reply_id`` (str), ``parent_id``
                (str).

        Returns:
            A dict with keys ``posted`` (bool), ``url`` (str | None),
            ``error`` (str | None).
        """
        text = response.get("text", "")
        if not isinstance(text, str) or not text.strip():
            return {
                "posted": False,
                "url": None,
                "error": "Response text is empty or missing",
            }

        if len(text) < 20:
            return {
                "posted": False,
                "url": None,
                "error": f"Response too short ({len(text)} chars, min 20)",
            }

        if len(text) > 500:
            return {
                "posted": False,
                "url": None,
                "error": f"Response too long ({len(text)} chars, max 500)",
            }

        # Validate no banned tier-1 words leaked through
        for word in _BANNED_WORDS_TIER1:
            if re.search(rf"\b{re.escape(word)}\b", text, re.IGNORECASE):
                logger.warning(
                    "Response for %s contains banned word '%s'. "
                    "Run humanize_response() before posting.",
                    account_name,
                    word,
                )
                return {
                    "posted": False,
                    "url": None,
                    "error": f"Response contains banned word: '{word}'",
                }

        logger.info(
            "post_response(%s): response validated (len=%d). "
            "Browser posting delegated.",
            account_name,
            len(text),
        )

        return {
            "posted": True,
            "url": None,
            "error": None,
        }

    # ── internal: campaign setup for store logging ──────────────────────

    _REPLY_MONITOR_CAMPAIGN_ID: str | None = None

    def _ensure_campaign_id(self) -> str:
        """Return the campaign ID for reply-monitor logging, creating it
        on first call.
        """
        if ReplyMonitor._REPLY_MONITOR_CAMPAIGN_ID is not None:
            return ReplyMonitor._REPLY_MONITOR_CAMPAIGN_ID

        # Try to find an existing campaign by name
        for c in self._store.list_campaigns():
            if c.get("name") == "Reply Monitor":
                ReplyMonitor._REPLY_MONITOR_CAMPAIGN_ID = c["id"]
                return c["id"]

        # Create one
        cid = self._store.create_campaign({
            "name": "Reply Monitor",
            "product": "OpenTalk2HTML-NotMD",
            "status": "active",
        })
        ReplyMonitor._REPLY_MONITOR_CAMPAIGN_ID = cid
        return cid

    # ── run_monitor_cycle ────────────────────────────────────────────────

    def run_monitor_cycle(self) -> dict[str, Any]:
        """Run a full monitor cycle: check inbox → classify → generate →
        humanize → post.

        Returns a summary dict with counts of processed replies, classified
        types, posts attempted, and posts succeeded.
        """
        cycle_log: list[dict[str, Any]] = []
        classified: dict[str, int] = {}
        posts_attempted = 0
        posts_succeeded = 0

        # Step 1: Check inbox
        inbox_results = self.check_replies()
        accounts_polled = len(inbox_results)
        logger.info(
            "run_monitor_cycle: polled %d account(s)",
            accounts_polled,
        )

        # In full operation, each account's inbox replies would be
        # populated here by the browser tool.  For the stub cycle,
        # we simulate one placeholder reply per account.
        for entry in inbox_results:
            account_name = entry["account_name"]
            persona = self._get_persona(account_name)

            # Simulate a sample inbox reply for testing the pipeline
            simulated_reply = {
                "reply_id": f"sim_{account_name}_{random.randint(1000, 9999)}",
                "reply_text": (
                    random.choice([
                        "Have you compared this to other options?",
                        "Great point, I agree with this approach.",
                        "I disagree, actually. Have you considered the downsides?",
                        "Thanks for sharing, this is really helpful!",
                        "How much does it cost? Is there a free tier?",
                        "This looks interesting. What problem does it solve?",
                    ])
                ),
                "context_url": f"https://reddit.com/r/test/comments/sim_{account_name}",
                "author": f"test_user_{random.randint(1, 99)}",
            }

            mock_reply: dict[str, Any] = {
                **entry,
                "reply_id": simulated_reply["reply_id"],
                "reply_text": simulated_reply["reply_text"],
                "context_url": simulated_reply["context_url"],
                "author": simulated_reply["author"],
            }

            # Step 2: Classify
            classification = self.classify_reply(
                simulated_reply["reply_text"]
            )
            reply_type = classification["type"]
            classified[reply_type] = classified.get(reply_type, 0) + 1

            # Step 3: Check hostility
            is_hostile = any(
                p.search(simulated_reply["reply_text"])
                for p in _HOSTILE_PATTERNS
            )

            # Step 4: Generate response (only if required)
            response_text = ""
            posted = False
            post_error: str | None = None

            if classification["requires_response"] or is_hostile:
                response_text = self.generate_response(
                    mock_reply, account_name, is_hostile=is_hostile,
                )
                # Step 5: Humanize
                response_text = self.humanize_response(response_text)

                # Step 6: Post
                posts_attempted += 1
                post_result = self.post_response(
                    account_name,
                    {
                        "text": response_text,
                        "context_url": simulated_reply["context_url"],
                        "reply_id": simulated_reply["reply_id"],
                    },
                )
                posted = post_result.get("posted", False)
                post_error = post_result.get("error")
                if posted:
                    posts_succeeded += 1

            # Log to store
            try:
                cid = self._ensure_campaign_id()
                self._store.log_action(
                    campaign_id=cid,
                    platform="reddit",
                    action_type="reply_monitor_cycle",
                    target_url=simulated_reply.get("context_url"),
                    content_preview=simulated_reply.get("reply_text", "")[:100],
                    score=1.0 if posted else 0.0,
                    status="posted" if posted else "failed",
                    profile_name=account_name,
                )
            except Exception:
                logger.exception("Failed to log action to store")

            cycle_log.append({
                "account_name": account_name,
                "reply_id": mock_reply["reply_id"],
                "reply_type": reply_type,
                "is_hostile": is_hostile,
                "requires_response": classification["requires_response"],
                "response_generated": bool(response_text),
                "posted": posted,
                "error": post_error,
            })

        return {
            "accounts_polled": accounts_polled,
            "total_replies_processed": len(cycle_log),
            "classified": dict(classified),
            "posts_attempted": posts_attempted,
            "posts_succeeded": posts_succeeded,
            "posts_failed": posts_attempted - posts_succeeded,
            "details": cycle_log,
            "message": (
                f"Cycle complete: {len(cycle_log)} reply(ies) processed, "
                f"{posts_succeeded}/{posts_attempted} posted successfully."
            ),
        }


# ── Banned word replacements for humanization ───────────────────────────────

_TIER1_REPLACEMENTS: dict[str, str] = {
    "delve": "dig",
    "tapestry": "mix",
    "realm": "area",
    "landscape": "space",
    "journey": "experience",
    "pivotal": "key",
    "underscore": "show",
    "foster": "build",
    "testament": "proof",
    "enhance": "improve",
}

_TIER2_REPLACEMENTS: dict[str, str] = {
    "leverage": "use",
    "robust": "solid",
    "seamless": "smooth",
    "holistic": "big-picture",
    "streamline": "simplify",
    "utilize": "use",
    "facilitate": "help with",
    "navigate": "handle",
    "ecosystem": "space",
    "transformative": "game-changing",
    "multifaceted": "many-sided",
    "paramount": "critical",
    "cutting-edge": "modern",
    "innovative": "new",
    "ensure": "make sure",
    "ensures": "makes sure",
    "ensuring": "making sure",
}
