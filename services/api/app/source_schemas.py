from typing import Literal
from pydantic import BaseModel, ConfigDict


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    conversation_id: str
    filename: str
    media_type: str
    byte_size: int
    content_hash: str
    state: Literal["ready", "failed"]
    error_code: str | None
    text_hash: str | None
    extractor: str
    created_at: str


class SourceText(BaseModel):
    asset: SourceOut
    text: str
