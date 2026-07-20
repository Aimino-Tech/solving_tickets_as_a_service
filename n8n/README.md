# Blog → Social Cross-Post (n8n Workflow)

Automatically cross-publish blog posts to Twitter/X and LinkedIn when a new post goes live.

## Overview

This n8n workflow listens for a webhook containing blog post metadata, formats the content for each platform, and posts to Twitter/X and LinkedIn simultaneously. On failure, it aggregates errors and sends a notification to a Slack channel.

## Workflow Architecture

```
Blog Published Webhook
        │
        ▼
    Format Post (Code Node)
        │
        ├────────────────────┐
        ▼                    ▼
  Post to Twitter      Post to LinkedIn
        │                    │
        ▼                    ▼
  Check Twitter Err    Check LinkedIn Err
        │                    │
   ┌────┴────┐          ┌───┴────┐
   ▼         ▼          ▼        ▼
Success  Log Twitter  Success  Log LinkedIn
         Failure               Failure
           │                     │
           └──────────┬──────────┘
                      ▼
                Error Merge
                      │
                      ▼
          Error Notification (Slack)
```

## Importing the Workflow

### Option 1: Drag-and-Drop (n8n UI)

1. Open your n8n instance in a browser
2. Go to **Workflows** → **Add Workflow**
3. Click the **Import** button (or use `Ctrl+I` / `Cmd+I`)
4. Select the file `n8n/blog-social-crosspost.json`
5. The workflow appears in the editor — review and activate

### Option 2: n8n CLI

```bash
# Copy the file to your n8n deployment
scp n8n/blog-social-crosspost.json user@host:/path/to/n8n/workflows/

# Or if running n8n with --data=/path, place it in the workflows directory
cp n8n/blog-social-crosspost.json /path/to/n8n/workflows/
```

### Option 3: API Import (curl)

```bash
curl -X POST "https://your-n8n-instance/api/v1/workflows" \
  -H "Content-Type: application/json" \
  -H "X-N8N-API-KEY: YOUR_API_KEY" \
  -d @n8n/blog-social-crosspost.json
```

## Webhook Configuration

### Endpoint

After importing, activate the workflow to get the webhook URL. It will look like:

```
https://your-n8n-instance/webhook/blog-published
```

### Expected Payload

Send a `POST` request with the following JSON body:

```json
{
  "title": "Your Blog Post Title",
  "link": "https://example.com/blog/your-post-slug",
  "excerpt": "A brief description or summary of the blog post.",
  "author": "Author Name",
  "publishedDate": "2026-07-20T10:00:00Z",
  "slug": "your-post-slug",
  "tags": ["tech", "product", "update"],
  "blogName": "Our Blog",
  "thumbnailUrl": "https://example.com/images/thumbnail.jpg",
  "authorId": "urn:li:organization:123456"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Blog post title |
| `link` | Yes | Full URL to the published post |
| `excerpt` | Yes | Short description or summary |
| `author` | No | Author display name (default: "Team") |
| `publishedDate` | No | ISO 8601 published timestamp |
| `slug` | No | URL slug for the post |
| `tags` | No | Array of tag strings |
| `blogName` | No | Name of the blog (default: "Our Blog") |
| `thumbnailUrl` | No | URL to a thumbnail image for LinkedIn article share |
| `authorId` | No | LinkedIn URN for the author/organization. Required by LinkedIn share endpoint. |

### Testing the Webhook

```bash
curl -X POST "https://your-n8n-instance/webhook/blog-published" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Introducing AGI Co-Workers",
    "link": "https://aimino.com/blog/introducing-agi-co-workers",
    "excerpt": "We are thrilled to announce the next generation of AI-assisted workflows...",
    "author": "Aimino Team",
    "publishedDate": "2026-07-20T10:00:00Z",
    "tags": ["agi", "announcement", "product"]
  }'
```

## Required Credentials

### 1. Twitter / X (OAuth 2.0)

**Credential name in n8n:** `Twitter Blog Cross-Post Bot`

**Steps to create:**
1. Go to [developer.twitter.com](https://developer.twitter.com/) and create a project
2. Enable OAuth 2.0 and generate a Client ID / Client Secret
3. In n8n, go to **Credentials** → **New** → **Twitter OAuth2 API**
4. Enter the Client ID and Client Secret
5. Set the callback URL to the one n8n provides during credential setup
6. Complete the OAuth flow

**Required scopes:**
- `tweet.read`
- `tweet.write`
- `users.read`

### 2. LinkedIn API

**Credential name in n8n:** `LinkedIn Blog Cross-Post Bot`

**Steps to create:**
1. Go to [developer.linkedin.com](https://developer.linkedin.com/) and create an app
2. Request the **Share on LinkedIn** product
3. Generate a Client ID / Client Secret
4. In n8n, go to **Credentials** → **New** → **LinkedIn OAuth2 API**
5. Enter the Client ID and Client Secret
6. Set the redirect URL to the one n8n provides
7. Complete the OAuth flow with a LinkedIn account that has admin access to the target organization/page

**Required permissions:**
- `w_member_social` (for individual shares)
- `w_organization_social` (for organization page shares)
- `r_liteprofile` (for profile info)
- `r_emailaddress` (for email)

### 3. Slack (Optional — for error notifications)

**Credential name in n8n:** `STAS Slack Bot`

**Steps to create:**
1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a bot app
2. Add the `chat:write` and `chat:write.public` OAuth scopes
3. Install the app to your workspace
4. In n8n, go to **Credentials** → **New** → **Slack API**
5. Enter the Bot User OAuth Token

## Environment Variables

These are accessed via `$env.VAR_NAME` in the workflow's Format Post node's code.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_ERROR_CHANNEL` | No | `#ops-alerts` | Slack channel to post error notifications to |

## Blog Platform Integration

To trigger this workflow from your blog, add a webhook call in the post-publish hook of your CMS:

### Ghost CMS (via Zapier/Integromat or custom script)

```javascript
// Ghost post-publish custom integration
await fetch('https://your-n8n-instance/webhook/blog-published', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: post.title,
    link: post.url,
    excerpt: post.excerpt,
    author: post.authors[0]?.name,
    publishedDate: post.published_at,
    slug: post.slug,
    tags: post.tags.map(t => t.name)
  })
});
```

### WordPress (via hook)

Add to your theme's `functions.php` or use a plugin:

```php
function publish_to_n8n_webhook($post_id) {
  $post = get_post($post_id);
  if ($post->post_type !== 'post' || $post->post_status !== 'publish') return;

  $response = wp_remote_post('https://your-n8n-instance/webhook/blog-published', [
    'headers' => ['Content-Type' => 'application/json'],
    'body' => json_encode([
      'title' => $post->post_title,
      'link' => get_permalink($post_id),
      'excerpt' => get_the_excerpt($post_id),
      'author' => get_the_author_meta('display_name', $post->post_author),
      'publishedDate' => $post->post_date_gmt,
      'slug' => $post->post_name,
      'tags' => wp_get_post_tags($post_id, ['fields' => 'names']),
    ])
  ]);
}
add_action('publish_post', 'publish_to_n8n_webhook');
```

### Custom CMS

```python
import requests, json

def on_post_publish(post):
    requests.post(
        "https://your-n8n-instance/webhook/blog-published",
        json={
            "title": post.title,
            "link": post.url,
            "excerpt": post.excerpt,
            "author": post.author.name,
            "publishedDate": post.published_at.isoformat(),
            "slug": post.slug,
            "tags": [t.name for t in post.tags],
        }
    )
```

## Character Limits & Formatting

### Twitter / X
- Posts are truncated to **280 characters** with `...` appended if the title + excerpt + link exceeds the limit
- Format: `Title\n\nExcerpt...\n\nhttps://...`
- If using X Premium (long-form tweets), adjust the `tweetMaxLength` constant in the Code node

### LinkedIn
- Article shares support a title, description, and URL
- The description is truncated to **250 characters**
- Thumbnail URL support is included (pass via `thumbnailUrl` in the webhook payload)

## Error Handling

The workflow includes a robust error-handling path:

1. **Each social platform has an error check** — `Check Twitter Error` and `Check LinkedIn Error` nodes use an IF condition on `$json.error`
2. **Failed posts are logged** — `Log Twitter Failure` and `Log LinkedIn Failure` collect the failure context
3. **Errors are merged** — `Error Merge` combines failure outputs from both platforms
4. **Notification sent** — `Error Notification (Slack)` posts a formatted error message with the blog title and failure details to the configured Slack channel

If a post fails silently (e.g., API timeout), n8n's built-in retry mechanism can be enabled in the workflow settings. The success path (`Success Response` node) only fires if both platforms succeed.

## Customization

### Adding More Platforms

To add Instagram, Facebook, or Mastodon:
1. Drag a new node from the n8n palette
2. Connect it from the `Format Post` node output
3. Reference `$json.title`, `$json.link`, `$json.excerpt` in the node parameters
4. Add the appropriate error check and connect to the error merge node

### Changing the Tweet Format

Edit the `Format Post` JavaScript in the Code node. The `tweet`, `linkedInComment`, `linkedInTitle`, and `linkedInDescription` variables are what each platform node uses.

### Adjusting Character Limits

Change these constants in the Format Post Code node:
- `tweetMaxLength` (default: `280`)
- LinkedIn excerpt truncation in the `linkedInDescription` variable (default: `250`)

## Troubleshooting

| Issue | Likely Cause | Fix |
|-------|-------------|-----|
| Webhook returns 404 | Workflow not activated | Click "Active" toggle in n8n editor |
| Twitter post fails | Token expired or missing `tweet.write` scope | Re-authenticate Twitter OAuth2 |
| LinkedIn post fails | `authorId` missing or invalid | Ensure `authorId` is a valid LinkedIn URN (e.g. `urn:li:organization:123456`) |
| Slack notification fails | Bot not in the channel | Invite the bot app to the channel (`/invite @botname`) |
| Code node error | Invalid JSON in webhook payload | Check your payload against the expected schema above |

## Development

### Local Testing

1. Import the workflow into your local n8n instance
2. Use the **Webhook Test** button in n8n to generate a test URL
3. Send test payloads with `curl`
4. Check the execution log in n8n for each node's output

### Modifying the Workflow

After making changes in the n8n UI:
1. Select **Workflow** → **Export** → **JSON**
2. Replace the contents of `n8n/blog-social-crosspost.json`
3. Commit the updated file to the repository

---

**Maintainer:** Aimino Engineering
**Ticket:** AIM-3343
**Repository:** STAS (Aimino-Tech/stas)
