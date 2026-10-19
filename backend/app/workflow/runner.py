from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import Settings
from ..models import Deck, GenerationJob
from ..services.renderer_client import RendererClient
from .graph import build_generation_graph


def run_generation_job(job_id: str, session: Session, settings: Settings) -> None:
    job = session.get(GenerationJob, job_id)
    if not job:
        return
    deck_row = session.get(Deck, job.deck_id)
    if not deck_row:
        job.status = "failed"
        job.error = "deck not found"
        session.commit()
        return

    try:
        job.status = "validating"
        job.current_step = "validate_ir"
        session.commit()
        state = {
            "job_id": job.id,
            "deck_id": deck_row.id,
            "deck": deck_row.ir_json,
            "status": "queued",
        }
        result = build_generation_graph(RendererClient(settings)).invoke(state)
        job.status = result.get("status", "completed")
        job.current_step = result.get("current_step", "persist_result")
        job.output_path = result.get("output_path")
        deck_row.pptx_path = job.output_path
        deck_row.status = "generated"
        session.commit()
    except Exception as exc:  # persist failure for polling clients
        session.rollback()
        job = session.get(GenerationJob, job_id)
        if job:
            job.status = "failed"
            job.current_step = "failed"
            job.error = str(exc)
            session.commit()

