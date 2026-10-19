from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ..services.renderer_client import RendererClient
from ..slide_ir import DeckIR
from .state import GenerationState

try:  # Optional locally; pyproject installs it for production.
    from langgraph.graph import END, START, StateGraph
except ImportError:  # pragma: no cover - exercised only in minimal environments
    END = "__end__"
    START = "__start__"
    StateGraph = None


def _validate(state: GenerationState) -> GenerationState:
    state["current_step"] = "validate_ir"
    state["status"] = "validating"
    state["deck"] = DeckIR.model_validate(state["deck"])
    return state


def _prepare(state: GenerationState) -> GenerationState:
    state["current_step"] = "prepare_render"
    state["status"] = "rendering"
    return state


def _render(state: GenerationState, renderer: RendererClient) -> GenerationState:
    state["current_step"] = "render_pptx"
    result = renderer.render(state["deck"], state["job_id"])
    state["output_path"] = result.output_path
    return state


def _persist(state: GenerationState) -> GenerationState:
    state["current_step"] = "persist_result"
    state["status"] = "completed"
    return state


class _FallbackGraph:
    def __init__(self, nodes: list[Callable[[GenerationState], GenerationState]]):
        self.nodes = nodes

    def invoke(self, state: GenerationState) -> GenerationState:
        for node in self.nodes:
            state = node(state)
        return state


def build_generation_graph(renderer: RendererClient) -> Any:
    if StateGraph is None:
        return _FallbackGraph([_validate, _prepare, lambda s: _render(s, renderer), _persist])

    graph = StateGraph(GenerationState)
    graph.add_node("validate_ir", _validate)
    graph.add_node("prepare_render", _prepare)
    graph.add_node("render_pptx", lambda state: _render(state, renderer))
    graph.add_node("persist_result", _persist)
    graph.add_edge(START, "validate_ir")
    graph.add_edge("validate_ir", "prepare_render")
    graph.add_edge("prepare_render", "render_pptx")
    graph.add_edge("render_pptx", "persist_result")
    graph.add_edge("persist_result", END)
    return graph.compile()

