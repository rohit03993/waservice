"""Build human-readable preview text from stored Meta template components (synced JSON)."""

from __future__ import annotations

import re
from typing import Any


def _first_row_from_body_text_example(body_text_val: Any) -> list[str] | None:
    """Normalize Meta body_text example: often [[\"a\",\"b\"]] or legacy shapes."""
    if not isinstance(body_text_val, list) or not body_text_val:
        return None
    first = body_text_val[0]
    if isinstance(first, list):
        return [str(x) for x in first]
    return [str(x) for x in body_text_val]


def _substitute_positional_by_appearance(text: str, samples: list[str]) -> str:
    """Map sample values to {{n}} placeholders by order of first appearance in the string."""
    order: list[int] = []
    seen: set[int] = set()
    for m in re.finditer(r"\{\{\s*(\d+)\s*\}\}", text):
        n = int(m.group(1))
        if n not in seen:
            seen.add(n)
            order.append(n)
    if len(samples) < len(order):
        return text
    idx_map = {order[i]: samples[i] for i in range(len(order))}

    def repl(m: re.Match[str]) -> str:
        n = int(m.group(1))
        return str(idx_map[n]) if n in idx_map else m.group(0)

    return re.sub(r"\{\{\s*(\d+)\s*\}\}", repl, text)


def _substitute_named_params(text: str, named_list: Any) -> str:
    if not isinstance(named_list, list):
        return text
    out = text
    for item in named_list:
        if not isinstance(item, dict):
            continue
        pn = item.get("param_name")
        ex = item.get("example")
        if pn is None or ex is None:
            continue
        pattern = r"\{\{\s*" + re.escape(str(pn)) + r"\s*\}\}"
        out = re.sub(pattern, str(ex), out)
    return out


def _apply_component_example(text: str, example: Any, *, kind: str) -> str:
    if not text or not isinstance(example, dict):
        return text
    if kind == "header":
        ht = example.get("header_text")
        if isinstance(ht, list) and ht:
            if isinstance(ht[0], list):
                samples = [str(x) for x in ht[0]]
            else:
                samples = [str(x) for x in ht]
            return _substitute_positional_by_appearance(text, samples)
        hnp = example.get("header_text_named_params")
        return _substitute_named_params(text, hnp)
    # body / footer
    row = _first_row_from_body_text_example(example.get("body_text"))
    if row:
        return _substitute_positional_by_appearance(text, row)
    bnp = example.get("body_text_named_params")
    if bnp:
        return _substitute_named_params(text, bnp)
    return text


def _extract_body_send_parameters(template_components: list[dict] | None) -> list[dict]:
    if not template_components:
        return []
    for comp in template_components:
        if not isinstance(comp, dict):
            continue
        if str(comp.get("type") or "").lower() != "body":
            continue
        params = comp.get("parameters")
        if isinstance(params, list):
            return [p for p in params if isinstance(p, dict)]
    return []


def _substitute_send_values_in_text(text: str, body_params: list[dict], var_keys: list[str]) -> str:
    """Replace {{name}} / {{n}} placeholders with values actually sent to Meta."""
    if not body_params:
        return text
    out = text
    for param in body_params:
        pname = param.get("parameter_name")
        val = str(param.get("text") or "").strip()
        if not val or not pname:
            continue
        out = re.sub(r"\{\{\s*" + re.escape(str(pname)) + r"\s*\}\}", val, out)
    values = [str(p.get("text") or "").strip() for p in body_params if str(p.get("text") or "").strip()]
    if not values:
        return out
    if var_keys and all(k.isdigit() for k in var_keys):
        return _substitute_positional_by_appearance(out, values)
    for i, key in enumerate(var_keys):
        if i >= len(values):
            break
        if not str(key).isdigit():
            out = re.sub(r"\{\{\s*" + re.escape(str(key)) + r"\s*\}\}", values[i], out)
    return out


def build_template_preview_for_send(
    components_wrapped: dict | None,
    template_components: list[dict] | None,
) -> str | None:
    """
    Human-readable preview using the parameter values sent on this message (not Meta sample examples).
    """
    if not components_wrapped or not isinstance(components_wrapped, dict):
        return None
    raw = components_wrapped.get("components")
    if not isinstance(raw, list):
        return None
    body_params = _extract_body_send_parameters(template_components)
    var_keys = body_template_variables(components_wrapped)
    chunks: list[str] = []
    for comp in raw:
        if not isinstance(comp, dict):
            continue
        ctype = str(comp.get("type") or "").upper()
        fmt = str(comp.get("format") or "").upper()
        text = comp.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        text = text.strip()
        if ctype == "HEADER" and fmt == "TEXT":
            chunks.append(text)
        elif ctype == "BODY":
            chunks.append(_substitute_send_values_in_text(text, body_params, var_keys))
        elif ctype == "FOOTER":
            chunks.append(text)
    if not chunks:
        return None
    return "\n".join(chunks).strip()


def resolve_template_message_preview(
    components_wrapped: dict | None,
    payload: dict | None,
) -> str | None:
    """Prefer rendered send values; fall back to stored preview or Meta sample text."""
    if not isinstance(payload, dict):
        return build_template_preview_from_stored(components_wrapped)
    send_components = payload.get("template_components")
    if isinstance(send_components, list) and send_components:
        rendered = build_template_preview_for_send(components_wrapped, send_components)
        if rendered:
            return rendered
    existing = payload.get("preview_text")
    if isinstance(existing, str) and existing.strip():
        return existing.strip()
    return build_template_preview_from_stored(components_wrapped)


def build_template_preview_from_stored(components_wrapped: dict | None) -> str | None:
    """
    components_wrapped matches DB shape: {\"components\": [<Meta component dicts>, ...]}.
    Concatenates HEADER (text) + BODY + FOOTER with example substitution where Meta provides examples.
    """
    if not components_wrapped or not isinstance(components_wrapped, dict):
        return None
    raw = components_wrapped.get("components")
    if not isinstance(raw, list):
        return None
    chunks: list[str] = []
    for comp in raw:
        if not isinstance(comp, dict):
            continue
        ctype = str(comp.get("type") or "").upper()
        fmt = str(comp.get("format") or "").upper()
        ex = comp.get("example") if isinstance(comp.get("example"), dict) else None
        text = comp.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        text = text.strip()
        if ctype == "HEADER" and fmt == "TEXT":
            chunks.append(_apply_component_example(text, ex, kind="header"))
        elif ctype == "BODY":
            chunks.append(_apply_component_example(text, ex, kind="body"))
        elif ctype == "FOOTER":
            chunks.append(_apply_component_example(text, ex, kind="body"))
    if not chunks:
        return None
    return "\n".join(chunks).strip()


def body_template_variables(components_wrapped: dict | None) -> list[str]:
    """
    Ordered body placeholder keys for Cloud API sends: positional '1','2',… or named keys.
    Empty when the template body has no variables.
    """
    if not components_wrapped or not isinstance(components_wrapped, dict):
        return []
    raw = components_wrapped.get("components")
    if not isinstance(raw, list):
        return []
    for comp in raw:
        if not isinstance(comp, dict) or str(comp.get("type") or "").upper() != "BODY":
            continue
        text = comp.get("text")
        if not isinstance(text, str) or not text.strip():
            return []
        order: list[str] = []
        seen: set[str] = set()
        for m in re.finditer(r"\{\{\s*(\d+)\s*\}\}", text):
            key = m.group(1)
            if key not in seen:
                seen.add(key)
                order.append(key)
        if order:
            return order
        for m in re.finditer(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}", text):
            key = m.group(1)
            if key not in seen:
                seen.add(key)
                order.append(key)
        return order
    return []
