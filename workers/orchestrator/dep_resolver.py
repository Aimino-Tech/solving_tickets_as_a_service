"""
DAG Dependency Resolver — topological sort with cycle detection.

Provides a generic DAG (Directed Acyclic Graph) dependency resolver and
topological sorter. Used by the orchestrator to determine execution order
of pipeline stages, agent tasks, or any directed dependency graph.

Usage
-----
    graph = DepGraph()
    graph.add_node("task_a")
    graph.add_node("task_b", depends_on=["task_a"])
    graph.add_node("task_c", depends_on=["task_a"])
    graph.add_node("task_d", depends_on=["task_b", "task_c"])

    order = graph.topological_sort()
    # Returns: ["task_a", "task_b", "task_c", "task_d"]

    # Cycle detection
    if graph.has_cycle():
        cycle = graph.find_cycle()

    # Quick one-shot API:
    order = topological_sort({"task_b": ["task_a"], "task_c": ["task_a"]})
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class DepNode:
    """A single node in the dependency graph.

    Attributes:
        name: Unique identifier for this node.
        depends_on: Set of node names this node depends on (incoming edges).
        metadata: Optional arbitrary payload attached to the node.
    """

    name: str
    depends_on: set[str] = field(default_factory=set)
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------


class DepGraph:
    """Directed Acyclic Graph for dependency resolution.

    Maintains a set of **DepNode** instances and provides topological
    ordering via Kahn's algorithm, plus cycle detection.

    Thread-safe for reads after construction if no mutations occur.
    """

    def __init__(self) -> None:
        self._nodes: dict[str, DepNode] = {}

    # ── Mutation ────────────────────────────────────────────────────────

    def add_node(
        self,
        name: str,
        depends_on: Optional[list[str]] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> DepNode:
        """Add or update a node in the graph.

        Args:
            name: Unique node identifier.
            depends_on: List of node names this node depends on.
            metadata: Optional arbitrary payload.

        Returns:
            The created or updated **DepNode**.
        """
        if name in self._nodes:
            node = self._nodes[name]
            if depends_on is not None:
                node.depends_on.update(depends_on)
            if metadata is not None:
                node.metadata.update(metadata)
            return node

        resolved_deps = set(depends_on) if depends_on else set()
        # Auto-create any dependency nodes that don't exist yet
        for dep in resolved_deps:
            if dep not in self._nodes:
                self._nodes[dep] = DepNode(name=dep)

        node = DepNode(
            name=name,
            depends_on=resolved_deps,
            metadata=metadata or {},
        )
        self._nodes[name] = node
        return node

    def remove_node(self, name: str) -> None:
        """Remove a node and all edges pointing to/from it."""
        self._nodes.pop(name, None)
        for node in self._nodes.values():
            node.depends_on.discard(name)

    def add_dependency(self, node_name: str, depends_on: str) -> None:
        """Add a single dependency edge ``node_name -> depends_on``.

        Ensures both nodes exist (auto-creates missing nodes).
        """
        if node_name not in self._nodes:
            self.add_node(node_name)
        if depends_on not in self._nodes:
            self.add_node(depends_on)
        self._nodes[node_name].depends_on.add(depends_on)

    # ── Queries ────────────────────────────────────────────────────────

    @property
    def node_count(self) -> int:
        """Number of nodes in the graph."""
        return len(self._nodes)

    @property
    def node_names(self) -> list[str]:
        """All node names in insertion order."""
        return list(self._nodes.keys())

    def get_node(self, name: str) -> Optional[DepNode]:
        """Get a node by name, or ``None`` if not found."""
        return self._nodes.get(name)

    def get_dependents(self, name: str) -> list[str]:
        """Return all nodes that **directly depend on** *name*.

        I.e. nodes for which *name* is in their ``depends_on`` set.
        """
        return [n for n, node in self._nodes.items() if name in node.depends_on]

    def get_ancestors(self, name: str) -> set[str]:
        """Return all transitive ancestors (recursive dependencies) of *name*.

        Performs a BFS up the dependency chain.
        """
        ancestors: set[str] = set()
        queue: deque[str] = deque()
        node = self._nodes.get(name)
        if not node:
            return ancestors

        queue.extend(node.depends_on)
        while queue:
            dep = queue.popleft()
            if dep in ancestors:
                continue
            ancestors.add(dep)
            dep_node = self._nodes.get(dep)
            if dep_node:
                queue.extend(dep_node.depends_on)
        return ancestors

    # ── Topological sort ────────────────────────────────────────────────

    def topological_sort(self) -> list[str]:
        """Return nodes in topological order (Kahn's algorithm).

        Returns:
            A list of node names ordered so that every node appears after
            all of its dependencies.

        Raises:
            **CycleError**: If the graph contains a cycle.
        """
        # Build in-degree map
        in_degree: dict[str, int] = {}
        adjacency: dict[str, list[str]] = defaultdict(list)

        for node_name, node in self._nodes.items():
            in_degree.setdefault(node_name, 0)
            for dep in node.depends_on:
                adjacency.setdefault(dep, []).append(node_name)
                in_degree[node_name] = in_degree.get(node_name, 0) + 1

        # Start with nodes that have no dependencies
        queue: deque[str] = deque(
            name for name, degree in in_degree.items() if degree == 0
        )

        sorted_nodes: list[str] = []

        while queue:
            current = queue.popleft()
            sorted_nodes.append(current)

            for neighbor in adjacency.get(current, []):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(sorted_nodes) != len(self._nodes):
            remaining = set(self._nodes.keys()) - set(sorted_nodes)
            raise CycleError(
                f"Graph contains a cycle involving {len(remaining)} node(s): "
                f"{remaining}"
            )

        logger.debug(
            json.dumps({
                "event": "dep_resolver.topological_sort",
                "node_count": len(sorted_nodes),
                "order": sorted_nodes,
            })
        )

        return sorted_nodes

    # ── Cycle detection ────────────────────────────────────────────────

    def has_cycle(self) -> bool:
        """Check whether the graph contains any cycle.

        Uses DFS-based cycle detection. Does **not** mutate the graph.
        """
        try:
            self.topological_sort()
            return False
        except CycleError:
            return True

    def find_cycle(self) -> list[str]:
        """Find one cycle in the graph (DFS with recursion stack).

        Returns the first cycle found as a list of node names, or an
        empty list if the graph is acyclic.  The returned list is a
        closed cycle (first == last).

        Note:
            Best-effort — if multiple cycles exist, only the first
            discovered one is returned.
        """
        visited: set[str] = set()
        rec_stack: set[str] = set()
        path: list[str] = []

        def _dfs(node: str) -> list[str] | None:
            visited.add(node)
            rec_stack.add(node)
            path.append(node)

            dep_node = self._nodes.get(node)
            if dep_node:
                for dep in dep_node.depends_on:
                    if dep not in self._nodes:
                        continue
                    if dep not in visited:
                        result = _dfs(dep)
                        if result is not None:
                            return result
                    elif dep in rec_stack:
                        idx = path.index(dep)
                        return path[idx:] + [dep]

            path.pop()
            rec_stack.discard(node)
            return None

        for node_name in self._nodes:
            if node_name not in visited:
                result = _dfs(node_name)
                if result is not None:
                    return result

        return []

    # ── Display ────────────────────────────────────────────────────────

    def __repr__(self) -> str:
        return (
            f"DepGraph(nodes={len(self._nodes)}, "
            f"edges={sum(len(n.depends_on) for n in self._nodes.values())})"
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize the graph to a plain dict (JSON-compatible)."""
        return {
            "nodes": {
                name: {
                    "depends_on": sorted(node.depends_on),
                    "metadata": node.metadata,
                }
                for name, node in self._nodes.items()
            }
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DepGraph:
        """Deserialize a graph from a dict (inverse of **to_dict**)."""
        graph = cls()
        for name, info in data.get("nodes", {}).items():
            graph.add_node(
                name=name,
                depends_on=info.get("depends_on", []),
                metadata=info.get("metadata", {}),
            )
        return graph


# ---------------------------------------------------------------------------
# One-shot convenience API
# ---------------------------------------------------------------------------


def topological_sort(
    dependencies: dict[str, list[str]],
) -> list[str]:
    """Quick one-shot topological sort from a dependency dict.

    Args:
        dependencies: Mapping of node name -> list of dependency names.

    Returns:
        Nodes in topological order.

    Raises:
        **CycleError**: If the dependency graph contains a cycle.

    Example
    -------
        >>> topological_sort({"b": ["a"], "c": ["a"], "d": ["b", "c"]})
        ['a', 'b', 'c', 'd']
    """
    graph = DepGraph()
    for name, deps in dependencies.items():
        graph.add_node(name, depends_on=deps)
    return graph.topological_sort()


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class CycleError(Exception):
    """Raised when a dependency cycle is detected during topological sort.

    Attributes:
        message: Human-readable error description.
        cycle: The detected cycle path, if available.
    """

    def __init__(self, message: str = "", cycle: Optional[list[str]] = None) -> None:
        self.cycle = cycle or []
        super().__init__(message)
