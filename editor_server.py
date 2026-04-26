#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
可交互「文字分离 / 可编辑」页面。

用法（在项目根目录 图片可编辑/）:
  python3 editor_server.py

浏览器打开: http://127.0.0.1:7777/
"""
from __future__ import annotations

import io
import mimetypes
import os
import uuid
from typing import Any

from flask import Flask, jsonify, request, send_file
from werkzeug.utils import secure_filename


def _json_safe(x: Any) -> Any:
    if isinstance(x, dict):
        return {str(k): _json_safe(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_json_safe(i) for i in x]
    if hasattr(x, "tolist") and callable(x.tolist):
        return _json_safe(x.tolist())
    if hasattr(x, "item") and callable(x.item) and "numpy" in str(type(x)):
        return _json_safe(x.item())
    return x

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "web", "static")
UPLOAD = os.path.join(ROOT, "web", "uploads")
os.makedirs(UPLOAD, exist_ok=True)

ALLOW = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


app = Flask(
    __name__,
    static_folder=STATIC,
    static_url_path="",
)


@app.route("/")
def index():
    p = os.path.join(STATIC, "index.html")
    return send_file(p)


@app.route("/api/ocr", methods=["POST"])
def api_ocr():
    f = request.files.get("image")
    if not f or not f.filename:
        return jsonify(error="需要 multipart 字段 image（文件）"), 400
    sfn = secure_filename(f.filename or "img") or "img"
    _b, ext = os.path.splitext(sfn)
    if ext.lower() not in ALLOW:
        ext = ".png"
    name = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD, name)
    f.save(path)
    if not os.path.getsize(path):
        os.remove(path)
        return jsonify(error="空文件"), 400
    try:
        from ocr_for_web import run_ocr_to_layout, write_filled_basename

        layout = run_ocr_to_layout(path)
        filled_name = None
        try:
            if isinstance(layout, dict) and (layout.get("regions") or []):
                filled_name = write_filled_basename(path, layout)
        except Exception:  # noqa: BLE001
            filled_name = None
    except Exception as e:  # noqa: BLE001
        if os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass
        return jsonify(error=f"OCR 失败: {e!s}"), 500
    # 原图 + 抹字后底图（推荐编辑用后者，无原字叠影）
    url = f"/api/file/{name}"
    filled_url = f"/api/file/{filled_name}" if filled_name else None
    layout = _json_safe(layout)
    if isinstance(layout, dict):
        layout["source"] = "uploaded"
        m = layout.get("meta") or {}
        if not isinstance(m, dict):
            m = {}
        m["editor"] = "默认以抹字后图为底（filled），可在页面切换为原图对照。"
        layout["meta"] = m
    return jsonify(
        layout=layout,
        imageUrl=url,
        filledImageUrl=filled_url,
        filename=name,
    )


@app.route("/api/export_pptx", methods=["POST"])
def api_export_pptx():
    data = request.get_json(silent=True) or {}
    pages = data.get("pages")
    if not isinstance(pages, list) or not pages:
        return jsonify(error="需要非空字段 pages"), 400
    bg = data.get("background_files")
    if not isinstance(bg, list) or len(bg) != len(pages):
        return jsonify(error="background_files 须与 pages 等长"), 400
    try:
        from pptx_export import build_pptx_bytes

        buf = build_pptx_bytes(
            pages=pages,
            background_files=bg,
            upload_dir=UPLOAD,
        )
    except ImportError:
        return (
            jsonify(
                error="服务器未安装 python-pptx，请执行: pip install python-pptx"
            ),
            501,
        )
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)), 400
    return send_file(
        io.BytesIO(buf),
        mimetype=(
            "application/vnd.openxmlformats-officedocument."
            "presentationml.presentation"
        ),
        as_attachment=True,
        download_name="edited_layout.pptx",
    )


@app.route("/api/file/<path:fname>", methods=["GET"])
def serve_file(fname: str):
    if ".." in fname or fname.startswith(("/", "\\")):
        return "bad path", 400
    p = os.path.join(UPLOAD, secure_filename(fname))
    if not p.startswith(UPLOAD) or not os.path.isfile(p):
        return "not found", 404
    mt = mimetypes.guess_type(p)[0] or "image/png"
    return send_file(p, mimetype=mt, max_age=60)


if __name__ == "__main__":
    print("打开浏览器访问: http://127.0.0.1:7777/（Ctrl+C 结束）\n", flush=True)
    app.run(host="127.0.0.1", port=7777, debug=False, threaded=True)
