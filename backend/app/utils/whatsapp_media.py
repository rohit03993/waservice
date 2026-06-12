_MEDIA_MESSAGE_TYPES = frozenset({"image", "document", "sticker", "video", "audio"})


def extract_waba_media_id(message_type: str, payload: dict | None) -> str | None:
    if not payload or message_type not in _MEDIA_MESSAGE_TYPES:
        return None
    block = payload.get(message_type)
    if not isinstance(block, dict):
        return None
    mid = block.get("id")
    return mid.strip() if isinstance(mid, str) and mid.strip() else None


def is_media_message_type(message_type: str) -> bool:
    return message_type in _MEDIA_MESSAGE_TYPES
