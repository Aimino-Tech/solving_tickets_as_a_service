"""
Synchronous Linear API client for use in Celery workers.
Fixes the async/sync bridging issues in client.py.
"""
import logging, os, time, json
from typing import Any
import httpx

logger = logging.getLogger(__name__)
LINEAR_API_URL = "https://api.linear.app/graphql"

def _get_headers():
    api_key = os.environ.get("LINEAR_API_KEY", "")
    if not api_key:
        raise ValueError("LINEAR_API_KEY not set")
    return {"Authorization": api_key, "Content-Type": "application/json"}

def graphql(query: str, variables: dict | None = None) -> dict[str, Any]:
    """Execute a synchronous GraphQL query against Linear API."""
    headers = _get_headers()
    with httpx.Client() as client:
        resp = client.post(LINEAR_API_URL, headers=headers, json={"query": query, "variables": variables or {}})
        if resp.status_code >= 400:
            logger.error("Linear API error %d: %s", resp.status_code, resp.text[:500])
        resp.raise_for_status()
        data = resp.json()
        if "errors" in data:
            raise RuntimeError(f"Linear GraphQL error: {data['errors']}")
        return data.get("data", {})

def get_issues_by_state(states: list[str] | None = None) -> list[dict]:
    """Fetch issues in the given workflow states."""
    if states is None:
        states = ["Todo", "In Progress"]
    
    query = """
    query GetIssues($filter: IssueFilter!) {
      issues(filter: $filter, first: 250) {
        nodes {
          id title description priority
          state { name type }
          team { key }
          project { name }
          labels { nodes { name } }
          url createdAt updatedAt
        }
        pageInfo { hasNextPage endCursor }
      }
    }
    """
    variables = {"filter": {"state": {"name": {"in": states}}}}
    data = graphql(query, variables)
    nodes = data.get("issues", {}).get("nodes", [])
    
    result = []
    for node in nodes:
        state = node.get("state", {}) or {}
        team = node.get("team", {}) or {}
        labels = node.get("labels", {}).get("nodes", [])
        result.append({
            "id": node["id"],
            "identifier": node.get("url", "").rstrip("/").split("/")[-1] if node.get("url") else "",
            "title": node.get("title", ""),
            "description": node.get("description"),
            "priority": node.get("priority", 0),
            "state": {"name": state.get("name", "Unknown"), "type": state.get("type", "unstarted")},
            "team": {"key": team.get("key", "")},
            "project": node.get("project"),
            "labels": {"nodes": [{"name": lbl["name"]} for lbl in labels]},
            "url": node.get("url", ""),
            "created_at": node.get("createdAt", ""),
            "updated_at": node.get("updatedAt", ""),
        })
    return result

def post_comment(issue_id: str, body: str) -> dict:
    """Add a comment to a Linear issue."""
    mutation = """
    mutation($input: CommentCreateInput!) {
      commentCreate(input: $input) { success comment { id body } }
    }
    """
    data = graphql(mutation, {"input": {"issueId": issue_id, "body": body}})
    return data.get("commentCreate", {}).get("comment", {})

def transition_issue(issue_id: str, state_name: str) -> bool:
    """Transition an issue to a named state."""
    # First get the team's states
    query_issue = "query($id:String!){issue(id:$id){team{id}}}"
    data = graphql(query_issue, {"id": issue_id})
    team_id = data.get("issue", {}).get("team", {}).get("id")
    if not team_id:
        logger.warning("No team found for issue %s", issue_id)
        return False
    
    query_states = "query($id:String!){team(id:$id){states{nodes{id name}}}}"
    data2 = graphql(query_states, {"id": team_id})
    states = data2.get("team", {}).get("states", {}).get("nodes", [])
    
    target = next((s for s in states if s["name"].lower() == state_name.lower()), None)
    if not target:
        available = [s["name"] for s in states]
        logger.warning("State '%s' not found. Available: %s", state_name, available)
        return False
    
    mutation = "mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success}}"
    graphql(mutation, {"id": issue_id, "input": {"stateId": target["id"]}})
    logger.info("Transitioned %s to '%s'", issue_id, state_name)
    return True

def link_attachment_url(issue_id: str, url: str, title: str = "") -> dict:
    """Attach a URL link to a Linear issue."""
    mutation = """
    mutation($issueId:String!,$url:String!,$title:String) {
      attachmentLinkURL(issueId:$issueId, url:$url, title:$title) {
        success attachment { id url title }
      }
    }
    """
    data = graphql(mutation, {"issueId": issue_id, "url": url, "title": title or url})
    return data.get("attachmentLinkURL", {}).get("attachment", {})
