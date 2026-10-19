from __future__ import annotations

from typing import TypedDict

from ..slide_ir import DeckIR


class GenerationState(TypedDict, total=False):
    job_id: str
    deck_id: str
    deck: DeckIR
    status: str
    current_step: str
    output_path: str
    error: str

