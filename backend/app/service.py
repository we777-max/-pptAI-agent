from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import AgentEvent, AgentMessage, AgentRun, Deck
from ..services.renderer_client import RendererClient
from ..slide_ir import DeckIR
from .provider import AgentRequest, get_agent_provider


TERMINAL_RUN_STATUSES = {"completed", "failed", "canceled"}


def append_event(session: Session, run_id: str, event_type: str, payload: dict) -> AgentEvent:
    last_sequence = session.scalar(select(func.max(AgentEvent.sequence)).where(AgentEvent.run_id == run_id)) or 0
    event = AgentEvent(run_id=run_id, sequence=last_sequence + 1, event_type=event_type, payload=payload)
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def _progress(session: Session, run: AgentRun, step: str, status: str, message: str) -> None:
    run.current_step = step
    run.status = status
    session.commit()
    append_event(session, run.id, "run.progress", {"step": step, "status": status, "message": message})


def run_agent(run_id: str, session: Session, settings: Settings) -> None:
    run = session.get(AgentRun, run_id)
    if not run:
        return
    deck = session.get(Deck, run.deck_id)
    user_message = session.scalar(
        select(AgentMessage).where(AgentMessage.session_id == run.session_id).order_by(AgentMessage.created_at.desc())
    )
    if not deck or not user_message:
        run.status = "failed"
        run.current_step = "failed"
        run.error = "deck or message not found"
        session.commit()
        append_event(session, run.id, "run.failed", {"error": run.error})
        return

    try:
        _progress(session, run, "intake", "running", "已接收创作需求")
        _progress(session, run, "retrieve_context", "running", "正在整理项目上下文")
        current = DeckIR.model_validate(deck.ir_json)
        attachment_names = tuple(item.get("name", "") for item in (user_message.attachments or []) if item.get("name"))
        request = AgentRequest(prompt=user_message.content, attachment_names=attachment_names)
        _progress(session, run, "generate_deck_ir", "running", "正在生成 Deck IR")
        generated = get_agent_provider().generate(request, current)
        deck.ir_json = generated.model_dump(mode="json", by_alias=True)
        deck.title = generated.title
        deck.status = "generating"
        session.commit()
        append_event(session, run.id, "deck.ir_updated", {"deck_id": deck.id, "ir": deck.ir_json})

        _progress(session, run, "validate_ir", "validating", "正在校验画布结构")
        DeckIR.model_validate(deck.ir_json)
        _progress(session, run, "render_pptx", "rendering", "正在渲染 PPT")
        render_result = RendererClient(settings).render(generated, run.id)
        deck.pptx_path = render_result.output_path
        deck.status = "generated"
        run.status = "completed"
        run.current_step = "completed"
        session.commit()
        append_event(
            session,
            run.id,
            "render.completed",
            {"deck_id": deck.id, "output_path": render_result.output_path, "slide_count": render_result.slide_count},
        )
        append_event(session, run.id, "run.completed", {"deck_id": deck.id, "ir": deck.ir_json})
    except Exception as exc:  # persist failure for polling and SSE clients
        session.rollback()
        run = session.get(AgentRun, run_id)
        if not run:
            return
        run.status = "failed"
        run.current_step = "failed"
        run.error = str(exc)
        session.commit()
        append_event(session, run.id, "run.failed", {"error": run.error})
