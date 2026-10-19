from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


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


# 画布单位统一为英寸，渲染侧再换算成 EMU/像素。
# 该容差用于吸收最后一次源于浮点运算的误差，不改语义。
CANVAS_TOLERANCE = 0.01
MAX_ELEMENTS_PER_SLIDE = 500


class SlideIR(IRModel):
    id: str
    width: float = Field(default=13.333, gt=0)
    height: float = Field(default=7.5, gt=0)
    background: Fill = Field(default_factory=lambda: Fill(color="#FFFFFF"))
    elements: list[SlideElement] = Field(default_factory=list)
    notes: str | None = None
    metadata: dict[str, object] = Field(default_factory=dict)

    @model_validator(mode="after")
    def elements_within_canvas(self) -> "SlideIR":
        # IR 是单一事实来源，因此画布约束在这里就地生效，
        # 使一份 IR 无论走 API 写入、Agent 生成还是渲染器消费都保持一致。
        if len(self.elements) > MAX_ELEMENTS_PER_SLIDE:
            raise ValueError(f"a slide may contain at most {MAX_ELEMENTS_PER_SLIDE} elements, got {len(self.elements)}")
        for element in self.elements:
            frame = element.frame
            overflow_x = frame.x + frame.w - self.width
            overflow_y = frame.y + frame.h - self.height
            if overflow_x > CANVAS_TOLERANCE or overflow_y > CANVAS_TOLERANCE:
                raise ValueError(
                    f"element {element.id!r} exceeds canvas of slide {self.id!r} "
                    f"({self.width}x{self.height}): extents reach "
                    f"{frame.x + frame.w:.4f}x{frame.y + frame.h:.4f}"
                )
        return self


class DeckIR(IRModel):
    deck_id: str
    title: str
    version: int = Field(default=1, ge=1)
    slides: list[SlideIR] = Field(min_length=1, max_length=200)
    theme: dict[str, object] = Field(default_factory=dict)
    metadata: dict[str, object] = Field(default_factory=dict)

