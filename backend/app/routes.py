from __future__ import annotations

import json
import time
from collections.abc import Iterator

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agent.service import TERMINAL_RUN_STATUSES, append_event, run_agent
from ..config import Settings, get_settings
from ..db import SessionLocal, get_session
from ..models import AgentEvent, AgentMessage, AgentRun, AgentSession, Deck, GenerationJob, Project
from ..schemas import (
    AgentMessageCreate,
    AgentMessageRead,
    AgentRunRead,
    AgentSessionCreate,
    AgentSessionRead,
    DeckCreate,
    DeckRead,
    DeckUpdate,
    JobRead,
    ProjectCreate,
    ProjectRead,
)
from ..slide_ir import DeckIR
from ..workflow.runner import run_generation_job

router = APIRouter()


def _deck_read(deck: Deck) -> DeckRead:
    return DeckRead(
        id=deck.id,
        project_id=deck.project_id,
        title=deck.title,
        status=deck.status,
        ir=DeckIR.model_validate(deck.ir_json),
        pptx_path=deck.pptx_path,
        created_at=deck.created_at,
    )


@router.post("/projects", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, session: Session = Depends(get_session)) -> Project:
    project = Project(name=payload.name)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.get("/projects", response_model=list[ProjectRead])
def list_projects(session: Session = Depends(get_session)) -> list[Project]:
    return list(session.scalars(select(Project).order_by(Project.created_at.desc())).all())


@router.get("/projects/{project_id}/history", response_model=list[DeckRead])
def project_history(project_id: str, session: Session = Depends(get_session)) -> list[DeckRead]:
    if not session.get(Project, project_id):
        raise HTTPException(status_code=404, detail="project not found")
    decks = session.scalars(select(Deck).where(Deck.project_id == project_id).order_by(Deck.updated_at.desc())).all()
    return [_deck_read(deck) for deck in decks]


@router.post("/decks", response_model=DeckRead, status_code=status.HTTP_201_CREATED)
def create_deck(payload: DeckCreate, session: Session = Depends(get_session)) -> DeckRead:
    if not session.get(Project, payload.project_id):
        raise HTTPException(status_code=404, detail="project not found")
    deck = Deck(project_id=payload.project_id, title=payload.title, ir_json=payload.ir.model_dump(mode="json", by_alias=True))
    session.add(deck)
    session.flush()
    deck.ir_json = {**deck.ir_json, "deck_id": deck.id}
    session.commit()
    session.refresh(deck)
    return _deck_read(deck)


@router.get("/decks/{deck_id}", response_model=DeckRead)
def get_deck(deck_id: str, session: Session = Depends(get_session)) -> DeckRead:
    deck = session.get(Deck, deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="deck not found")
    return _deck_read(deck)


@router.patch("/decks/{deck_id}", response_model=DeckRead)
def update_deck(deck_id: str, payload: DeckUpdate, session: Session = Depends(get_session)) -> DeckRead:
    deck = session.get(Deck, deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="deck not found")
    if payload.title is not None:
        deck.title = payload.title
    if payload.ir is not None:
        ir = payload.ir.model_copy(update={"deck_id": deck.id})
        deck.ir_json = ir.model_dump(mode="json", by_alias=True)
        deck.title = ir.title
    session.commit()
    session.refresh(deck)
    return _deck_read(deck)


@router.post("/decks/{deck_id}/generate", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
def generate_deck(
    deck_id: str,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> GenerationJob:
    deck = session.get(Deck, deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="deck not found")
    job = GenerationJob(deck_id=deck.id, status="queued", current_step="queued")
    session.add(job)
    session.commit()
    session.refresh(job)
    background_tasks.add_task(_run_background, job.id, settings)
    return job


def _run_background(job_id: str, settings: Settings) -> None:
    with SessionLocal() as task_session:
        run_generation_job(job_id, task_session, settings)


@router.get("/jobs/{job_id}", response_model=JobRead)
def get_job(job_id: str, session: Session = Depends(get_session)) -> GenerationJob:
    job = session.get(GenerationJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.post("/agent/sessions", response_model=AgentSessionRead, status_code=status.HTTP_201_CREATED)
def create_agent_session(payload: AgentSessionCreate, session: Session = Depends(get_session)) -> AgentSession:
    project = session.get(Project, payload.project_id)
    deck = session.get(Deck, payload.deck_id)
    if not project:
        raise HTTPException(status_code=404, detail="project not found")
    if not deck or deck.project_id != project.id:
        raise HTTPException(status_code=404, detail="deck not found in project")
    agent_session = AgentSession(project_id=project.id, deck_id=deck.id)
    session.add(agent_session)
    session.commit()
    session.refresh(agent_session)
    return agent_session


@router.get("/agent/sessions/{session_id}/messages", response_model=list[AgentMessageRead])
def list_agent_messages(session_id: str, session: Session = Depends(get_session)) -> list[AgentMessage]:
    if not session.get(AgentSession, session_id):
        raise HTTPException(status_code=404, detail="agent session not found")
    return list(session.scalars(select(AgentMessage).where(AgentMessage.session_id == session_id).order_by(AgentMessage.created_at)).all())


@router.post("/agent/sessions/{session_id}/messages", response_model=AgentRunRead, status_code=status.HTTP_202_ACCEPTED)
def send_agent_message(
    session_id: str,
    payload: AgentMessageCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AgentRun:
    agent_session = session.get(AgentSession, session_id)
    if not agent_session:
        raise HTTPException(status_code=404, detail="agent session not found")
    if not payload.content.strip() and not payload.attachments:
        raise HTTPException(status_code=422, detail="content or attachment is required")
    message = AgentMessage(
        session_id=agent_session.id,
        role="user",
        content=payload.content.strip(),
        attachments=[item.model_dump(mode="json") for item in payload.attachments],
    )
    run = AgentRun(session_id=agent_session.id, deck_id=agent_session.deck_id, status="queued", current_step="queued")
    agent_session.status = "running"
    session.add_all([message, run])
    session.commit()
    session.refresh(run)
    append_event(session, run.id, "run.queued", {"run_id": run.id, "deck_id": run.deck_id})
    background_tasks.add_task(_run_agent_background, run.id, settings)
    return run


def _run_agent_background(run_id: str, settings: Settings) -> None:
    with SessionLocal() as task_session:
        run_agent(run_id, task_session, settings)


@router.get("/agent/runs/{run_id}", response_model=AgentRunRead)
def get_agent_run(run_id: str, session: Session = Depends(get_session)) -> AgentRun:
    run = session.get(AgentRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="agent run not found")
    return run


def _event_stream(run_id: str, after: int, settings: Settings) -> Iterator[str]:
    cursor = max(0, after)
    deadline = time.monotonic() + settings.agent_run_timeout_seconds
    while time.monotonic() < deadline:
        with SessionLocal() as session:
            events = session.scalars(
                select(AgentEvent).where(AgentEvent.run_id == run_id, AgentEvent.sequence > cursor).order_by(AgentEvent.sequence)
            ).all()
            run = session.get(AgentRun, run_id)
        for event in events:
            cursor = event.sequence
            payload = json.dumps(event.payload or {}, ensure_ascii=False, separators=(",", ":"))
            yield f"id: {event.sequence}\nevent: {event.event_type}\ndata: {payload}\n\n"
        if run and run.status in TERMINAL_RUN_STATUSES and not events:
            break
        time.sleep(settings.agent_poll_interval_seconds)


@router.get("/agent/runs/{run_id}/events")
def stream_agent_events(
    run_id: str,
    after: int = Query(default=0, ge=0),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    with SessionLocal() as session:
        if not session.get(AgentRun, run_id):
            raise HTTPException(status_code=404, detail="agent run not found")
    return StreamingResponse(
        _event_stream(run_id, after, settings),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/json-schema/slide-ir")
def slide_ir_schema() -> dict:
    return DeckIR.model_json_schema()
