from pathlib import Path
from tempfile import TemporaryDirectory

from app.config import Settings
from app.services.renderer_client import RendererClient
from app.slide_ir import DeckIR
from app.workflow.graph import build_generation_graph


def test_fallback_or_langgraph_runner_writes_stub():
    with TemporaryDirectory(dir=Path.cwd()) as output_dir:
        settings = Settings(renderer_url="stub://renderer", output_dir=output_dir)
        deck = DeckIR.model_validate(
            {"deck_id": "demo", "title": "Demo", "slides": [{"id": "s1", "elements": []}]}
        )
        result = build_generation_graph(RendererClient(settings)).invoke(
            {"job_id": "job-1", "deck_id": "demo", "deck": deck.model_dump(mode="json")}
        )
        assert result["status"] == "completed"
        assert Path(result["output_path"]).exists()

