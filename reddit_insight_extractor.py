#!/usr/bin/env python3
"""
Reddit HubSpot Insight Extractor
=================================
Reads a CSV of Reddit URLs, fetches post content + comments,
sends each to Claude API for structured insight extraction,
and compiles everything into a single Markdown report.

Setup:
    pip install anthropic requests

Usage:
    # Dry run — fetches Reddit content but skips API calls (free to test)
    python reddit_insight_extractor.py urls.csv --dry-run

    # Full run
    python reddit_insight_extractor.py urls.csv

    # Limit to first 5 posts (good for testing)
    python reddit_insight_extractor.py urls.csv --limit 5

    # Resume a partial run (skips already-cached posts)
    python reddit_insight_extractor.py urls.csv --resume

    # Custom output file
    python reddit_insight_extractor.py urls.csv -o my_report.md

Input CSV format:
    A CSV with a column named 'url' (case-insensitive). Other columns are ignored.
    Example:
        url
        https://www.reddit.com/r/hubspot/comments/abc123/some_post/
        https://reddit.com/r/CRM/comments/def456/another_post/

Environment:
    ANTHROPIC_API_KEY  — your Anthropic API key (required for full runs)
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from pathlib import Path
from datetime import datetime

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip install requests")
    sys.exit(1)

try:
    import anthropic
except ImportError:
    print("ERROR: 'anthropic' not installed. Run: pip install anthropic")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
REDDIT_DELAY = 2.0          # seconds between Reddit requests (be polite)
CLAUDE_MODEL = "claude-sonnet-4-20250514"
MAX_COMMENTS = 30           # top-level + nested comments to include per post
MAX_COMMENT_DEPTH = 3       # how deep to recurse into comment trees
CACHE_DIR = Path("cache")   # intermediate results saved here for resume

EXTRACTION_PROMPT = """You are analyzing a Reddit post about HubSpot (or CRM/marketing tools).
Extract ALL of the following from the post and its comments. Be thorough — capture every
distinct point, even if minor.

Categories to extract:
1. **Facts** — Verified or stated-as-fact information about HubSpot features, pricing, limits, behavior.
2. **Opinions** — Subjective takes, likes/dislikes, comparisons, ratings.
3. **Use Cases** — How people are using HubSpot (workflows, integrations, department setups, etc).
4. **Pain Points** — Complaints, bugs, frustrations, limitations.
5. **Tips & Workarounds** — Advice, hacks, recommended settings, integrations, or tools.
6. **Comparisons** — How HubSpot is compared to other tools (Salesforce, GoHighLevel, ActiveCampaign, etc).
7. **Migration Notes** — Anything about migrating to/from HubSpot.
8. **Pricing & Licensing** — Cost-related observations, tier complaints, value assessments.

For each extracted item, note:
- Which category it belongs to
- A concise summary (1-2 sentences)
- The source (OP or commenter) — just say "OP" or "Commenter"
- Confidence: is this firsthand experience, secondhand, or speculation?

Respond in valid JSON with this structure:
{
  "post_title": "...",
  "subreddit": "...",
  "summary": "Brief 1-2 sentence summary of the overall discussion",
  "insights": [
    {
      "category": "Facts|Opinions|Use Cases|Pain Points|Tips & Workarounds|Comparisons|Migration Notes|Pricing & Licensing",
      "summary": "...",
      "source": "OP|Commenter",
      "confidence": "Firsthand|Secondhand|Speculation"
    }
  ]
}

Return ONLY valid JSON. No markdown fences, no preamble."""


# ---------------------------------------------------------------------------
# Reddit fetching
# ---------------------------------------------------------------------------
def normalize_reddit_url(url: str) -> str:
    """Clean up a Reddit URL and return the .json endpoint."""
    url = url.strip().rstrip("/")
    # Remove query params
    url = url.split("?")[0]
    # Normalize domain
    url = re.sub(r"https?://(www\.|old\.|new\.)?reddit\.com", "https://www.reddit.com", url)
    # Remove trailing slash and add .json
    if not url.endswith(".json"):
        url += ".json"
    return url


def flatten_comments(comment_data, depth=0, max_depth=MAX_COMMENT_DEPTH):
    """Recursively flatten Reddit's nested comment tree."""
    comments = []
    if not isinstance(comment_data, dict):
        return comments

    kind = comment_data.get("kind")
    data = comment_data.get("data", {})

    if kind == "t1":  # comment
        body = data.get("body", "").strip()
        if body and body != "[deleted]" and body != "[removed]":
            score = data.get("score", 0)
            comments.append({
                "body": body[:2000],  # truncate very long comments
                "score": score,
                "depth": depth,
            })

        # Recurse into replies
        if depth < max_depth:
            replies = data.get("replies", "")
            if isinstance(replies, dict):
                for child in replies.get("data", {}).get("children", []):
                    comments.extend(flatten_comments(child, depth + 1, max_depth))

    elif kind == "Listing":
        for child in data.get("children", []):
            comments.extend(flatten_comments(child, depth, max_depth))

    return comments


def fetch_reddit_post(url: str) -> dict | None:
    """Fetch a Reddit post and its comments via the .json endpoint."""
    json_url = normalize_reddit_url(url)
    headers = {
        "User-Agent": "HubSpotInsightExtractor/1.0 (research project)"
    }

    try:
        resp = requests.get(json_url, headers=headers, timeout=15)
        if resp.status_code == 429:
            print("    Rate limited — waiting 10s...")
            time.sleep(10)
            resp = requests.get(json_url, headers=headers, timeout=15)

        if resp.status_code != 200:
            print(f"    HTTP {resp.status_code}")
            return None

        data = resp.json()
        if not isinstance(data, list) or len(data) < 2:
            print("    Unexpected JSON structure")
            return None

        # Post data
        post_data = data[0]["data"]["children"][0]["data"]
        title = post_data.get("title", "Untitled")
        selftext = post_data.get("selftext", "")
        subreddit = post_data.get("subreddit", "unknown")
        score = post_data.get("score", 0)
        created_utc = post_data.get("created_utc", 0)
        num_comments = post_data.get("num_comments", 0)

        # Comments
        all_comments = []
        for child in data[1]["data"]["children"]:
            all_comments.extend(flatten_comments(child))

        # Sort by score, take top N
        all_comments.sort(key=lambda c: c["score"], reverse=True)
        top_comments = all_comments[:MAX_COMMENTS]

        return {
            "url": url,
            "title": title,
            "subreddit": subreddit,
            "selftext": selftext[:5000],  # truncate very long posts
            "score": score,
            "num_comments": num_comments,
            "created_utc": created_utc,
            "comments": top_comments,
        }

    except Exception as e:
        print(f"    Error: {e}")
        return None


# ---------------------------------------------------------------------------
# Claude API extraction
# ---------------------------------------------------------------------------
def extract_insights(client: anthropic.Anthropic, post: dict) -> dict | None:
    """Send post content to Claude for structured insight extraction."""

    # Build the content to analyze
    comment_text = ""
    for i, c in enumerate(post["comments"], 1):
        indent = "  " * c["depth"]
        comment_text += f"{indent}Comment {i} (score: {c['score']}):\n{indent}{c['body']}\n\n"

    user_content = f"""Reddit Post from r/{post['subreddit']}
Title: {post['title']}
Score: {post['score']} | Comments: {post['num_comments']}
URL: {post['url']}

--- POST BODY ---
{post['selftext'] or '(no body text — title-only post)'}

--- TOP COMMENTS ---
{comment_text or '(no comments)'}
"""

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=4096,
            messages=[{"role": "user", "content": user_content}],
            system=EXTRACTION_PROMPT,
        )

        text = response.content[0].text
        # Strip markdown fences if present
        text = re.sub(r"```json\s*", "", text)
        text = re.sub(r"```\s*$", "", text)
        text = text.strip()

        return json.loads(text)

    except json.JSONDecodeError as e:
        print(f"    JSON parse error: {e}")
        return None
    except Exception as e:
        print(f"    API error: {e}")
        return None


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------
def generate_report(results: list[dict], output_path: str):
    """Compile all extracted insights into a Markdown report."""

    # Aggregate insights by category
    categories = {}
    total_insights = 0
    for r in results:
        for insight in r.get("insights", []):
            cat = insight.get("category", "Uncategorized")
            if cat not in categories:
                categories[cat] = []
            categories[cat].append({
                **insight,
                "post_title": r.get("post_title", "Unknown"),
                "subreddit": r.get("subreddit", ""),
            })
            total_insights += 1

    # Build the report
    lines = []
    lines.append("# HubSpot Reddit Insights Report")
    lines.append("")
    lines.append(f"*Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}*")
    lines.append("")
    lines.append(f"**Posts analyzed:** {len(results)}  ")
    lines.append(f"**Total insights extracted:** {total_insights}")
    lines.append("")

    # Summary section
    lines.append("---")
    lines.append("")
    lines.append("## Post Summaries")
    lines.append("")
    for i, r in enumerate(results, 1):
        title = r.get("post_title", "Untitled")
        sub = r.get("subreddit", "")
        summary = r.get("summary", "No summary available.")
        lines.append(f"**{i}. {title}** (r/{sub})")
        lines.append(f"> {summary}")
        lines.append("")

    # Category sections
    lines.append("---")
    lines.append("")

    # Order categories for readability
    category_order = [
        "Facts", "Use Cases", "Tips & Workarounds", "Pain Points",
        "Opinions", "Comparisons", "Migration Notes", "Pricing & Licensing",
    ]
    ordered_cats = [c for c in category_order if c in categories]
    ordered_cats += [c for c in categories if c not in ordered_cats]

    for cat in ordered_cats:
        items = categories[cat]
        lines.append(f"## {cat} ({len(items)} insights)")
        lines.append("")
        for item in items:
            source_tag = f"[{item.get('source', '?')}]"
            conf = item.get("confidence", "")
            conf_tag = f" *({conf})*" if conf else ""
            post_ref = item.get("post_title", "")
            lines.append(f"- {item['summary']} — {source_tag}{conf_tag}")
            lines.append(f"  - *From: {post_ref}*")
        lines.append("")

    report = "\n".join(lines)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(report)

    print(f"\nReport saved to: {output_path}")
    print(f"  {len(results)} posts, {total_insights} insights across {len(categories)} categories")


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------
def load_urls(csv_path: str) -> list[str]:
    """Load Reddit URLs from a CSV file."""
    urls = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        # Find the URL column (case-insensitive)
        url_col = None
        for col in reader.fieldnames or []:
            if col.strip().lower() in ("url", "urls", "link", "links", "reddit_url"):
                url_col = col
                break
        if not url_col:
            print("ERROR: CSV must have a column named 'url' (or 'link', 'reddit_url').")
            sys.exit(1)

        for row in reader:
            u = row[url_col].strip()
            if u and "reddit.com" in u:
                urls.append(u)

    return urls


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Extract HubSpot insights from Reddit posts")
    parser.add_argument("csv_file", help="Path to CSV file with Reddit URLs")
    parser.add_argument("-o", "--output", default="hubspot_reddit_insights.md",
                        help="Output Markdown file (default: hubspot_reddit_insights.md)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch Reddit content but skip Claude API calls")
    parser.add_argument("--limit", type=int, default=0,
                        help="Process only first N posts (0 = all)")
    parser.add_argument("--resume", action="store_true",
                        help="Skip posts that already have cached results")
    args = parser.parse_args()

    # Load URLs
    urls = load_urls(args.csv_file)
    if args.limit > 0:
        urls = urls[:args.limit]
    print(f"Loaded {len(urls)} Reddit URLs from {args.csv_file}")

    # Check API key (unless dry run)
    if not args.dry_run:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            print("ERROR: Set ANTHROPIC_API_KEY environment variable.")
            print("  export ANTHROPIC_API_KEY='sk-ant-...'")
            sys.exit(1)
        client = anthropic.Anthropic(api_key=api_key)
    else:
        client = None
        print("DRY RUN — will fetch Reddit content but skip Claude API calls\n")

    # Cache directory
    CACHE_DIR.mkdir(exist_ok=True)

    # Process posts
    all_results = []
    for i, url in enumerate(urls, 1):
        print(f"[{i}/{len(urls)}] {url}")

        # Check cache
        cache_key = re.sub(r"[^a-zA-Z0-9]", "_", url)[:100]
        cache_file = CACHE_DIR / f"{cache_key}.json"

        if args.resume and cache_file.exists():
            print("    (cached — skipping)")
            with open(cache_file, "r") as f:
                all_results.append(json.load(f))
            continue

        # Fetch from Reddit
        print("    Fetching from Reddit...")
        post = fetch_reddit_post(url)
        if not post:
            print("    SKIPPED — could not fetch")
            continue

        print(f"    Got: \"{post['title']}\" ({len(post['comments'])} comments)")

        if args.dry_run:
            # Save the raw Reddit content so you can inspect it
            with open(cache_file, "w") as f:
                json.dump({"post_title": post["title"], "subreddit": post["subreddit"],
                           "summary": "(dry run)", "insights": [], "_raw_post": post}, f, indent=2)
            all_results.append({"post_title": post["title"], "subreddit": post["subreddit"],
                                "summary": "(dry run)", "insights": []})
        else:
            # Extract insights via Claude
            print("    Extracting insights via Claude API...")
            result = extract_insights(client, post)
            if result:
                print(f"    Extracted {len(result.get('insights', []))} insights")
                # Cache the result
                with open(cache_file, "w") as f:
                    json.dump(result, f, indent=2)
                all_results.append(result)
            else:
                print("    SKIPPED — extraction failed")

        # Rate limit
        if i < len(urls):
            time.sleep(REDDIT_DELAY)

    # Generate report
    if all_results:
        generate_report(all_results, args.output)
    else:
        print("\nNo results to report.")


if __name__ == "__main__":
    main()
