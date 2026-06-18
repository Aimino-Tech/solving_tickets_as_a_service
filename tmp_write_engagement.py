import gspread
from datetime import datetime

sa = gspread.service_account(filename="/home/agent/.config/gspread/service_account.json")
sheet = sa.open_by_key("1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY")

ws = sheet.worksheet("twitter-engagement")

today = datetime.utcnow().strftime("%Y-%m-%d")

# Engagement data collected from browser scraping
data = [
    # [ContentID, PostURL, Date, Likes, Retweets, Replies, Views, Notes]
    ["TW001", "https://x.com/makarandutpat/status/2064687216174285260", today, 0, 0, 1, 101, "MCP courses thread reply"],
    ["TW002", "https://x.com/CorpusIQ/status/2064696415889379605", today, 0, 0, 0, 7, "CDP connection issue - may not have posted"],
    ["TW004", "https://x.com/David/status/2064939160876491046", today, 11, 1, 3, 1700, "BNKR/AI agent trading terminal thread"],
    ["TW005", "https://x.com/DrSirajDokadia/status/2064936536488149035", today, 1, 0, 0, 12, "MCP enterprise governance thread"],
    ["TW006", "https://x.com/jianw851/status/2064743391678828860", today, 22, 2, 7, 1200, "MCP integration bottleneck thread - high engagement"],
    ["TW007", "https://x.com/johnpauldooga/status/2065010736871391247", today, 2, 2, 5, 48, "TRON x AI stablecoin data thread"],
    ["TW008", "https://x.com/0xdeger/status/2064996321292161110", today, 1, 1, 1, 22, "AI agent observability thread"],
    ["TW009", "https://x.com/PaulBujak/status/2064238462476103748", today, 1, 0, 3, 142, "InvoiceMedley MCP announcement reply"],
    ["TW010", "https://x.com/ConorBronsdon/status/2065288433715847526", today, 6, 0, 3, 181, "gws-mcp-server tool overload reply"],
    ["TW011a", "https://x.com/shiffgil/status/2065299404534243614", today, 0, 0, 1, 10, "MCP invoicing reply"],
    ["TW011b", "https://x.com/waldekm/status/2066517442600243596", today, 0, 0, 1, 75, "MCP harness separation of concerns reply"],
    ["TW012", "https://x.com/AzureCosmosDB/status/2066762698872725633", today, 4, 1, 3, 320, "Azure Cosmos DB MCP Toolkit GA reply"],
    ["TW013", "https://x.com/manishlad008/status/2066724936966934805", today, 0, 0, 1, 13, "MCP PM perspective reply"],
    ["TW014", "https://x.com/sobczak_mariusz/status/2066732475053699161", today, 39, 3, 1, 1900, "Minos AI MCP for TAO subnet - HIGH ENGAGEMENT"],
    ["TW015", "https://x.com/anoopjoes/status/2066775418942939273", today, 0, 0, 1, 9, "MCP architecture blog reply"],
    ["TW016", "https://x.com/khanna2402/status/2066774912132628561", today, 0, 0, 1, 14, "Agentic dev learning list reply"],
    ["TW017", "https://x.com/HashteeLab/status/2066788695991271584", today, 1, 0, 1, 39, "MCP USB-C analogy reply"],
    ["TW018", "https://x.com/AzureCosmosDB/status/2066762698872725633", today, 4, 1, 3, 320, "Same URL as TW012 - duplicate reply"],
    ["TW019", "https://x.com/trishlaostwal/status/2066880035751936115", today, 15, 4, 2, 1900, "Nexxen MCP ad tech thread - HIGH ENGAGEMENT"],
    ["TW020a", "https://x.com/101babich/status/2066857464855695657", today, 20, 1, 4, 1600, "Top 7 MCP for Designers reply - HIGH ENGAGEMENT"],
    ["TW021a", "https://x.com/efipm/status/2066870166567207344", today, 2, 1, 1, 91, "Coinbase for Agents x402 reply"],
    ["TW022a", "https://x.com/lyrie_ai/status/2067121619110117770", today, 0, 0, 1, 49, "GitLab MCP CVE-2026-44895 reply"],
    ["TW023a", "https://x.com/policylayer_dan/status/2067121954646020408", today, 0, 0, 1, 15, "MCP agent guardrails reply"],
    ["TW024", "https://x.com/subham11/status/2067112361161593305", today, 3, 0, 3, 144, "MCP confused-deputy security reply"],
    ["TW025", "https://x.com/JFrogSecurity/status/2067125614096662735", today, 5, 3, 0, 1400, "JFrog MCP supply chain security reply - HIGH VIEWS"],
    ["TW026", "https://x.com/stheismann/status/2066975472894796001", today, 2, 0, 3, 42, "SAP MCP enterprise adoption reply"],
    ["TW027", "https://x.com/rohanpaul_ai/status/2066899870070292674", today, 8, 0, 1, 1200, "NEO MCP coding agents reply - good engagement"],
    ["TW028", "https://x.com/r0dth/status/2066980199531704518", today, 5, 0, 1, 130, "RAMen Redis alternative MCP reply"],
    ["TW020b", "https://x.com/RituWithAI/status/2060957388937519600", today, 6, 7, 3, 460, "MarkItDown MCP server reply"],
    ["TW021b", "https://x.com/TheYotg/status/2046172781922975747", today, 242, 60, 7, 9800, "GraphRAG unified memory - TOP PERFORMER"],
    ["TW022b", "https://x.com/jerryjliu0/status/1920268578898825590", today, 427, 64, 14, 39500, "Document MCP server idea - TOP PERFORMER"],
    ["TW023b", "https://x.com/v_shakthi/status/2067067633388974460", today, 0, 0, 1, 103, "Enterprise AI agents daily briefing reply"],
    ["TW033", "https://x.com/fsiemanym/status/2067245162821247418", today, 0, 0, 1, 7, "MCP ceremony vs prompt injection reply"],
    ["TW034", "https://x.com/OdedTsamir/status/2067243698530771452", today, 0, 0, 1, 20, "Agent self-improvement loop reply"],
    ["TW035", "https://x.com/RupaTiwari82008/status/2067471300868849788", today, 1, 0, 1, 24, "MCP server testing with real AI models reply"],
]

# Build rows for appending
rows = []
for d in data:
    rows.append([d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]])

# Append to the sheet
ws.append_rows(rows, value_input_option='USER_ENTERED')
print(f"Written {len(rows)} rows to twitter-engagement sheet")

# Calculate summary
total_likes = sum(d[3] for d in data)
total_retweets = sum(d[4] for d in data)
total_replies = sum(d[5] for d in data)
total_views = sum(d[6] for d in data)
total_engagement = total_likes + total_retweets + total_replies

print(f"\n=== ENGAGEMENT SUMMARY ({today}) ===")
print(f"Total Posts Tracked: {len(data)}")
print(f"Total Views: {total_views:,}")
print(f"Total Likes: {total_likes:,}")
print(f"Total Retweets: {total_retweets:,}")
print(f"Total Replies: {total_replies:,}")
print(f"Total Engagement (Likes+RT+Replies): {total_engagement:,}")
print(f"Engagement Rate: {(total_engagement/total_views*100):.2f}%" if total_views > 0 else "N/A")

# Top 3 by likes
sorted_data = sorted(data, key=lambda x: x[3], reverse=True)
print(f"\n=== TOP 3 POSTS BY LIKES ===")
for i, d in enumerate(sorted_data[:3], 1):
    print(f"{i}. {d[0]} ({d[3]} likes, {d[4]} RT, {d[5]} replies, {d[6]:,} views)")
    print(f"   URL: {d[1]}")
    print(f"   Note: {d[7]}")
