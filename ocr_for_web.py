# -*- coding: utf-8 -*-
"""为 Web 编辑页单例化 PaddleOCR，避免每请求重载。"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

_ocr: Any = None


def get_ocr():
    global _ocr
    if _ocr is None:
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "1")
        from paddleocr import PaddleOCR

        _ocr = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device="cpu",
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_recognition_model_name="PP-OCRv5_mobile_rec",
        )
    return _ocr


def run_ocr_to_layout(image_path: str) -> Dict[str, Any]:
    import cv2

    from text_inpaint import build_text_layout, ocr_result_to_dict

    bgr = cv2.imread(image_path, cv2.IMREAD_COLOR)
    w, h = 0, 0
    if bgr is not None:
        h, w = bgr.shape[0], bgr.shape[1]
    ocr = get_ocr()
    for res in ocr.predict(image_path):
        d = ocr_result_to_dict(res)
        if bgr is None:
            bgr = cv2.imread(image_path, cv2.IMREAD_COLOR)
        if bgr is not None:
            h, w = bgr.shape[0], bgr.shape[1]
        return build_text_layout(d, w, h, bgr=bgr)
    return {
        "image": {"width": w, "height": h},
        "regions": [],
        "source": image_path,
        "meta": {"size_color_weight": ""},
    }


def write_filled_basename(
    source_abs_path: str, layout: Dict[str, Any]
) -> Optional[str]:
    """
    在 upload 同目录写抹字后底图，文件名 {stem}_filled.ext。
    供网页编辑区默认叠在「无原字」底图上，避免与原文叠影。
    """
    import os

    import cv2

    from text_inpaint import remove_text_inpaint_bgr

    bgr = cv2.imread(source_abs_path, cv2.IMREAD_COLOR)
    if bgr is None:
        return None
    polys: List[Any] = []
    for r in layout.get("regions", []) or []:
        if r.get("quad"):
            polys.append(r["quad"])
    if not polys:
        return None
    out = remove_text_inpaint_bgr(
        bgr, polys, inpaint_radius=4, dilate_ksize=5, dilate_iters=1
    )
    stem, ext = os.path.splitext(os.path.basename(source_abs_path))
    if not ext or ext.lower() not in (".png", ".jpg", ".jpeg", ".webp", ".bmp"):
        ext = ".png"
    name = f"{stem}_filled{ext}"
    out_path = os.path.join(os.path.dirname(source_abs_path), name)
    cv2.imwrite(out_path, out)
    return name
