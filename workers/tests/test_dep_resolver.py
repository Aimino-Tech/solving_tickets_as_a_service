"""
Tests for DAG dependency resolver (AIM-2037).

Covers:
    workers.orchestrator.dep_resolver — DepGraph, topological_sort,
    cycle detection, serialization, convenience API.
"""

from __future__ import annotations

import json

import pytest

from workers.orchestrator.dep_resolver import (
    CycleError,
    DepGraph,
    DepNode,
    topological_sort,
)


class TestDepNode:
    """DepNode dataclass construction."""

    def test_defaults(self):
        node = DepNode(name="a")
        assert node.name == "a"
        assert node.depends_on == set()
        assert node.metadata == {}

    def test_with_deps(self):
        node = DepNode(name="b", depends_on={"a"})
        assert node.depends_on == {"a"}

    def test_with_metadata(self):
        node = DepNode(name="c", metadata={"key": "val"})
        assert node.metadata["key"] == "val"


class TestDepGraphAddNode:
    """Adding nodes to the graph."""

    def test_add_simple(self):
        g = DepGraph()
        n = g.add_node("a")
        assert n.name == "a"
        assert g.node_count == 1

    def test_add_with_deps(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"])
        assert g.node_count == 2
        assert g.get_node("b").depends_on == {"a"}

    def test_add_with_metadata(self):
        g = DepGraph()
        n = g.add_node("a", metadata={"tier": "pro"})
        assert n.metadata["tier"] == "pro"

    def test_add_duplicate_merges_deps(self):
        g = DepGraph()
        g.add_node("a", depends_on=["x"])
        g.add_node("a", depends_on=["y"])
        assert g.get_node("a").depends_on == {"x", "y"}

    def test_add_duplicate_merges_metadata(self):
        g = DepGraph()
        g.add_node("a", metadata={"k1": "v1"})
        g.add_node("a", metadata={"k2": "v2"})
        node = g.get_node("a")
        assert node.metadata["k1"] == "v1"
        assert node.metadata["k2"] == "v2"

    def test_remove_node(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"])
        g.remove_node("a")
        assert g.node_count == 1
        assert g.get_node("b").depends_on == set()

    def test_add_dependency_auto_creates(self):
        g = DepGraph()
        g.add_dependency("child", "parent")
        assert g.node_count == 2
        assert g.get_node("child").depends_on == {"parent"}
        assert g.get_node("parent").depends_on == set()

    def test_add_dependency_existing(self):
        g = DepGraph()
        g.add_node("child")
        g.add_node("parent")
        g.add_dependency("child", "parent")
        assert g.get_node("child").depends_on == {"parent"}


class TestDepGraphQuery:
    """Graph query methods."""

    def test_node_names(self):
        g = DepGraph()
        g.add_node("b")
        g.add_node("a")
        assert g.node_names == ["b", "a"]  # insertion order

    def test_get_node_missing(self):
        g = DepGraph()
        assert g.get_node("nonexistent") is None

    def test_get_dependents(self):
        g = DepGraph()
        g.add_node("root")
        g.add_node("child1", depends_on=["root"])
        g.add_node("child2", depends_on=["root"])
        deps = g.get_dependents("root")
        assert set(deps) == {"child1", "child2"}

    def test_get_dependents_none(self):
        g = DepGraph()
        g.add_node("a")
        assert g.get_dependents("a") == []

    def test_get_ancestors_simple(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"])
        g.add_node("c", depends_on=["b"])
        assert g.get_ancestors("c") == {"a", "b"}

    def test_get_ancestors_diamond(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"])
        g.add_node("c", depends_on=["a"])
        g.add_node("d", depends_on=["b", "c"])
        assert g.get_ancestors("d") == {"a", "b", "c"}

    def test_get_ancestors_no_deps(self):
        g = DepGraph()
        g.add_node("a")
        assert g.get_ancestors("a") == set()

    def test_get_ancestors_missing(self):
        g = DepGraph()
        assert g.get_ancestors("missing") == set()

    def test_to_dict(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"], metadata={"x": 1})
        d = g.to_dict()
        assert "a" in d["nodes"]
        assert "b" in d["nodes"]
        assert d["nodes"]["b"]["depends_on"] == ["a"]
        assert d["nodes"]["b"]["metadata"]["x"] == 1


class TestTopologicalSort:
    """Kahn's algorithm topological ordering."""

    def test_single_node(self):
        g = DepGraph()
        g.add_node("a")
        assert g.topological_sort() == ["a"]

    def test_two_nodes_linear(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"])
        assert g.topological_sort() == ["a", "b"]

    def test_chain(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"])
        g.add_node("c", depends_on=["b"])
        assert g.topological_sort() == ["a", "b", "c"]

    def test_diamond(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"])
        g.add_node("c", depends_on=["a"])
        g.add_node("d", depends_on=["b", "c"])
        result = g.topological_sort()
        # a must be first, b and c after a, d last
        assert result[0] == "a"
        assert result[-1] == "d"
        assert set(result[1:3]) == {"b", "c"}

    def test_no_dependencies(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b")
        g.add_node("c")
        result = g.topological_sort()
        assert set(result) == {"a", "b", "c"}

    def test_complex_dag(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"])
        g.add_node("c", depends_on=["a"])
        g.add_node("d", depends_on=["b"])
        g.add_node("e", depends_on=["c"])
        g.add_node("f", depends_on=["d", "e"])
        result = g.topological_sort()
        # a must be first, f must be last
        assert result[0] == "a"
        assert result[-1] == "f"
        # b before d, c before e
        assert result.index("b") < result.index("d")
        assert result.index("c") < result.index("e")

    def test_isolated_clusters(self):
        g = DepGraph()
        g.add_node("a1")
        g.add_node("a2", depends_on=["a1"])
        g.add_node("b1")
        g.add_node("b2", depends_on=["b1"])
        result = g.topological_sort()
        assert set(result) == {"a1", "a2", "b1", "b2"}
        assert result.index("a1") < result.index("a2")
        assert result.index("b1") < result.index("b2")


class TestCycleDetection:
    """Cycle detection and CycleError."""

    def test_simple_cycle(self):
        g = DepGraph()
        g.add_node("a", depends_on=["b"])
        g.add_node("b", depends_on=["a"])
        assert g.has_cycle() is True
        with pytest.raises(CycleError):
            g.topological_sort()

    def test_self_loop(self):
        g = DepGraph()
        g.add_node("a", depends_on=["a"])
        assert g.has_cycle() is True

    def test_no_cycle(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"])
        assert g.has_cycle() is False

    def test_three_node_cycle(self):
        g = DepGraph()
        g.add_node("a", depends_on=["b"])
        g.add_node("b", depends_on=["c"])
        g.add_node("c", depends_on=["a"])
        assert g.has_cycle() is True

    def test_cycle_error_message(self):
        g = DepGraph()
        g.add_node("a", depends_on=["b"])
        g.add_node("b", depends_on=["a"])
        with pytest.raises(CycleError) as exc:
            g.topological_sort()
        assert "cycle" in str(exc.value).lower()

    def test_find_cycle_simple(self):
        g = DepGraph()
        g.add_node("a", depends_on=["b"])
        g.add_node("b", depends_on=["a"])
        cycle = g.find_cycle()
        assert len(cycle) >= 2
        assert cycle[0] == cycle[-1]  # closed cycle

    def test_find_cycle_self_loop(self):
        g = DepGraph()
        g.add_node("a", depends_on=["a"])
        cycle = g.find_cycle()
        assert len(cycle) >= 2

    def test_find_no_cycle(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"])
        assert g.find_cycle() == []

    def test_find_cycle_three_node(self):
        g = DepGraph()
        g.add_node("a", depends_on=["b"])
        g.add_node("b", depends_on=["c"])
        g.add_node("c", depends_on=["a"])
        cycle = g.find_cycle()
        assert len(cycle) >= 2
        assert cycle[0] == cycle[-1]


class TestSerialization:
    """to_dict / from_dict round-trip."""

    def test_round_trip_empty(self):
        g1 = DepGraph()
        d = g1.to_dict()
        g2 = DepGraph.from_dict(d)
        assert g2.node_count == 0

    def test_round_trip(self):
        g1 = DepGraph()
        g1.add_node("a", metadata={"tier": "free"})
        g1.add_node("b", depends_on=["a"])
        g1.add_node("c", depends_on=["a", "b"])

        d = g1.to_dict()
        g2 = DepGraph.from_dict(d)

        assert g2.node_count == 3
        assert g2.get_node("a").metadata["tier"] == "free"
        assert g2.get_node("b").depends_on == {"a"}
        assert g2.get_node("c").depends_on == {"a", "b"}

    def test_from_dict_no_nodes(self):
        g = DepGraph.from_dict({})
        assert g.node_count == 0

    def test_from_dict_empty_nodes(self):
        g = DepGraph.from_dict({"nodes": {}})
        assert g.node_count == 0


class TestConvenienceAPI:
    """``topological_sort()`` one-shot function."""

    def test_simple(self):
        result = topological_sort({"b": ["a"], "c": ["a"]})
        assert result[0] == "a"
        assert set(result[1:]) == {"b", "c"}

    def test_empty(self):
        assert topological_sort({}) == []

    def test_no_deps(self):
        result = topological_sort({"a": [], "b": []})
        assert set(result) == {"a", "b"}

    def test_chain(self):
        result = topological_sort({"b": ["a"], "c": ["b"]})
        assert result == ["a", "b", "c"]

    def test_cycle_raises(self):
        with pytest.raises(CycleError):
            topological_sort({"a": ["b"], "b": ["a"]})


class TestEdgeCases:
    """Edge cases and error handling."""

    def test_empty_graph(self):
        g = DepGraph()
        assert g.topological_sort() == []
        assert g.has_cycle() is False
        assert g.find_cycle() == []

    def test_repr(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"])
        r = repr(g)
        assert "DepGraph" in r
        assert "nodes=2" in r
        assert "edges=1" in r

    def test_cycle_error_attributes(self):
        err = CycleError("custom", cycle=["a", "b"])
        assert str(err) == "custom"
        assert err.cycle == ["a", "b"]

    def test_cycle_error_default(self):
        err = CycleError()
        assert err.cycle == []

    def test_add_node_no_deps(self):
        g = DepGraph()
        n = g.add_node("a")
        assert n.depends_on == set()

    def test_remove_missing_node(self):
        g = DepGraph()
        g.remove_node("nonexistent")  # should not raise

    def test_large_dag(self):
        g = DepGraph()
        # Chain of 1000 nodes
        prev = None
        for i in range(1000):
            name = f"n{i}"
            deps = [prev] if prev else None
            g.add_node(name, depends_on=deps)
            prev = name
        result = g.topological_sort()
        assert len(result) == 1000
        assert result[0] == "n0"
        assert result[-1] == "n999"

    def test_is_acyclic_after_removing_cycle(self):
        g = DepGraph()
        g.add_node("a", depends_on=["b"])
        g.add_node("b", depends_on=["a"])
        assert g.has_cycle() is True
        g.remove_node("b")
        assert g.has_cycle() is False
        assert g.topological_sort() == ["a"]

    def test_json_serialization(self):
        g = DepGraph()
        g.add_node("a")
        g.add_node("b", depends_on=["a"], metadata={"priority": 1})
        d = g.to_dict()
        json_str = json.dumps(d)
        restored = json.loads(json_str)
        g2 = DepGraph.from_dict(restored)
        assert g2.node_count == 2
        assert g2.get_node("b").depends_on == {"a"}
