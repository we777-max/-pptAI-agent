from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import httpx

from ..config import Settings
from ..slide_ir import DeckIR


@dataclass(frozen=True)
class RenderResult:
    output_path: str
    slide_count: int


class RendererClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    def render(self, deck: DeckIR, job_id: str) -> RenderResult:
        if self.settings.renderer_url.startswith("stub://"):
            return self._render_stub(deck, job_id)
        payload = {"job_id": job_id, "deck": deck.model_dump(mode="json")}
        with httpx.Client(timeout=self.settings.request_timeout_seconds) as client:
            response = client.post(f"{self.settings.renderer_url.rstrip('/')}/render", json=payload)
            response.raise_for_status()
            data = response.json()
        return RenderResult(output_path=data["output_path"], slide_count=data.get("slide_count", len(deck.slides)))

    def _render_stub(self, deck: DeckIR, job_id: str) -> RenderResult:
        output_dir = Path(self.settings.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{job_id}.stub.pptx"
        output_path.write_text(json.dumps(deck.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
        return RenderResult(output_path=str(output_path), slide_count=len(deck.slides))

