"""
Twitter content draft templates for guerrilla marketing.

Follows 90/10 ratio: 90% genuine value/discussion, 10% subtle product mention.
All templates are generic — product name/url are parameters injected at runtime.
"""

import random
from typing import Optional


# ── Thread Templates ──────────────────────────────────────────────────────

THREAD_TEMPLATES = [
    # Value-driven tech discussion → subtle product mention
    {
        "tweets": [
            "one thing that took me way too long to learn about {topic}: most 'AI coding tools' are just fancy autocomplete. they don't understand your codebase, your patterns, or your team conventions.\n\nthey generate. they don't integrate.",
            "the difference between a tool that helps and a tool that gets in the way is \n\n1. does it understand your existing code? \n2. does it respect your project structure? \n3. can it actually execute, not just suggest?\n\nmost tools fail at #3.",
            "that's why I've been following {product} — it's an MCP server that actually understands your project context. {product_url}\n\nnot affiliated, just appreciate the approach. curious what others are using that passes the 'can it ship' test.",
        ],
    },
    {
        "tweets": [
            "hot take: the '{topic}' space is full of solutions looking for problems.\n\nevery week there's a new framework/library/tool that promises to 10x your workflow. most of them solve a problem the creator had, not one the community has.",
            "the tools that actually stick are the ones that:\n- solve a real, painful problem\n- integrate with what you already use\n- get out of your way\n\nnot the ones with the best landing page.",
            "{product} falls into the first category imo. it's not flashy, it just works with your existing MCP setup. {product_url}\n\nanyone else found tools that actually fit this criteria?",
        ],
    },
    {
        "tweets": [
            "building {topic} pipelines taught me that most developers over-engineer their first iteration.\n\nyou don't need Kubernetes. you don't need microservices. you need a script that works and the discipline to improve it incrementally.",
            "the same applies to AI tooling. you don't need a massive platform — you need something that plugs into what you already have and doesn't force you to change your workflow.",
            "that's why I'm bullish on tools like {product}. it's a focused MCP server that does one thing well — no bloat. {product_url}\n\nwhat's your 'less is more' tool this month?",
        ],
    },
]

# ── Tweet Templates ───────────────────────────────────────────────────────

TWEET_TEMPLATES = [
    # Pure value (90%)
    "{observation_about_topic}. the best {topic} engineers I know all do this — they just don't talk about it.",
    "unpopular opinion in {topic}: {hot_take}. \n\ntest it before you dismiss it.",
    "the most underrated skill in {topic} is {skill}. \n\neveryone chases the shiny new thing. the pros master the fundamentals.",
    "thread idea: {thread_idea}.\n\nwould anyone actually read this or is it just me?",
    "just shipped {achievement}.\n\nfeels good. sometimes the small wins are the ones that matter most.",
    "asked 10 {topic} devs what tool they couldn't live without. \n\n{result_1} \n{result_2} \n{result_3} \n\nsurprised by {surprising_result}.",
    "controversial: {controversial_statement}.\n\nchange my mind.",
]

# ── Reply Templates ───────────────────────────────────────────────────────

REPLY_TEMPLATES = [
    # Genuine engagement first (90%)
    {
        "style": "agreement_with_addition",
        "template": "yeah, {acknowledge_point}. \n\nalso worth considering: {additional_perspective}. \n\n{optional_tool_note}",
    },
    {
        "style": "shared_experience",
        "template": "had the same issue with {similar_experience}. \n\nwhat worked for me: {solution}. \n\n{optional_tool_note}",
    },
    {
        "style": "technical_question",
        "template": "interesting approach. \n\nhow does this handle {edge_case}? i've been looking at different solutions for this — {optional_tool_note}",
    },
    {
        "style": "agreement",
        "template": "this. \n\n{amplify_point}. \n\n{optional_tool_note}",
    },
    {
        "style": "alternative_view",
        "template": "i see it differently actually. \n\n{alternative_viewpoint}. \n\n{optional_tool_note}",
    },
]

# ── Quote Tweet Templates ────────────────────────────────────────────────

QUOTE_TWEET_TEMPLATES = [
    {
        "reaction": "this is actually a solid take. ",
        "body": "{commentary}",
        "mention": "\n\nwe use {product} for this — {product_relevance} {product_url}",
    },
    {
        "reaction": "been thinking the same thing. ",
        "body": "{commentary}",
        "mention": "\n\n{product} fits this exact niche btw {product_url}",
    },
    {
        "reaction": "",
        "body": "{commentary}",
        "mention": "\n\ntools like {product} make this easier {product_url}",
    },
]


# ── Generation Functions ──────────────────────────────────────────────────

def generate_thread(
    topic: str,
    product: str,
    product_url: str,
    template_index: Optional[int] = None,
) -> list[str]:
    """Generate a multi-tweet thread with one subtle product mention.

    Args:
        topic: The topic/discussion area (e.g. "AI coding tools", "MCP servers")
        product: Product name (e.g. "Office Oxide MCP")
        product_url: Product URL
        template_index: Specific template index (random if None)

    Returns:
        List of tweet strings in thread order.
    """
    idx = template_index if template_index is not None else random.randrange(len(THREAD_TEMPLATES))
    template = THREAD_TEMPLATES[idx]
    return [
        t.format(topic=topic, product=product, product_url=product_url)
        for t in template["tweets"]
    ]


def generate_tweet(**kwargs) -> str:
    """Generate a standalone tweet.

    Accepts keyword arguments matching template placeholders.
    Falls back to a generic template if no kwargs provided.

    Returns:
        Single tweet string.
    """
    template = random.choice(TWEET_TEMPLATES)
    if kwargs:
        return template.format(**kwargs)
    # Generic fallback with random placeholders
    return template.format(
        observation_about_topic="the gap between 'it works on my machine' and 'it works in production' is the most expensive gap in software",
        topic="software engineering",
        hot_take="most code doesn't need to be 'production-grade' on day one — it needs to exist and be iterated on",
        skill="knowing when NOT to add abstraction",
        thread_idea="why most 'developer productivity' tools actually reduce productivity — and what to do about it",
        achievement="a refactor that removed more code than it added",
        result_1="a simple shell script",
        result_2="VS Code",
        result_3="the 'man' command",
        surprising_result="how many said 'man pages'",
        controversial_statement="code reviews should be optional for the first 24 hours of a feature spike",
    )


def generate_reply(
    style: str = "agreement_with_addition",
    mention_product: bool = False,
    product: str = "",
    product_url: str = "",
    **context: str,
) -> str:
    """Generate a reply to a tweet/mention.

    Args:
        style: One of the REPLY_TEMPLATES keys.
        mention_product: Whether to include a subtle product mention.
        product: Product name (only used if mention_product=True).
        product_url: Product URL (only used if mention_product=True).
        **context: Template variable values.

    Returns:
        Reply text string.
    """
    template = next((t for t in REPLY_TEMPLATES if t["style"] == style), REPLY_TEMPLATES[0])

    fill = dict(context)
    # Fill optional tool note
    if mention_product and product and product_url:
        fill["optional_tool_note"] = f"we've been trying {product} and it handles this well — {product_url}"
    else:
        fill["optional_tool_note"] = ""

    return template["template"].format(**fill)


def generate_quote_tweet(
    commentary: str,
    product: str = "",
    product_url: str = "",
    mention_product: bool = False,
    template_index: Optional[int] = None,
) -> str:
    """Generate a quote tweet (retweet with comment).

    Args:
        commentary: Your commentary on the quoted tweet.
        product: Product name (only used if mention_product=True).
        product_url: Product URL (only used if mention_product=True).
        mention_product: Whether to include a product mention.
        template_index: Specific template index (random if None).

    Returns:
        Quote tweet text string.
    """
    idx = template_index if template_index is not None else random.randrange(len(QUOTE_TWEET_TEMPLATES))
    template = QUOTE_TWEET_TEMPLATES[idx]

    if mention_product and product and product_url:
        mention = template["mention"].format(product=product, product_url=product_url, product_relevance="handles the heavy lifting —")
    else:
        mention = ""

    return f"{template['reaction']}{template['body'].format(commentary=commentary)}{mention}".strip()
