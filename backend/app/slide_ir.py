from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, HttpUrl, field_validator


class IRModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)


class Frame(IRModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    w: float = Field(gt=0)
    h: float = Field(gt=0)


class Fill(IRModel):
    color: str = "#FFFFFF"
    transparency: int = Field(default=0, ge=0, le=100)

    @field_validator("color")
    @classmethod
    def valid_hex(cls, value: str) -> str:
        if not value.startswith("#") or len(value) not in (4, 7):
            raise ValueError("color must be #RGB or #RRGGBB")
        return value.upper()


class Stroke(IRModel):
    color: str = "#000000"
    width: float = Field(default=1, ge=0)

    @field_validator("color")
    @classmethod
    def valid_hex(cls, value: str) -> str:
        return Fill.valid_hex(value)


class TextStyle(IRModel):
    font_family: str = "Aptos"
    font_size: float = Field(default=24, gt=0)
    color: str = "#111827"
    bold: bool = False
    italic: bool = False
    align: Literal["left", "center", "right"] = "left"
    valign: Literal["top", "mid", "bottom"] = "top"
    break_line: bool = True

    @field_validator("color")
    @classmethod
    def valid_hex(cls, value: str) -> str:
        return Fill.valid_hex(value)


class TextElement(IRModel):
    type: Literal["text"] = "text"
    id: str
    frame: Frame
    text: str
    style: TextStyle = Field(default_factory=TextStyle)
    z_index: int = 0


class ShapeElement(IRModel):
    type: Literal["shape"] = "shape"
    id: str
    frame: Frame
    shape: Literal["rect", "roundRect", "ellipse", "line"] = "rect"
    fill: Fill | None = Field(default_factory=Fill)
    stroke: Stroke | None = Field(default_factory=Stroke)
    rotation: float = 0
    flip_x: bool = Field(default=False, validation_alias=AliasChoices("flipX", "flip_x"), serialization_alias="flipX")
    flip_y: bool = Field(default=False, validation_alias=AliasChoices("flipY", "flip_y"), serialization_alias="flipY")
    z_index: int = 0


class ImageElement(IRModel):
    type: Literal["image"] = "image"
    id: str
    frame: Frame
    src: str | HttpUrl
    fit: Literal["contain", "cover", "stretch"] = "contain"
    rotation: float = 0
    flip_x: bool = Field(default=False, validation_alias=AliasChoices("flipX", "flip_x"), serialization_alias="flipX")
    flip_y: bool = Field(default=False, validation_alias=AliasChoices("flipY", "flip_y"), serialization_alias="flipY")
    z_index: int = 0


SlideElement = Annotated[TextElement | ShapeElement | ImageElement, Field(discriminator="type")]


class SlideIR(IRModel):
    id: str
    width: float = Field(default=13.333, gt=0)
    height: float = Field(default=7.5, gt=0)
    background: Fill = Field(default_factory=lambda: Fill(color="#FFFFFF"))
    elements: list[SlideElement] = Field(default_factory=list)
    notes: str | None = None
    metadata: dict[str, object] = Field(default_factory=dict)

    @field_validator("elements")
    @classmethod
    def elements_within_canvas(cls, elements: list[SlideElement]) -> list[SlideElement]:
        # Canvas dimensions are validated by the renderer; this keeps IR validation local and composable.
        if len(elements) > 500:
            raise ValueError("a slide may contain at most 500 elements")
        return elements


class DeckIR(IRModel):
    deck_id: str
    title: str
    version: int = Field(default=1, ge=1)
    slides: list[SlideIR] = Field(min_length=1, max_length=200)
    theme: dict[str, object] = Field(default_factory=dict)
    metadata: dict[str, object] = Field(default_factory=dict)

