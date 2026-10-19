from fastapi import BackgroundTasks
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import create_deck, create_project, generate_deck, slide_ir_schema
from app.config import Settings
from app.db import Base
from app.schemas import DeckCreate, ProjectCreate


def test_create_project_deck_generate_and_schema():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    session = session_factory()
    try:
        project = create_project(ProjectCreate(name="Demo"), session)
        deck = create_deck(
            DeckCreate(
                project_id=project.id,
                title="Demo Deck",
                ir={"deck_id": "demo", "title": "Demo", "slides": [{"id": "s1", "elements": []}]},
            ),
            session,
        )
        job = generate_deck(deck.id, BackgroundTasks(), session, Settings(renderer_url="stub://renderer"))
        assert job.deck_id == deck.id
        schema = slide_ir_schema()
        assert "properties" in schema
    finally:
        session.close()

