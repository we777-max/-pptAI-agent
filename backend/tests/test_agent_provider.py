from app.agent.provider import AgentRequest, get_agent_provider
from app.slide_ir import DeckIR


def _deck(slide_count: int = 1) -> DeckIR:
    slides = [{"id": f"s{index}", "elements": []} for index in range(1, slide_count + 1)]
    return DeckIR.model_validate({"deck_id": "demo", "title": "Demo", "slides": slides})


def test_mock_provider_rewrites_first_slide_and_bumps_version():
    generated = get_agent_provider().generate(AgentRequest(prompt="季度汇报"), _deck())
    assert generated.slides[0].elements
    assert generated.title == "季度汇报"
    assert generated.version == 2


def test_mock_provider_keeps_remaining_slides():
    generated = get_agent_provider().generate(AgentRequest(prompt="季度汇报"), _deck(3))
    assert [slide.id for slide in generated.slides] == ["s1", "s2", "s3"]


def test_mock_provider_truncates_long_title():
    generated = get_agent_provider().generate(AgentRequest(prompt="非常长的标题" * 12), _deck())
    assert len(generated.title) <= 37
