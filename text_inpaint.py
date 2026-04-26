# -*- coding: utf-8 -*-
"""根据 OCR 多边形对文字区做近邻色修复，并输出布局信息（位置与尺寸）。"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np


def _as_numpy_poly(poly: Any) -> np.ndarray:
    p = np.asarray(poly, dtype=np.int32)
    if p.ndim != 2 or p.shape[0] < 3 or p.shape[1] != 2:
        return np.empty((0, 2), dtype=np.int32)
    return p


def ocr_result_to_dict(res: Any) -> Dict[str, Any]:
    """PaddleOCR 3.x 的 predict 单条结果 → 扁平 dict。"""
    d = res.json
    if callable(d):
        d = d()
    if not isinstance(d, dict):
        d = dict(d) if d is not None else {}
    if "res" in d and isinstance(d["res"], dict) and "input_path" in d["res"]:
        d = d["res"]
    return d


def _bgr_to_hex(b: int, g: int, r: int) -> str:
    return f"#{r:02x}{g:02x}{b:02x}"


def _estimate_text_style_bgr(
    bgr: np.ndarray,
    poly: Any,
) -> Optional[Dict[str, Any]]:
    """
    从多边形内像素用 KMeans(2)+边框背景 分离前景/背景，得到：
    前景 BGR、RGB、hex、背景色粗估、ink 覆盖率 → 字重启发式。
    真·字体名 / 加粗 是否来自 PPT 无法从纯图 100% 恢复，此结果为「可编辑叠字」的近似值。
    """
    h, w = bgr.shape[:2]
    pts = _as_numpy_poly(poly)
    if pts.shape[0] < 3:
        return None
    fill = np.zeros((h, w), np.uint8)
    cv2.fillPoly(fill, [pts], 255)
    m = fill > 0
    y_idx, x_idx = np.where(m)
    if y_idx.size < 3:
        return None
    crop_ys, crop_ye = int(y_idx.min()), int(y_idx.max()) + 1
    crop_xs, crop_xe = int(x_idx.min()), int(x_idx.max()) + 1
    crop_ys, crop_xs = max(0, crop_ys), max(0, crop_xs)
    crop_ye, crop_xe = min(h, crop_ye), min(w, crop_xe)
    crop = bgr[crop_ys:crop_ye, crop_xs:crop_xe]
    mask = fill[crop_ys:crop_ye, crop_xs:crop_xe] > 0
    pixels = crop[mask]
    n = int(pixels.shape[0])
    if n < 1:
        return None

    # 边框 = 多边形外扩 5 像素，用于估计背景，便于区分白字/黑字
    d = int(max(2, (crop_ye - crop_ys + crop_xe - crop_xs) // 40 + 1))
    kernel = np.ones((2 * d + 1, 2 * d + 1), np.uint8)
    dmask = cv2.dilate(fill, kernel) - fill
    bsample = bgr[dmask > 0]
    if bsample.size >= 9 and bsample.shape[0] >= 3:
        border_bgr = np.median(bsample, axis=0)
    else:
        # 多边形太贴边/太小时外圈样本不足，用行内中值代替背景参考
        border_bgr = np.median(pixels, axis=0)

    z = np.float32(pixels.reshape(-1, 3))
    if n < 8 or np.allclose(pixels.std(axis=0), 0):
        tb = [int(c) for c in np.median(pixels, axis=0).tolist()]
        rgb = (tb[2], tb[1], tb[0])
        return {
            "text_color_bgr": tb,
            "text_color_rgb": list(rgb),
            "text_color_hex": _bgr_to_hex(tb[0], tb[1], tb[2]),
            "background_median_bgr": [int(x) for x in border_bgr.tolist()],
            "ink_coverage": 1.0,
            "font_weight_hint": "unknown",
            "weight_confidence": 0.0,
            "note": "色块过匀或区域过小，仅返回中位色。",
        }

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    _, lbl, center = cv2.kmeans(
        z, 2, None, criteria, 3, cv2.KMEANS_PP_CENTERS
    )
    lbl = lbl.ravel()
    c0, c1 = center[0].astype(np.float64), center[1].astype(np.float64)
    d0 = float(np.linalg.norm(c0 - border_bgr))
    d1 = float(np.linalg.norm(c1 - border_bgr))
    # 与边框差异更大的一簇更可能是「字」
    t_idx = 0 if d0 >= d1 else 1
    tb = [int(x) for x in center[t_idx].tolist()]
    bbg = [int(x) for x in center[1 - t_idx].tolist()]
    ink = float((lbl == t_idx).sum() / n)
    # 覆盖率高 → 字更厚或块更大
    if ink > 0.5:
        wname = "bold"
        conf = min(0.9, 0.35 + (ink - 0.5))
    elif ink > 0.3:
        wname = "normal"
        conf = 0.55
    elif ink > 0.12:
        wname = "normal"
        conf = 0.45
    else:
        wname = "light"
        conf = 0.4
    r, g, b_ = tb[2], tb[1], tb[0]
    return {
        "text_color_bgr": tb,
        "text_color_rgb": [r, g, b_],
        "text_color_hex": _bgr_to_hex(tb[0], tb[1], tb[2]),
        "background_cluster_bgr": bbg,
        "border_median_bgr": [int(x) for x in border_bgr.tolist()],
        "ink_coverage": round(ink, 4),
        "font_weight_hint": wname,
        "weight_confidence": round(conf, 2),
    }


def _font_size_block(
    line_height_px: int,
    bbox_w: int,
    text: str,
    image_height: int,
) -> Dict[str, Any]:
    """以像素为基准；PPT/Word 的 pt 需结合导出 DPI 换算，仅给屏幕常用近似。"""
    # 常显：1080p 下「约等于 96 dpi」的 pt 近似
    approx_pt_96dpi = line_height_px * 72.0 / 96.0
    n = max(1, len((text or "").replace("\n", "")))
    em_w = bbox_w / n if n else line_height_px
    return {
        "line_height_px": int(line_height_px),
        "cap_height_proxy_px": int(line_height_px),
        "avg_char_width_proxy_px": round(float(em_w), 1),
        "approx_font_size_pt_screen_96dpi": round(approx_pt_96dpi, 1),
        "image_height_px": int(image_height),
    }


def _polys_list(data: Dict[str, Any]) -> List[Any]:
    polys = data.get("rec_polys") or data.get("dt_polys")
    if polys is None:
        return []
    if hasattr(polys, "tolist"):
        polys = polys.tolist()
    return list(polys)


def build_inpaint_mask(
    shape: Tuple[int, int, int],
    polys: List[Any],
    dilate_ksize: int = 5,
    dilate_iters: int = 1,
) -> np.ndarray:
    h, w = shape[0], shape[1]
    mask = np.zeros((h, w), dtype=np.uint8)
    for poly in polys:
        pts = _as_numpy_poly(poly)
        if pts.shape[0] < 3:
            continue
        cv2.fillPoly(mask, [pts], 255)
    if dilate_iters > 0 and np.any(mask):
        k = max(3, int(dilate_ksize) | 1)  # 奇数
        kernel = np.ones((k, k), dtype=np.uint8)
        mask = cv2.dilate(mask, kernel, iterations=int(dilate_iters))
    return mask


def remove_text_inpaint_bgr(
    bgr: np.ndarray,
    polys: List[Any],
    inpaint_radius: int = 4,
    dilate_ksize: int = 5,
    dilate_iters: int = 1,
) -> np.ndarray:
    if bgr is None or not polys:
        return bgr
    mask = build_inpaint_mask(bgr.shape, polys, dilate_ksize, dilate_iters)
    if not np.any(mask):
        return bgr
    return cv2.inpaint(bgr, mask, int(inpaint_radius), cv2.INPAINT_TELEA)


def build_text_layout(
    data: Dict[str, Any],
    img_w: int,
    img_h: int,
    bgr: Optional[np.ndarray] = None,
) -> Dict[str, Any]:
    """为每条检测保留：原文、多边形、外接框、像素级字号、估色、字重启发等。"""
    rec_texts: List = list(data.get("rec_texts") or [])
    polys: List = _polys_list(data)
    raw_scores = data.get("rec_scores")
    if raw_scores is None:
        raw_scores = []
    if hasattr(raw_scores, "tolist"):
        raw_scores = raw_scores.tolist()
    scores: List[float] = []
    for s in list(raw_scores):
        try:
            scores.append(float(s))
        except (TypeError, ValueError):
            scores.append(0.0)
    regions = []
    for i, poly in enumerate(polys):
        pts = np.asarray(poly, dtype=np.float64)
        if pts.size < 6 or pts.shape[0] < 3:
            continue
        x_min, x_max = float(pts[:, 0].min()), float(pts[:, 0].max())
        y_min, y_max = float(pts[:, 1].min()), float(pts[:, 1].max())
        text = rec_texts[i] if i < len(rec_texts) else ""
        sc = scores[i] if i < len(scores) else 0.0
        w_box = int(round(x_max - x_min))
        h_box = int(round(y_max - y_min))
        quad = np.asarray(poly).round().astype(int).tolist()
        reg: Dict[str, Any] = {
            "id": i,
            "text": text,
            "score": sc,
            "quad": quad,
            "bbox": {
                "x": int(round(x_min)),
                "y": int(round(y_min)),
                "width": w_box,
                "height": h_box,
            },
            "line_height_px": h_box,
            "font_size": _font_size_block(
                h_box, w_box, text, image_height=img_h
            ),
        }
        if bgr is not None:
            st = _estimate_text_style_bgr(bgr, poly)
            if st is not None:
                reg["style"] = st
        regions.append(reg)
    out: Dict[str, Any] = {
        "image": {"width": int(img_w), "height": int(img_h)},
        "source": data.get("input_path", ""),
        "meta": {
            "size_color_weight": "字号为像素/近似 pt；颜色为取前景 KMeans；"
            "字重为基于笔画覆盖率(ink_coverage)的启发，非原稿字体名。"
        },
        "regions": regions,
    }
    return out


def save_inpainted_and_layout(
    data: Dict[str, Any],
    out_dir: str,
    base_name: str,
    inpaint_radius: int = 4,
    dilate_ksize: int = 5,
    dilate_iters: int = 1,
) -> Tuple[str, str]:
    """
    从 OCR dict 读原图 → inpaint → 写 base_name_filled.png 与 base_name_text_layout.json。
    返回 (涂抹图路径, 布局 json 路径)。
    """
    input_path = data.get("input_path", "")
    if not input_path or not os.path.isfile(input_path):
        raise FileNotFoundError(f"缺少有效 input_path: {input_path!r}")
    bgr = cv2.imread(input_path, cv2.IMREAD_COLOR)
    if bgr is None:
        raise OSError(f"无法读取图片: {input_path}")
    h, w = bgr.shape[:2]
    polys = _polys_list(data)
    filled = remove_text_inpaint_bgr(
        bgr,
        polys,
        inpaint_radius=inpaint_radius,
        dilate_ksize=dilate_ksize,
        dilate_iters=dilate_iters,
    )
    os.makedirs(out_dir, exist_ok=True)
    out_img = os.path.join(out_dir, f"{base_name}_filled.png")
    cv2.imwrite(out_img, filled)
    layout = build_text_layout(data, w, h, bgr=bgr)
    out_json = os.path.join(out_dir, f"{base_name}_text_layout.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(layout, f, ensure_ascii=False, indent=2)
    return out_img, out_json
