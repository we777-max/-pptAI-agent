from app.slide_ir import DeckIR


def test_slide_ir_accepts_mixed_elements_and_exports_schema():
    deck = DeckIR.model_validate(
        {
            "deck_id": "demo",
            "title": "Demo",
            "slides": [
                {
                    "id": "s1",
                    "elements": [
                        {"type": "text", "id": "title", "frame": {"x": 1, "y": 1, "w": 8, "h": 1}, "text": "Hello"},
                        {"type": "shape", "id": "box", "frame": {"x": 1, "y": 2, "w": 4, "h": 2}, "shape": "roundRect"},
                    ],
                }
            ],
        }
    )
    assert deck.slides[0].elements[0].type == "text"
    assert "properties" in DeckIR.model_json_schema()


def test_slide_ir_rejects_invalid_color():
    try:
        DeckIR.model_validate(
            {"deck_id": "demo", "title": "Demo", "slides": [{"id": "s1", "background": {"color": "red"}}]}
        )
    except ValueError as exc:
        assert "color" in str(exc)
    else:
        raise AssertionError("invalid color should fail validation")


def test_slide_ir_rejects_element_overflowing_canvas():
    try:
        DeckIR.model_validate(
            {
                "deck_id": "demo",
                "title": "Demo",
                "slides": [{"id": "s1", "elements": [{"type": "text", "id": "wide", "frame": {"x": 10, "y": 1, "w": 8, "h": 1}, "text": "too wide"}]}],
            }
        )
    except ValueError as exc:
        assert "exceeds canvas" in str(exc)
    else:
        raise AssertionError("elements outside the canvas should fail validation")


def test_slide_ir_allows_element_within_float_tolerance():
    deck = DeckIR.model_validate(
        {
            "deck_id": "demo",
            "title": "Demo",
            "slides": [
                {
                    "id": "s1",
                    "elements": [{"type": "text", "id": "edge", "frame": {"x": 0, "y": 0, "w": 13.333, "h": 7.5}, "text": "full bleed"}],
                }
            ],
        }
    )
    assert deck.slides[0].elements[0].id == "edge"

